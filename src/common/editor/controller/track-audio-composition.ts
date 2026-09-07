/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAiffStreamEncoder, encodeAiff } from '../aiff.js';
import { loadStoredSourceChannels } from '../clip-time-pitch-cache.js';
import { collectRelatedClipIds } from '../commands.js';
import { isAudacityRackEffectType, rackTailFrames } from '../effects.js';
import { createExportPlan } from '../export.js';
import { applyMediaChannelMapping } from '../media-export.js';
import { createStableId, findClip, findClipTrack, findSource, findTrack } from '../project.js';
import { audioTrackChannelCount } from '../project-audio-factory.js';
import { verifyProjectFallbackIntegrity } from '../project-fallback-integrity.ts';
import { RECORDING_DEFAULT_DEVICE_ID, RECORDING_DISPLAY_SOURCE_KEY, setRecordingTrackRoute } from '../recording-routing.js';
import { createStreamingWindowedSincResampler } from '../resample.js';
import { snapAudioEditorFrameWithProject } from '../snap-grid.js';
import { createVideoExportPlan } from '../video-export.js';
import { createWavStreamEncoder, encodeWav } from '../wav.js';
import { findNearestAudioZeroCrossing } from '../zero-crossing.js';
import { abortError, normalizeProjectSampleRate, throwIfAborted } from './app-helpers.ts';
import { createAudioWarpControllerComposition } from './audio-warp-composition.ts';
import { createDeferredEditorExportService } from './deferred-export-service.ts';
import { createDerivedAudioComposition } from './derived-audio-composition.ts';
import { createMixRenderService } from './mix-render-service.ts';
import { createSelectionViewService } from './selection-view-service.ts';
import {
	audioBufferChannels,
	bufferFromChannels,
	createCoalescingSourceWriter,
	resampleBuffer,
	resampleChannelsWindowedSinc,
	writeBuffer,
} from './source-audio.ts';
import { createStreamingStemArchive } from './stem-archive.ts';
import { createTakeCompControllerComposition } from './take-comp-composition.ts';
import { createTemporaryFileSink, stemProject } from './temporary-export.ts';
import type { TrackAudioCompositionDependencies, TrackAudioCompositionProject } from './track-audio-composition-types.ts';
import { createTrackActionAdapter } from './track-action-adapter.ts';
import { createEditorTrackService } from './track-service.ts';
import { generateWaveformPeaks, peakCacheKey } from './waveform-analysis.ts';

export type {
	TrackAudioCompositionCopy,
	TrackAudioCompositionDependencies,
	TrackAudioCompositionEngine,
	TrackAudioCompositionProject,
	TrackAudioCompositionState,
	TrackAudioCompositionStore,
	TrackAudioExportPorts,
} from './track-audio-composition-types.ts';

type DerivedAudio = ReturnType<typeof createDerivedAudioComposition>;
type MixRender = ReturnType<typeof createMixRenderService>;

/**
 * Build the track and audio-production domain: the derived-source rewrites
 * (resampling and channel rewrites), the track service and its action
 * adapter, the deferred export service whose snapshot renderer every other
 * render reads through, take comping, audio warp, mix-and-render, and the
 * selection and view service. The export renderer is built first because
 * comping, mixing and selection render through it.
 */
export function createTrackAudioComposition(dependencies: TrackAudioCompositionDependencies) {
	const { state, copy, lifetime, engine, store, taskProgress, microphoneMeter } = dependencies;
	const requireProject = (): TrackAudioCompositionProject => {
		const project = dependencies.getProject();
		if (!project) throw new Error('Track editing requires an open project.');
		return project;
	};
	const captureProject = () => dependencies.projectGeneration.capture(dependencies.getProject()?.id ?? null);
	const assertProject = (token: ReturnType<typeof captureProject>) => dependencies.projectGeneration.assertCurrent(token);
	const getAudioContext = () => engine.getAudioContext({ resume: false });
	const createBufferFromChannels = (channels: Float32Array[], sampleRate: number, context: unknown) => (
		bufferFromChannels(channels, sampleRate, context as Parameters<typeof bufferFromChannels>[2], copy)
	);
	const setProcessing = (processing: boolean) => { state.audacityEffectProcessing = processing; };

	const derivedAudio: DerivedAudio = createDerivedAudioComposition({
		lifetime,
		copy,
		store,
		retireSourceChunkProvider: dependencies.retireSourceChunkProvider,
		sourceBuffers: dependencies.sourceBuffers,
		sourcePeaks: dependencies.sourcePeaks,
		sourceChunkFrames: dependencies.sourceChunkFrames,
		getProject: requireProject,
		getSelectedTrackId: () => state.selectedTrackId,
		getSelectedClipId: () => state.selectedClipId,
		editingBlocked: dependencies.editingBlocked,
		captureProject,
		assertProject,
		createId: createStableId,
		commit: dependencies.commit,
		projectSampleRate: dependencies.projectSampleRate,
		normalizeProjectSampleRate,
		audioTrackChannelCount,
		preflightStorage: dependencies.preflightStorage,
		getAudioContext,
		createBufferFromChannels,
		loadSourceChannels: (source) => loadStoredSourceChannels(store, source),
		writeBuffer,
		generateWaveformPeaks: (channels) => generateWaveformPeaks(channels, copy),
		peakCacheKey,
		cacheSourceBuffer: dependencies.cacheSourceBuffer,
		setProcessing,
		setStatus: dependencies.setStatus,
		publish: dependencies.publishDocumentSnapshot,
		resampleChannels: resampleChannelsWindowedSinc,
		renderDryTrackRange: dependencies.renderDryTrackRange,
	});
	const track = createEditorTrackService({
		lifetime,
		copy,
		trackColors: dependencies.trackColors,
		getProject: requireProject,
		getSelectedTrackId: () => state.selectedTrackId,
		editingBlocked: dependencies.editingBlocked,
		createId: createStableId,
		commit: dependencies.commit,
		getPositionFrames: () => engine.getPositionFrames(),
		snapTimelineFrame: (frame) => selectionView.snapTimelineFrame(frame),
		setTimelineView: (value) => { state.timelineView = value; },
		resampleTrack: (...args) => derivedAudio.resampleTrack(...args),
		recording: {
			defaultDeviceId: RECORDING_DEFAULT_DEVICE_ID,
			displaySourceKey: RECORDING_DISPLAY_SOURCE_KEY,
			getRouting: () => state.recordingRouting,
			setRouting: (routing) => { state.recordingRouting = routing; },
			getPreferredDeviceId: () => state.preferredInputDeviceId,
			getPreferredChannelCount: () => state.preferredInputChannelCount,
			getDevices: () => state.recordingDevices,
			getPoolSources: () => state.recordingPoolSources,
			setTrackRoute: setRecordingTrackRoute,
			setRouteHealth: (trackId, health) => { state.recordingRouteHealth[trackId] = health; },
			updateDeviceRows: dependencies.updateRecordingDeviceRows,
			persistRouting: dependencies.persistRecordingRouting,
			publish: dependencies.publishDocumentSnapshot,
		},
	});
	const trackActions = createTrackActionAdapter({
		service: track,
		getSelectedTrackId: () => state.selectedTrackId,
		projectSampleRate: dependencies.projectSampleRate,
	});
	const exportService = createDeferredEditorExportService({
		abortError,
		applyMediaChannelMapping,
		audioBufferChannels,
		cloneProject: dependencies.projectRuntime.cloneProject,
		copy,
		createAiffStreamEncoder,
		createCacheAwareRenderEngine: dependencies.createRenderEngine,
		createExportPlan,
		createStableId,
		createStreamingStemArchive,
		createStreamingWindowedSincResampler,
		createTemporaryFileSink,
		createVideoExportPlan,
		createWavStreamEncoder,
		encodeAiff,
		encodeWav,
		ffmpeg: dependencies.export.ffmpeg,
		fileService: dependencies.export.fileService,
		findClip,
		findSource,
		handleError: dependencies.handleError,
		hasMissingTimelineSources: dependencies.hasMissingTimelineSources,
		lifetime,
		normalizeExportSettings: dependencies.export.normalizeExportSettings,
		playbackProjects: dependencies.export.playbackProjects,
		normalizeProjectSampleRate,
		options: dependencies.controllerOptions,
		preflightStorage: dependencies.preflightStorage,
		prepareCommittedTimePitchCaches: dependencies.prepareCommittedTimePitchCaches,
		getProject: dependencies.getProject,
		productName: dependencies.export.productName,
		projectGeneration: dependencies.projectGeneration,
		projectSampleRate: dependencies.projectSampleRate,
		publishDocumentSnapshot: dependencies.publishDocumentSnapshot,
		prepareProjectForExport: dependencies.export.prepareProjectForExport,
		resampleBuffer,
		setStatus: dependencies.setStatus,
		sourceBuffers: dependencies.sourceBuffers,
		sourceChunkProviders: dependencies.sourceChunkProviders,
		state,
		stemProject,
		store,
		throwIfAborted,
		toggleExport: dependencies.export.toggleExport,
		updateExportProgress: dependencies.export.updateExportProgress,
		taskProgress,
		setPersistentExportProgressObserver: dependencies.export.setPersistentExportProgressObserver,
		verifyProjectFallbackIntegrity,
	});
	const takeComp = createTakeCompControllerComposition({
		lifetime,
		sourceBuffers: dependencies.sourceBuffers,
		sourceChunkProviders: dependencies.sourceChunkProviders,
		sourceResolver: dependencies.sourceResolver,
		derivedSources: derivedAudio.derivedSources,
		getProject: requireProject,
		editingBlocked: dependencies.editingBlocked,
		commit: dependencies.commit,
		createId: createStableId,
		captureProject,
		assertProject,
		createPreviewEngine: dependencies.createPreviewEngine,
		stopPlayback: () => engine.stop(),
		renderSnapshot: exportService.renderSnapshot,
		setStatus: dependencies.setStatus,
	});
	const audioWarp = createAudioWarpControllerComposition({
		lifetime,
		store,
		getProject: requireProject,
		getSelectedClipId: () => state.selectedClipId,
		editingBlocked: dependencies.editingBlocked,
		commit: dependencies.commit,
		captureProject,
		assertProject,
		getRenderStatus: () => engine.getAudioWarpRenderStatus(),
		setAnalysisProcessing: (processing) => { state.analysisProcessing = processing; },
		publish: dependencies.publishDocumentSnapshot,
	});
	const mixRender: MixRender = createMixRenderService({
		lifetime,
		copy,
		derivedSources: derivedAudio.derivedSources,
		store,
		sourceBuffers: dependencies.sourceBuffers,
		sourceChunkFrames: dependencies.sourceChunkFrames,
		memoryLimitBytes: dependencies.mixRenderMemoryLimitBytes,
		getProject: requireProject,
		getSelectedTrackId: () => state.selectedTrackId,
		getSelectedClipId: () => state.selectedClipId,
		editingBlocked: dependencies.editingBlocked,
		captureProject,
		assertProject,
		createId: createStableId,
		commit: dependencies.commit,
		preflightStorage: dependencies.preflightStorage,
		setProcessing,
		setStatus: dependencies.setStatus,
		publish: dependencies.publishDocumentSnapshot,
		handleError: dependencies.handleError,
		rackTailFrames,
		isFixedStereoEffect: isAudacityRackEffectType,
		renderSnapshot: exportService.renderSnapshot,
		getAudioContext,
		createBufferFromChannels,
		createRenderEngine: dependencies.createRenderEngine,
		createStreamingWriter: createCoalescingSourceWriter,
		prepareCommittedTimePitchCaches: dependencies.prepareCommittedTimePitchCaches,
		activateStoredSource: dependencies.activateStoredSource,
		previewCommand: (candidate, command) => dependencies.projectRuntime.applyCommand(candidate, command),
	});
	const selectionView = createSelectionViewService({
		DEFAULT_PIXELS_PER_SECOND: dependencies.defaultPixelsPerSecond,
		MAX_PIXELS_PER_SECOND: dependencies.maximumPixelsPerSecond,
		activeSelection: dependencies.activeSelection,
		audioBufferChannels,
		cloneProject: dependencies.projectRuntime.cloneProject,
		collectRelatedClipIds,
		commit: dependencies.commit,
		copy,
		editorTimelineDurationFrames: dependencies.editorTimelineDurationFrames,
		engine,
		findClip,
		findClipTrack,
		findNearestAudioZeroCrossing,
		findTrack,
		getProject: dependencies.getProject,
		handleError: dependencies.handleError,
		normalizeTimelineFrame: dependencies.normalizeTimelineFrame,
		persistSetting: dependencies.persistSetting,
		productSettingKey: dependencies.productSettingKey,
		projectDurationFrames: dependencies.projectDurationFrames,
		projectSampleRate: dependencies.projectSampleRate,
		publishDocumentSnapshot: dependencies.publishDocumentSnapshot,
		publishProjectState: dependencies.publishProjectState,
		renderSnapshot: exportService.renderSnapshot,
		resetRoutedInputMeter: microphoneMeter.clearRoutedLoudnessMeter,
		setStatus: dependencies.setStatus,
		snapAudioEditorFrameWithProject,
		state,
		synchronizeAutomaticSampleEditMode: dependencies.synchronizeAutomaticSampleEditMode,
		synchronizeMicrophoneMeterTarget: microphoneMeter.synchronizeTarget,
		updatePlayhead: dependencies.updatePlayhead,
		updateSelection: dependencies.updateSelection,
	});

	const transform = (label: string | undefined) => label || copy.audacityProcessing;
	return Object.freeze({
		derivedAudio,
		track,
		trackActions,
		export: exportService,
		takeComp,
		audioWarp,
		mixRender,
		selectionView,
		mixAndRenderTracks: (...args: Parameters<MixRender['mixAndRenderTracks']>) => (
			taskProgress.run('render', copy.rendering, () => mixRender.mixAndRenderTracks(...args))
		),
		resampleTrack: (trackId: string | null = state.selectedTrackId, requestedSampleRate: unknown = dependencies.projectSampleRate()) => (
			taskProgress.run('transform', transform(copy.resamplingTrack), () => derivedAudio.resampleTrack(trackId, requestedSampleRate))
		),
		resampleClip: (clipId: string | null = state.selectedClipId, request: Parameters<DerivedAudio['resampleClip']>[1] = {}) => (
			taskProgress.run('transform', transform(copy.resamplingClip), () => derivedAudio.resampleClip(clipId, request))
		),
		swapTrackChannels: (trackId: string | null = state.selectedTrackId) => (
			taskProgress.run('transform', transform(copy.rewritingChannels), () => derivedAudio.swapTrackChannels(trackId))
		),
		splitStereoTrack: (trackId: string | null = state.selectedTrackId, panChannels = true) => (
			taskProgress.run('transform', transform(copy.rewritingChannels), () => derivedAudio.splitStereoTrack(trackId, panChannels))
		),
		makeStereoTrack: (trackId: string | null = state.selectedTrackId, partnerTrackId: string | null = null) => (
			taskProgress.run('transform', transform(copy.rewritingChannels), () => derivedAudio.makeStereoTrack(trackId, partnerTrackId))
		),
	});
}

export type TrackAudioComposition = ReturnType<typeof createTrackAudioComposition>;
