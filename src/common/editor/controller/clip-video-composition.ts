/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAddSourceCommand, createReplaceClipSourceCommand } from '../commands.js';
import { prepareThreePointEditCommand } from '../commands/three-point-edit-runtime.js';
import { createStableId, findClip, findClipTrack, findSource } from '../project.js';
import {
	canEditAudioSamplesAtZoom,
	createPencilSampleEdits,
	createSmoothSampleRange,
	persistImmutableSampleEdit,
} from '../sample-edit.js';
import { createAudioEditorVideoFrameExtractor } from '../video-media.js';
import { throwIfAborted } from './app-helpers.ts';
import type { ClipVideoCompositionDependencies, ClipVideoCompositionProject } from './clip-video-composition-types.ts';
import { createClipPropertyService, type ClipAnalysisResult } from './clip-property-service.ts';
import { createClipTimePitchRenderService } from './clip-time-pitch-render-service.ts';
import { createClipTransformService } from './clip-transform-service.ts';
import { createSampleEditService } from './sample-edit-service.ts';
import { createSequenceTimingService } from './sequence-timing-service.ts';
import { createSourceMonitorService } from './source-monitor-service.ts';
import { writeBuffer } from './source-audio.ts';
import { createVideoEditService } from './video-edit-service.ts';
import { createVideoEffectService } from './video-effect-service.ts';
import { createVideoNavigationService } from './video-navigation-service.ts';
import { createVideoRetimeProgramStateResolver } from './video-retime-program-state.ts';
import { createVideoSourceReprobeService } from './video-source-reprobe-service.ts';
import { createVideoTrimServices } from './video-trim-composition.ts';
import { analyzeChannelsInWorker, generateWaveformPeaks, peakCacheKey } from './waveform-analysis.ts';

export type {
	ClipVideoCommandProject,
	ClipVideoCompositionCopy,
	ClipVideoCompositionDependencies,
	ClipVideoCompositionEngine,
	ClipVideoCompositionProject,
	ClipVideoCompositionState,
	ClipVideoCompositionStore,
} from './clip-video-composition-types.ts';

/** Frames analysed per worker chunk when a clip's audio is inspected. */
const CLIP_ANALYSIS_CHUNK_FRAMES = 65_536;

type SampleEdit = ReturnType<typeof createSampleEditService>;
type ClipTimePitchRender = ReturnType<typeof createClipTimePitchRenderService>;

/**
 * Build the clip and video domain: sequence timing, the source monitor and
 * three-point video edits, JKL navigation, the frame-canonical trims, video
 * source reprobing, sample editing, clip transforms and properties, the
 * committed time-pitch render, and video clip effects. The edit and navigation
 * services read the command projection; the rest read the document identity.
 */
export function createClipVideoComposition(dependencies: ClipVideoCompositionDependencies) {
	const { state, copy, engine, lifetime, taskProgress } = dependencies;
	const requireProject = (): ClipVideoCompositionProject => {
		const project = dependencies.getProject();
		if (!project) throw new Error('Clip editing requires an open project.');
		return project;
	};
	const captureProject = () => dependencies.projectGeneration.capture(dependencies.getProject()?.id ?? null);
	const assertProject = (token: ReturnType<typeof captureProject>) => dependencies.projectGeneration.assertCurrent(token);
	const seek = (frame: number) => engine.seek(dependencies.normalizePlaybackFrame(frame));

	const sequenceTiming = createSequenceTimingService({
		lifetime,
		getProject: dependencies.getProject,
		editingBlocked: dependencies.editingBlocked,
		commit: dependencies.commit,
		publishProjectState: dependencies.publishProjectState,
		getPositionFrames: () => engine.getPositionFrames(),
		seek,
	});
	const sourceMonitor = createSourceMonitorService({
		lifetime,
		getProject: dependencies.getCommandProject,
		publishProjectState: dependencies.publishProjectState,
	});
	const getVideoRetimeProgramState = createVideoRetimeProgramStateResolver({
		getProject: dependencies.getProject,
		projectRuntime: dependencies.projectRuntime,
		createBridge: dependencies.createVideoRetimeProgramOrdinalBridge,
	});
	const videoEdit = createVideoEditService({
		lifetime,
		getProject: dependencies.getCommandProject,
		editingBlocked: dependencies.editingBlocked,
		commit: dependencies.commit,
		publishProjectState: dependencies.publishProjectState,
		getSelectedTrackId: () => state.selectedTrackId,
		prepareThreePointEditCommand: (commandProject, options) => (
			prepareThreePointEditCommand(commandProject, options, createStableId)
		),
		getPositionFrames: () => engine.getPositionFrames(),
		getVideoRetimeProgramState,
		sourceMonitor,
	});
	const videoNavigation = createVideoNavigationService({
		lifetime,
		getProject: dependencies.getCommandProject,
		getProjectIdentity: dependencies.getProject,
		getTargets: () => videoEdit.targets(),
		getPositionFrames: () => engine.getPositionFrames(),
		now: dependencies.monotonicNow ?? (() => globalThis.performance?.now?.() ?? dependencies.currentTimeMs()),
		setInterval: dependencies.setInterval,
		clearInterval: dependencies.clearInterval,
		scrub: async (frame) => {
			dependencies.cancelPlaybackCachePreparation();
			dependencies.cancelPlayAtSpeedPreparation();
			engine.pause();
			const previewStop = dependencies.stopProjectBinPreview();
			const target = dependencies.normalizePlaybackFrame(frame);
			const result = dependencies.hasMissingTimelineSources() || typeof engine.scrub !== 'function'
				? engine.seek(target)
				: engine.scrub(target);
			await previewStop;
			return result;
		},
		seek,
		endScrub: () => engine.endScrub?.(),
		publish: dependencies.publishDocumentSnapshot,
		handleError: dependencies.handleError,
	});
	const videoTrim = createVideoTrimServices({
		lifetime,
		getProject: dependencies.getCommandProject,
		editingBlocked: dependencies.editingBlocked,
		commit: dependencies.commit,
		copy,
		label: sequenceTiming.label,
		setStatus: dependencies.setStatus,
	});
	const videoSourceReprobe = createVideoSourceReprobeService({
		lifetime,
		store: dependencies.store,
		ffmpeg: dependencies.ffmpeg,
		helperTimingProbe: dependencies.helperTimingProbe,
		getProject: requireProject,
		editingBlocked: dependencies.editingBlocked,
		commit: dependencies.commit,
		publishProjectState: dependencies.publishProjectState,
		captureProject: () => dependencies.projectGeneration.capture(),
		assertProject,
		createAudioEditorVideoFrameExtractor,
		activateVideoSource: (source, options) => dependencies.activateVideoSource(source, options),
	});
	const sampleEdit: SampleEdit = createSampleEditService({
		lifetime,
		activeSelection: dependencies.activeSelection,
		activateStoredSource: dependencies.activateStoredSource,
		canEditAudioSamplesAtZoom,
		commit: dependencies.commit,
		copy,
		createAddSourceCommand,
		createPencilSampleEdits,
		createReplaceClipSourceCommand,
		createSmoothSampleRange,
		createStableId,
		editingBlocked: dependencies.editingBlocked,
		findClip,
		findClipTrack,
		findSource,
		getProject: dependencies.getProject,
		peakCacheKey,
		persistImmutableSampleEdit,
		preflightStorage: dependencies.preflightStorage,
		projectSampleRate: dependencies.projectSampleRate,
		publishDocumentSnapshot: dependencies.publishDocumentSnapshot,
		setStatus: dependencies.setStatus,
		retireSourceChunkProvider: dependencies.retireSourceChunkProvider,
		sourceBuffers: dependencies.sourceBuffers,
		sourcePeaks: dependencies.sourcePeaks,
		state,
		store: dependencies.store,
		throwIfAborted,
	});
	const clipTransform = createClipTransformService({
		lifetime,
		copy,
		getProject: dependencies.getCommandProject,
		getSelectedClipId: () => state.selectedClipId,
		editingBlocked: dependencies.editingBlocked,
		createId: createStableId,
		snapTimelineFrame: dependencies.snapTimelineFrame,
		activeSelection: dependencies.activeSelection,
		commit: dependencies.commit,
	});
	const clipProperty = createClipPropertyService({
		lifetime,
		copy,
		sourceBuffers: dependencies.sourceBuffers,
		getProject: requireProject,
		getSelectedClipId: () => state.selectedClipId,
		editingBlocked: dependencies.editingBlocked,
		captureProject,
		assertProject,
		analyzeChannels: async (channels, sampleRate, signal) => clipAnalysisResult(
			await analyzeChannelsInWorker([...channels], sampleRate, copy, CLIP_ANALYSIS_CHUNK_FRAMES, signal),
		),
		createId: createStableId,
		commit: dependencies.commit,
	});
	const clipTimePitchRender: ClipTimePitchRender = createClipTimePitchRenderService({
		lifetime,
		copy,
		store: dependencies.store,
		sourceBuffers: dependencies.sourceBuffers,
		sourcePeaks: dependencies.sourcePeaks,
		sourceChunkFrames: dependencies.sourceChunkFrames,
		getProject: requireProject,
		getSelectedClipId: () => state.selectedClipId,
		editingBlocked: dependencies.editingBlocked,
		captureProject,
		assertProject,
		prepareCommittedOutput: (clip, source, { signal }) => dependencies.prepareCommittedOutput(clip, source, {
			signal,
			onProgress: (value) => taskProgress.updateActive(value),
		}),
		materializeEntry: dependencies.materializeTimePitchCacheEntry,
		preflightStorage: dependencies.preflightStorage,
		createId: createStableId,
		writeBuffer,
		generateWaveformPeaks: (channels) => generateWaveformPeaks([...channels], copy),
		peakCacheKey,
		cacheSourceBuffer: dependencies.cacheSourceBuffer,
		commit: dependencies.commit,
		setProcessing: (processing) => { state.audacityEffectProcessing = processing; },
		setStatus: dependencies.setStatus,
		publish: dependencies.publishDocumentSnapshot,
	});
	const videoEffect = createVideoEffectService({
		state,
		copy,
		getProject: dependencies.getProject,
		captureProject,
		assertProject,
		editingBlocked: dependencies.editingBlocked,
		commit: dependencies.commit,
		publishDocumentSnapshot: dependencies.publishDocumentSnapshot,
	});

	return Object.freeze({
		sequenceTiming,
		sourceMonitor,
		videoEdit,
		videoNavigation,
		videoTrim,
		videoSourceReprobe,
		sampleEdit,
		clipTransform,
		clipProperty,
		clipTimePitchRender,
		videoEffect,
		getVideoRetimeProgramState,
		applySamplePencil: (...args: Parameters<SampleEdit['applySamplePencil']>) => (
			taskProgress.run('sample-edit', copy.sampleEditSaving, () => sampleEdit.applySamplePencil(...args))
		),
		smoothSelectedSamples: (...args: Parameters<SampleEdit['smoothSelectedSamples']>) => (
			taskProgress.run('sample-edit', copy.sampleEditSaving, () => sampleEdit.smoothSelectedSamples(...args))
		),
		renderClipPitchSpeed: (...args: Parameters<ClipTimePitchRender['renderClipPitchSpeed']>) => (
			taskProgress.run('render', copy.rendering, () => clipTimePitchRender.renderClipPitchSpeed(...args))
		),
	});
}

export type ClipVideoComposition = ReturnType<typeof createClipVideoComposition>;

/** The analysis worker answers with an untyped message; the clip service reads exactly these two measurements. */
function clipAnalysisResult(analysis: unknown): ClipAnalysisResult {
	const { peakAmplitude, integratedLufs } = (analysis ?? {}) as Partial<ClipAnalysisResult>;
	if (typeof peakAmplitude !== 'number' || typeof integratedLufs !== 'number') {
		throw new TypeError('Clip analysis returned no peak or loudness measurement.');
	}
	return { peakAmplitude, integratedLufs };
}
