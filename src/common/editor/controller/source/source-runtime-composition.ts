/* SPDX-License-Identifier: AGPL-3.0-only */

import { findClip, findSource } from '../../project.js'; import { setLocalizedStatus } from '../../../i18n/presentation-message.ts';
import { createClipTimePitchCacheService, type ClipTimePitchRenderEngine } from './clip-time-pitch-service.ts';
import { createPlaybackProjectApplyService } from './playback-project-service.ts';
import { createProjectVisualService } from '../document/project-visual-service.ts';
import type {
	FrequencyWaveformRequestOptions as FrequencyWaveformAnalysisRequestOptions,
	FrequencyWaveformRuntimeEntry,
} from './frequency-waveform-source-service.ts';
import type {
	FrequencyWaveformRuntimeWindowEntry,
	FrequencyWaveformWindowRequestOptions,
} from './frequency-waveform-window-service.ts';
import type { createFrequencyWaveformRuntime } from './frequency-waveform-runtime-composition.ts';
import {
	SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES,
	audioBufferChannels,
	bufferFromChannels,
	createStoredChunkProvider,
	isStoredAudioSource,
	isStoredSourceMetadata,
	isStreamableStoredSource,
	readStoredAudioBuffer,
	sourceAudioBufferBytes,
	sourcePcmBytes,
	type AudioBufferContext,
} from './source-audio.ts';
import {
	createSourceLifecycleService,
	type SourceLifecycleCopy,
	type SourceLifecycleServiceRuntime,
	type SourceLifecycleSource,
	type SourceLifecycleWaveformPeakRequest,
	type SourceLifecycleWaveformPeakWindow,
	type SourceLifecycleWaveformPcmRequest,
	type SourceLifecycleWaveformPcmWindow,
} from './source-lifecycle-service.ts';
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
	readWaveformPeakWindow,
	readWaveformPcmWindow,
	waveformPcmWindowContains,
	waveformPeaksHaveRms,
	type WorkerCopy,
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
// Keep the optional analysis contract lazy; this mirrors FREQUENCY_WAVEFORM_CACHE_PREFIX.
const FREQUENCY_WAVEFORM_CACHE_PREFIX = 'audio-editor-frequency-waveform-v1:';

type PlaybackApply = ReturnType<typeof createPlaybackProjectApplyService<SourceRuntimeProject, AudioBuffer>>;
type StoredChunkProvider = ReturnType<typeof createStoredChunkProvider>;
type SourceLifecycleRuntime = SourceLifecycleServiceRuntime<
	AudioBuffer,
	SourceRuntimeProject,
	StoredChunkProvider
>;
type FrequencyWaveformRuntime = ReturnType<typeof createFrequencyWaveformRuntime>;
type FrequencyWaveformRuntimeRequestOptions = FrequencyWaveformAnalysisRequestOptions
	& FrequencyWaveformWindowRequestOptions;

function requireStoredAudioSource(source: SourceLifecycleSource) {
	if (!isStoredAudioSource(source)) {
		throw new TypeError(`Source ${source.id} has no valid stored PCM geometry.`);
	}
	return source;
}

function requireWorkerCopy(copy: SourceLifecycleCopy): WorkerCopy {
	if (typeof copy.audioAnalysisWorkerFailed !== 'string'
		|| typeof copy.audioAnalysisFailed !== 'string') {
		throw new TypeError('The source lifecycle requires waveform worker error copy.');
	}
	return {
		get audioAnalysisWorkerFailed() { return copy.audioAnalysisWorkerFailed!; },
		get audioAnalysisFailed() { return copy.audioAnalysisFailed!; },
	};
}

function audioBufferContext(value: unknown): AudioBufferContext<AudioBuffer> | null | undefined {
	if (value == null) return value;
	if (isAudioBufferContext(value)) return value;
	throw new TypeError('The source lifecycle received an invalid audio buffer context.');
}

function isAudioBufferContext(value: unknown): value is AudioBufferContext<AudioBuffer> {
	return typeof value === 'object' && value !== null
		&& (!('createBuffer' in value) || value.createBuffer === undefined
			|| typeof value.createBuffer === 'function');
}

function waveformChunk(value: unknown) {
	const directChannels = float32Channels(value);
	if (directChannels) return directChannels;
	if (!value || typeof value !== 'object' || !('channels' in value)) {
		throw new TypeError('A stored waveform chunk requires planar PCM channels.');
	}
	const channels = float32Channels(value.channels);
	if (!channels) throw new TypeError('A stored waveform chunk requires planar PCM channels.');
	if (!('frames' in value) || value.frames === undefined) return { channels };
	if (!Number.isSafeInteger(value.frames) || Number(value.frames) < 0) {
		throw new TypeError('A stored waveform chunk requires a valid frame count.');
	}
	return { channels, frames: Number(value.frames) };
}

function float32Channels(value: unknown): Float32Array[] | null {
	if (!Array.isArray(value)) return null;
	const channels: Float32Array[] = [];
	for (const channel of value) {
		if (!(channel instanceof Float32Array)) return null;
		channels.push(channel);
	}
	return channels;
}

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
	const lifecycleAdapters: Pick<SourceLifecycleRuntime,
		| 'createStoredChunkProviderCandidate'
		| 'generateStoredWaveformPeaks'
		| 'generateWaveformPeaks'
		| 'readStoredAudioBuffer'
		| 'readWaveformPeakWindow'
		| 'readWaveformPcmWindow'
	> = {
		createStoredChunkProviderCandidate: (source, metadata) => {
			if (!isStoredSourceMetadata(metadata)
				|| !isStreamableStoredSource(source, metadata)) return null;
			return createStoredChunkProvider(store, source, metadata);
		},
		generateStoredWaveformPeaks: (_store, source, workerCopy, options) => (
			generateStoredWaveformPeaks(store, requireStoredAudioSource(source), requireWorkerCopy(workerCopy), options)
		),
		generateWaveformPeaks: (channels, workerCopy) => (
			generateWaveformPeaks([...channels], requireWorkerCopy(workerCopy))
		),
		readStoredAudioBuffer: (_store, source, context) => (
			readStoredAudioBuffer<AudioBuffer>(store, source, audioBufferContext(context))
		),
		readWaveformPcmWindow: (provider, range, options) => readWaveformPcmWindow({
			channelCount: provider.channelCount,
			chunkFrames: provider.chunkFrames,
			readStorageChunk: async (chunkIndex, context) => waveformChunk(
				await provider.readStorageChunk(chunkIndex, context?.signal ? { signal: context.signal } : {}),
			),
		}, range, options),
		readWaveformPeakWindow: (provider, range, options) => readWaveformPeakWindow({
			channelCount: provider.channelCount,
			chunkFrames: provider.chunkFrames,
			readStorageChunk: async (chunkIndex) => waveformChunk(
				await provider.readStorageChunk(chunkIndex),
			),
		}, range, { ...options, maximumChannels: 2 }),
	};
	const waveformPeakWindows = new Map<string, SourceLifecycleWaveformPeakWindow>();
	const waveformPeakRequests = new Map<string, SourceLifecycleWaveformPeakRequest>();
	const waveformPcmWindows = new Map<string, SourceLifecycleWaveformPcmWindow>();
	const waveformPcmRequests = new Map<string, SourceLifecycleWaveformPcmRequest>();
	const sourceFrequencyAnalyses = new Map<string, FrequencyWaveformRuntimeEntry>();
	const sourceFrequencyWindows = new Map<string, FrequencyWaveformRuntimeWindowEntry>();
	const persistentFrequencyWaveformCacheBypass = new Set<string>();
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
		waveformPeakWindows,
		waveformPcmWindows,
		sourceFrequencyAnalyses,
		sourceFrequencyWindows,
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
		playbackCacheState: dependencies.playbackCacheState,
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
	const baseSourceLifecycle = createSourceLifecycleService<AudioBuffer, SourceRuntimeProject, StoredChunkProvider>({
		MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES,
		MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES,
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES,
		activateVideoSource: (source, options) => projectVisual.activateVideoSource(source, options),
		allProjectClips: (project) => projectVisual.allProjectClips(project),
		audioBufferChannels,
		clipSourceWindowRange,
		clipWaveformPeakRequests: waveformPeakRequests,
		clipWaveformPeakWindows: waveformPeakWindows,
		clipWaveformPcmRequests: waveformPcmRequests,
		clipWaveformPcmWindows: waveformPcmWindows,
		copy,
		createStoredChunkProviderCandidate: lifecycleAdapters.createStoredChunkProviderCandidate,
		engine,
		findClip,
		findSource,
		generateStoredWaveformPeaks: lifecycleAdapters.generateStoredWaveformPeaks,
		generateWaveformPeaks: lifecycleAdapters.generateWaveformPeaks,
		getProject: dependencies.getProject,
		legacyPeakCacheKey,
		peakCacheKey,
		publishDocumentSnapshot: dependencies.publishDocumentSnapshot,
		readStoredAudioBuffer: lifecycleAdapters.readStoredAudioBuffer,
		readWaveformPeakWindow: lifecycleAdapters.readWaveformPeakWindow,
		readWaveformPcmWindow: lifecycleAdapters.readWaveformPcmWindow,
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
	let frequencyWaveformRuntime: FrequencyWaveformRuntime | null = null;
	let frequencyWaveformRuntimePromise: Promise<FrequencyWaveformRuntime> | null = null;
	let frequencyWaveformRuntimeGeneration = 0;
	const loadFrequencyWaveformRuntime = (): Promise<FrequencyWaveformRuntime> => {
		if (frequencyWaveformRuntime) return Promise.resolve(frequencyWaveformRuntime);
		if (frequencyWaveformRuntimePromise) return frequencyWaveformRuntimePromise;
		const generationAtLoad = frequencyWaveformRuntimeGeneration;
		const promise = import('./frequency-waveform-runtime-composition.ts')
			.then(({ createFrequencyWaveformRuntime }) => {
				const runtime = createFrequencyWaveformRuntime({
					getProject: dependencies.getProject,
					publishDocumentSnapshot: dependencies.publishDocumentSnapshot,
					sourceBuffers,
					sourceFrequencyAnalyses,
					sourceFrequencyWindows,
					persistentCacheBypassSourceIds: persistentFrequencyWaveformCacheBypass,
					store,
					requestPcmWindow: async (clipId, options) => {
						const window = await baseSourceLifecycle.requestWaveformPcmWindow(clipId, options);
						return window && !('blockSize' in window) ? window : null;
					},
				});
				if (generationAtLoad !== frequencyWaveformRuntimeGeneration) runtime.clearRuntime();
				frequencyWaveformRuntime = runtime;
				return runtime;
			}).catch((error: unknown) => {
				if (frequencyWaveformRuntimePromise === promise) frequencyWaveformRuntimePromise = null;
				throw error;
			});
		frequencyWaveformRuntimePromise = promise;
		return promise;
	};
	const frequencyWaveforms = Object.freeze({
		requestFrequencyWaveform: async (
			clipId: string,
			options: FrequencyWaveformRuntimeRequestOptions = {},
		) => {
			const generation = frequencyWaveformRuntimeGeneration;
			try {
				const runtime = await loadFrequencyWaveformRuntime();
				return generation === frequencyWaveformRuntimeGeneration
					? runtime.requestFrequencyWaveform(clipId, options)
					: null;
			} catch {
				return null;
			}
		},
		invalidateSource: async (sourceId: string): Promise<void> => {
			try {
				const runtime = await loadFrequencyWaveformRuntime();
				await runtime.invalidateSource(sourceId);
			} catch {
				const removedAnalysis = sourceFrequencyAnalyses.delete(sourceId);
				let removedWindow = false;
				for (const [clipId, entry] of sourceFrequencyWindows) {
					if (entry.sourceId !== sourceId) continue;
					sourceFrequencyWindows.delete(clipId);
					removedWindow = true;
				}
				if (removedAnalysis || removedWindow) dependencies.publishDocumentSnapshot();
				persistentFrequencyWaveformCacheBypass.add(sourceId);
				await store.deleteAnalysis?.(`${FREQUENCY_WAVEFORM_CACHE_PREFIX}${sourceId}`);
			}
		},
		clearRuntime: (): void => {
			frequencyWaveformRuntimeGeneration += 1;
			sourceFrequencyAnalyses.clear();
			sourceFrequencyWindows.clear();
			frequencyWaveformRuntime?.clearRuntime();
		},
	});
	const sourceLifecycle = Object.freeze({
		...baseSourceLifecycle,
		invalidateSourceRuntime: async (sourceId: string): Promise<void> => {
			await Promise.all([
				baseSourceLifecycle.invalidateSourceRuntime(sourceId),
				frequencyWaveforms.invalidateSource(sourceId),
			]);
		},
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
		setReadyStatus: () => setLocalizedStatus(dependencies.setStatus, copy, "ready"),
	});

	return Object.freeze({
		projectVisual,
		timePitchCaches,
		sourceLifecycle,
		frequencyWaveforms,
		playbackApply,
		/** Drop the resident waveform caches and requests still resolving them. */
		clearWaveformPcmCaches: () => {
			for (const request of waveformPeakRequests.values()) request.abort();
			waveformPeakWindows.clear();
			waveformPeakRequests.clear();
			waveformPcmWindows.clear();
			waveformPcmRequests.clear();
			frequencyWaveforms.clearRuntime();
		},
	});
}

export type SourceRuntimeComposition = ReturnType<typeof createSourceRuntimeComposition>;
