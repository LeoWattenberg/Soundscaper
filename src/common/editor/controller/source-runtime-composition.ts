/* SPDX-License-Identifier: AGPL-3.0-only */

import { findClip, findSource } from '../project.js';
import { createClipTimePitchCacheService, type ClipTimePitchRenderEngine } from './clip-time-pitch-service.ts';
import { createPlaybackProjectApplyService } from './playback-project-service.ts';
import { createProjectVisualService } from './project-visual-service.ts';
import {
	SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES,
	audioBufferChannels,
	bufferFromChannels,
	createStoredChunkProvider,
	isStreamableStoredSource,
	readStoredAudioBuffer,
	sourceAudioBufferBytes,
	sourcePcmBytes,
} from './source-audio.ts';
import { createSourceLifecycleService } from './source-lifecycle-service.ts';
import type {
	SourceRuntimeCompositionDependencies,
	SourceRuntimeProject,
} from './source-runtime-composition-types.ts';
import {
	clipSourceWindowRange,
	generateStoredWaveformPeaks,
	generateWaveformPeaks,
	legacyPeakCacheKey,
	peakCacheKey,
	readWaveformPcmWindow,
	waveformPcmWindowContains,
	waveformPeaksHaveRms,
} from './waveform-analysis.ts';

export type {
	SourceRuntimeCompositionCopy,
	SourceRuntimeCompositionDependencies,
	SourceRuntimeCompositionEngine,
	SourceRuntimeCompositionState,
	SourceRuntimeCompositionStore,
	SourceRuntimeProject,
} from './source-runtime-composition-types.ts';

/** How many waveform PCM windows stay resident, and how many frames each may span. */
const MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES = 262_144;
const MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES = 32;

type PlaybackApply = ReturnType<typeof createPlaybackProjectApplyService<SourceRuntimeProject, AudioBuffer>>;

/**
 * Build the source runtime: the visual data clips and video sources present,
 * the committed and playback time-pitch caches, the stored-source lifecycle
 * (activation, chunk providers, waveform PCM windows) and the step that
 * applies a document to the playback engine. The time-pitch service applies
 * projects through the playback step, which needs the lifecycle's source
 * loading, which needs the visual service's activation; the closure on the
 * playback step lets each be built after what it reads.
 */
export function createSourceRuntimeComposition<RenderEngine extends ClipTimePitchRenderEngine>(
	dependencies: SourceRuntimeCompositionDependencies<RenderEngine>,
) {
	const { state, copy, lifetime, store, engine, sourceBuffers, sourceChunkProviders, sourcePeaks } = dependencies;
	const waveformPcmWindows = new Map<string, unknown>();
	const waveformPcmRequests = new Map<string, unknown>();
	const requireProject = (): SourceRuntimeProject => {
		const project = dependencies.getProject();
		if (!project) throw new Error('The source runtime requires an open project.');
		return project;
	};
	const captureProject = (projectId: string) => dependencies.projectGeneration.capture(projectId);
	const assertProject = (token: ReturnType<typeof captureProject>) => dependencies.projectGeneration.assertCurrent(token);
	let playbackApply: PlaybackApply | null = null;

	const projectVisual = createProjectVisualService({
		getProject: dependencies.getProject,
		captureProject,
		assertProject,
		missingSourceIds: state.missingSourceIds,
		sourceBuffers,
		sourcePeaks,
		waveformPcmWindows,
		store,
		resolveProductVideoPreviewMedia: dependencies.resolveProductVideoPreviewMedia,
		projectDurationFrames: dependencies.projectDurationFrames,
		url: {
			createObjectURL: (blob) => globalThis.URL?.createObjectURL?.(blob) || null,
			revokeObjectURL: (url) => globalThis.URL?.revokeObjectURL?.(url),
		},
	});
	const timePitchCaches = createClipTimePitchCacheService<RenderEngine>({
		lifetime,
		state,
		cache: dependencies.timePitchCache,
		sourceResolver: dependencies.sourceResolver,
		sourceChunkProviders,
		getProject: requireProject,
		captureProject,
		assertProject,
		createBufferFromChannels: async (channels, sampleRate) => {
			const context = await engine.getAudioContext({ resume: false });
			return bufferFromChannels([...channels], sampleRate, context, copy);
		},
		createRenderEngine: dependencies.createRenderEngine,
		applyProjectToPlaybackEngine: (project) => {
			if (!playbackApply) throw new Error('The playback apply step is not composed yet.');
			return playbackApply.apply(project);
		},
		getPlaybackState: () => engine.getState().state,
		handleError: dependencies.handleError,
	});
	const sourceLifecycle = createSourceLifecycleService({
		MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES,
		MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES,
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES,
		activateVideoSource: (source, options) => projectVisual.activateVideoSource(source, options),
		allProjectClips: (project) => projectVisual.allProjectClips(project),
		audioBufferChannels,
		clipSourceWindowRange,
		clipWaveformPcmRequests: waveformPcmRequests,
		clipWaveformPcmWindows: waveformPcmWindows,
		copy,
		createStoredChunkProvider,
		engine,
		findClip,
		findSource,
		generateStoredWaveformPeaks,
		generateWaveformPeaks,
		getProject: dependencies.getProject,
		isStreamableStoredSource,
		legacyPeakCacheKey,
		peakCacheKey,
		publishDocumentSnapshot: dependencies.publishDocumentSnapshot,
		readStoredAudioBuffer,
		readWaveformPcmWindow,
		setStatus: dependencies.setStatus,
		sourceAudioBufferBytes,
		sourceBuffers,
		sourceChunkProviders,
		sourcePcmBytes,
		sourcePeaks,
		state,
		store,
		waveformPcmWindowContains,
		waveformPeaksHaveRms,
	});
	playbackApply = createPlaybackProjectApplyService<SourceRuntimeProject, AudioBuffer>({
		lifetime,
		projectForPlayback: dependencies.playbackProjects.projectForPlayback,
		getCurrentProject: dependencies.getProject,
		ensureProjectSourcesAvailable: sourceLifecycle.ensureProjectSourcesAvailable,
		prepareRequiredProjectSources: sourceLifecycle.prepareRequiredProjectSources,
		sourceBuffers,
		sourceChunkProviders,
		engine,
		setReadyStatus: () => dependencies.setStatus(copy.ready),
	});

	return Object.freeze({
		projectVisual,
		timePitchCaches,
		sourceLifecycle,
		playbackApply,
		/** Drop the resident waveform PCM windows and the requests still resolving them. */
		clearWaveformPcmCaches: () => {
			waveformPcmWindows.clear();
			waveformPcmRequests.clear();
		},
	});
}

export type SourceRuntimeComposition = ReturnType<typeof createSourceRuntimeComposition>;
