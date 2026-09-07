/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAddTrackCommand,
	createClipboardDescriptor,
	prepareDisjointRangeDeleteCommand,
	prepareGroupClipsCommand,
	prepareKeepRangeCommand,
	prepareLinkedSplitCommand,
	prepareRangeDeleteCommand,
	resolveEditingSelection,
} from '../commands.js';
import { createLabeledAudioClipboardPort } from '../labeled-audio-clipboard.ts';
import { createStableId, findClip, findClipTrack, findTrack } from '../project.js';
import { audioTrackChannelCount } from '../project-audio-factory.js';
import { createAbsentAudioGeneratorService } from './absent-audio-subsystems.ts';
import { saveLabelExport } from './app-helpers.ts';
import { createClipboardEditService } from './clipboard-edit-service.ts';
import type { EditCompositionDependencies, EditCompositionProject } from './edit-composition-types.ts';
import { createEditorEditService } from './edit-service.ts';
import { createAudioGeneratorService, type AudioGeneratorService } from './generator-service.ts';
import { createLabelService } from './label-service.ts';
import { bindControllerEditClipboardRuntime } from './project-runtime.ts';
import { bufferFromChannels, writeBuffer } from './source-audio.ts';
import { generateWaveformPeaks, peakCacheKey } from './waveform-analysis.ts';

export type {
	EditCommandProject,
	EditCompositionCopy,
	EditCompositionDependencies,
	EditCompositionProject,
	EditCompositionState,
} from './edit-composition-types.ts';

/**
 * Build the editing domain: label import and export, the clipboard edits
 * (split, paste, disjoin), the audio generators, and the edit dispatcher that
 * turns an Edit-menu action into commands on the command projection. The
 * generators are a refusing stand-in when the product does not compose them,
 * so the labeled-audio silence edit refuses the same way the menu does.
 */
export function createEditComposition(dependencies: EditCompositionDependencies) {
	const { state, copy, lifetime, projectGeneration, projectRuntime, engine, taskProgress } = dependencies;
	const requireProject = (): EditCompositionProject => {
		const project = dependencies.getProject();
		if (!project) throw new Error('Editing requires an open project.');
		return project;
	};

	const labels = createLabelService({
		lifetime,
		projectGeneration,
		state,
		copy,
		getProject: requireProject,
		editingBlocked: dependencies.editingBlocked,
		createId: createStableId,
		commit: dependencies.commit,
		setStatus: dependencies.setStatus,
		publish: dependencies.publishDocumentSnapshot,
		saveExport: (result) => saveLabelExport(result, dependencies.saveLabelFile, dependencies.fileService),
	});
	const clipboard = createClipboardEditService({
		lifetime,
		state,
		copy,
		session: dependencies.session,
		sourceBuffers: dependencies.sourceBuffers,
		getProject: dependencies.getCommandProject,
		editingBlocked: dependencies.editingBlocked,
		getPositionFrames: () => engine.getPositionFrames(),
		normalizeFrame: dependencies.normalizeTimelineFrame,
		snapFrame: dependencies.snapTimelineFrame,
		createId: createStableId,
		...bindControllerEditClipboardRuntime(projectRuntime, dependencies.getProject),
		commit: dependencies.commit,
		setStatus: dependencies.setStatus,
	});
	const generators: AudioGeneratorService = dependencies.composition.generators
		? createAudioGeneratorService({
			lifetime,
			projectGeneration,
			state,
			copy,
			store: dependencies.store,
			sourceBuffers: dependencies.sourceBuffers,
			sourcePeaks: dependencies.sourcePeaks,
			sourceChunkFrames: dependencies.sourceChunkFrames,
			getProject: requireProject,
			getCommandProject: dependencies.getCommandProject,
			editingBlocked: dependencies.editingBlocked,
			getPositionFrames: () => engine.getPositionFrames(),
			snapFrame: dependencies.snapTimelineFrame,
			trackChannelCount: audioTrackChannelCount,
			effectTargets: dependencies.effectTargets,
			persistEffectResults: dependencies.persistEffectResults,
			preflightStorage: dependencies.preflightStorage,
			getAudioContext: () => engine.getAudioContext({ resume: false }),
			createBuffer: (channels, sampleRate, context) => bufferFromChannels([...channels], sampleRate, context, copy),
			writeBuffer,
			cacheSourceBuffer: dependencies.cacheSourceBuffer,
			generatePeaks: (channels) => generateWaveformPeaks([...channels], copy),
			peakCacheKey,
			createId: createStableId,
			commit: dependencies.commit,
			setStatus: dependencies.setStatus,
			publish: dependencies.publishDocumentSnapshot,
		})
		: createAbsentAudioGeneratorService(dependencies.absentSubsystem);
	const generate = <Result>(work: () => Promise<Result>) => (
		taskProgress.run('generate', copy.generatingAudio, work)
	);

	/** The Edit menu's clipboard reads the product's own clipboard projection, not the raw command projection. */
	const clipboardProject = (commandProject: unknown) => (
		projectRuntime.projectForEditClipboardConsumers
			? projectRuntime.projectForEditClipboardConsumers(dependencies.getProject())
			: commandProject
	);
	const handleEdit = createEditorEditService({
		activeSelection: dependencies.activeSelection,
		commit: dependencies.commit,
		commitSplitAtFrames: clipboard.commitSplitAtFrames,
		compactLiveSourceState: dependencies.compactLiveSourceState,
		copy,
		createAddTrackCommand,
		createClipboardDescriptor: (commandProject: unknown, descriptorOptions: Parameters<typeof createClipboardDescriptor>[1]) => (
			projectRuntime.prepareEditClipboardDescriptor(
				dependencies.getProject(),
				createClipboardDescriptor(clipboardProject(commandProject), descriptorOptions),
			)
		),
		createStableId,
		labeledClipboard: createLabeledAudioClipboardPort({
			getProject: dependencies.getProject,
			getCommandProject: dependencies.getCommandProject,
			projectRuntime,
			createDescriptor: createClipboardDescriptor,
		}),
		disjoinLabeledRegions: clipboard.disjoinLabeledRegions,
		generateLabeledSilence: (...args: Parameters<AudioGeneratorService['generateLabeledSilence']>) => (
			generate(() => generators.generateLabeledSilence(...args))
		),
		editingBlocked: dependencies.editingBlocked,
		engine,
		findClip,
		findClipTrack,
		findTrack,
		garbageCollectSources: dependencies.garbageCollectSources,
		handleError: dependencies.handleError,
		normalizeTimelineFrame: dependencies.normalizeTimelineFrame,
		prepareControllerPaste: clipboard.prepareControllerPaste,
		prepareDisjointRangeDeleteCommand,
		prepareGroupClipsCommand,
		prepareKeepRangeCommand,
		prepareLinkedSplitCommand,
		prepareRangeDeleteCommand,
		getProject: dependencies.getCommandProject,
		projectChanged: dependencies.projectChanged,
		publishDocumentSnapshot: dependencies.publishDocumentSnapshot,
		redoEditorCommand: projectRuntime.redo,
		resolveEditingSelection,
		setSessionClipboard: clipboard.setSessionClipboard,
		state,
		undoEditorCommand: projectRuntime.undo,
	});

	return Object.freeze({
		labels,
		clipboard,
		generators,
		handleEdit,
		generateSelectionSilence: (...args: Parameters<AudioGeneratorService['generateSelectionSilence']>) => (
			generate(() => generators.generateSelectionSilence(...args))
		),
		generateSignal: (...args: Parameters<AudioGeneratorService['generateSignal']>) => (
			generate(() => generators.generateSignal(...args))
		),
		repeatLastGenerator: (...args: Parameters<AudioGeneratorService['repeatLast']>) => (
			generate(() => generators.repeatLast(...args))
		),
	});
}

export type EditComposition = ReturnType<typeof createEditComposition>;
