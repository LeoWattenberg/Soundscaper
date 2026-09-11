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
} from '../../commands.js';
import { createLabeledAudioClipboardPort } from '../../labeled-audio-clipboard.ts';
import { createStableId, findClip, findClipTrack, findTrack } from '../../project.js';
import { audioTrackChannelCount } from '../../project-audio-factory.js';
import { createAbsentAudioGeneratorService } from './internal/absent-audio-generator-service.ts';
import { saveLabelExport } from '../shared/app-helpers.ts';
import { createClipboardEditService } from './internal/clipboard-edit-service.ts';
import type { EditCompositionDependencies, EditCompositionProject } from './edit-composition-types.ts';
import { createEditorEditService } from './internal/edit-service.ts';
import { createAudioGeneratorService, type AudioGeneratorService } from './generator-service.ts';
import { createLabelService } from './internal/label-service.ts';
import { bindControllerEditClipboardRuntime, type ControllerRuntimeHistory } from '../document/project-runtime.ts';
import { bufferFromChannels, writeBuffer } from '../source/source-audio.ts';
import { generateWaveformPeaks, peakCacheKey } from '../source/waveform-analysis.ts';
import { EDITOR_PROJECT_TASK_SCOPE } from '../shared/lifecycle.ts';
import { commitMonoConvertingPasteCommand } from './paste-mono-conversion-service.ts';
import { commitPasteIntoExistingClipCommand } from './paste-existing-clip-service.ts';
import {
	completeDeleteBehaviorOnboarding,
	type ConfiguredDeleteEditAction,
	type DefaultDeleteEditAction,
} from './delete-behavior-onboarding-service.ts';
import { normalizeAudioEditorEditingPreferences } from '../../editing-preferences.ts';

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
export function createEditComposition<History extends ControllerRuntimeHistory>(dependencies: EditCompositionDependencies<History>) {
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
			setEffectProcessing: dependencies.setEffectProcessing,
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
			? projectRuntime.projectForEditClipboardConsumers(requireProject())
			: commandProject
	);
	const commitPreparedPaste = (command: Parameters<typeof commitMonoConvertingPasteCommand>[0]['command']) => {
		const project = dependencies.getCommandProject();
		const token = projectGeneration.capture(project.id);
		const revision = project.revision;
		const task = lifetime.startTask('edit-paste', { scope: EDITOR_PROJECT_TASK_SCOPE });
		const assertCurrent = () => {
			task.assertCurrent();
			projectGeneration.assertCurrent(token);
			const current = dependencies.getCommandProject();
			if (current.id !== project.id || current.revision !== revision) {
				throw new DOMException('The project changed while audio was being pasted.', 'AbortError');
			}
		};
		const commitExistingClipPaste = (prepared: Parameters<typeof commitPasteIntoExistingClipCommand>[0]['command']) => (
			commitPasteIntoExistingClipCommand({
				command: prepared,
				project,
				derivedSources: dependencies.derivedSources,
				preflightStorage: dependencies.preflightStorage,
				assertCurrent,
				commit: dependencies.commit,
			})
		);
		try {
			const result = commitMonoConvertingPasteCommand({
				command,
				project,
				alwaysConvertToMono: dependencies.state.preferences?.editing?.alwaysConvertToMono === true,
				derivedSources: dependencies.derivedSources,
				confirmConversion: (plan) => dependencies.confirmMonoConversion({
					title: copy.monoConversionTitle,
					body: copy.monoConversionPrompt,
					plan,
					signal: task.signal,
				}),
				preflightStorage: dependencies.preflightStorage,
				updateAlwaysConvertToMono: async () => {
					await dependencies.updatePreferences({ editing: { alwaysConvertToMono: true } });
				},
				assertCurrent,
				commit: commitExistingClipPaste,
			});
			if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
				return Promise.resolve(result).finally(task.finish);
			}
			task.finish();
			return result;
		} catch (error) {
			task.finish();
			throw error;
		}
	};
	const requestDeleteBehaviorChoice = (
		action: DefaultDeleteEditAction,
		apply: (configuredAction: ConfiguredDeleteEditAction) => unknown,
	) => {
		const project = dependencies.getCommandProject();
		const token = projectGeneration.capture(project.id);
		const revision = project.revision;
		const task = lifetime.startTask('edit-delete-behavior', { scope: EDITOR_PROJECT_TASK_SCOPE });
		const assertCurrent = () => {
			task.assertCurrent();
			projectGeneration.assertCurrent(token);
			const current = dependencies.getCommandProject();
			if (current.id !== project.id || current.revision !== revision) {
				throw new DOMException('The project changed while delete behavior was being chosen.', 'AbortError');
			}
		};
		const editing = normalizeAudioEditorEditingPreferences(state.preferences?.editing);
		return completeDeleteBehaviorOnboarding({
			action,
			title: copy.editingDeleteBehavior,
			initialCloseGapBehavior: editing.closeGapBehavior,
			signal: task.signal,
			confirm: dependencies.confirmDeleteBehavior,
			updatePreferences: (preference) => dependencies.updatePreferences({ editing: preference }),
			assertCurrent,
			apply,
		}).finally(task.finish);
	};
	const handleEdit = createEditorEditService({
		activeSelection: dependencies.activeSelection,
		commit: dependencies.commit,
		commitPreparedPaste,
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
		requestDeleteBehaviorChoice,
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
