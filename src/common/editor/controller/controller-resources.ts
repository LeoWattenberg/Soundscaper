/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoTimingProbePort } from '../video-timing-probe.ts';
import type { StaffPadRenderClient } from '../staffpad/client.js';
import { createAudioEditorEngine } from '../engine.js';
import type { EngineMeterSnapshot, EnginePitchPreserver, EnginePublicApi } from '../engine/public-api.ts';
import { createAudioEditorFileService } from '../file-service.js';
import { createProjectStore } from '../storage.js';
import { createSourceBufferCache } from '../source-buffer-cache.js';
import { createAudioEditorSessionController } from '../session.js';
import { ClipTimePitchRenderCacheCoordinator, loadStoredSourceChannels } from '../clip-time-pitch-cache.js';
import { createEditorCodecRuntime } from '../editor-codec-runtime.ts';
import { AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES } from '../audacity-effects/contracts.js';
import { audioBufferChannels, normalizeByteLimit, type createStoredChunkProvider } from './source-audio.ts';
import { SourceChunkProviderRegistry } from './source-chunk-provider-registry.ts';
import { deferredEffectRuntime, type DeferredNyquistClient } from './deferred-effect-runtime.ts';

type ControllerCodecRuntime = ReturnType<typeof createEditorCodecRuntime>
	& Readonly<{ probeVideoTiming?: VideoTimingProbePort['probe'] }>;

/** Inject cache capabilities without depending on the coordinator's private storage and workers. */
export type ControllerTimePitchCache = Pick<ClipTimePitchRenderCacheCoordinator,
	'createEngineSourceResolver' | 'prepareCommittedOutput' | 'resolveForPlayback' | 'loadCommittedChannels'
> & Partial<Pick<ClipTimePitchRenderCacheCoordinator,
	'retainClipIds' | 'getCommitted' | 'attachAudioBuffer' | 'getProtectedSourceIds' | 'clear' | 'dispose'
>>;

export interface ControllerResourceOptions {
	readonly fileService?: ReturnType<typeof createAudioEditorFileService>;
	readonly store?: ReturnType<typeof createProjectStore>;
	readonly sourceBufferCacheMaxBytes?: number;
	readonly mixRenderMemoryLimitBytes?: number;
	readonly sessionController?: ReturnType<typeof createAudioEditorSessionController>;
	readonly engine?: EnginePublicApi;
	readonly engineFactory?: typeof createAudioEditorEngine;
	readonly clipTimePitchCache?: ControllerTimePitchCache;
	readonly staffPadRenderClient?: Pick<StaffPadRenderClient, 'render'>;
	readonly clipTimePitchMaximumResidentChannelBytes?: number;
	readonly ffmpeg?: ControllerCodecRuntime;
	readonly nyquistEvaluator?: DeferredNyquistClient['evaluate'];
	readonly nyquistClientOptions?: Parameters<typeof deferredEffectRuntime.createNyquistClient>[0];
	readonly playAtSpeedPitchPreserver?: EnginePitchPreserver;
}

export interface ControllerResourceCallbacks {
	readonly copy: Readonly<{ staffPadRangeWarning: string; ffmpegLoading: string }>;
	readonly onPosition: (frame: number, duration: number) => void;
	readonly onMeter: (meter: EngineMeterSnapshot) => void;
	readonly onState: (state: string) => void;
	readonly setStatus: (message: string) => void;
	readonly updateExportProgress: (value: unknown) => void;
}

/** Construct the session's audio resources without capturing controller state. */
export function createControllerResources(options: ControllerResourceOptions, callbacks: ControllerResourceCallbacks) {
	const fileService = options.fileService || createAudioEditorFileService();
	const store = options.store || createProjectStore({
		memoryFallback: !fileService.isDesktop,
		linkedOriginalPort: fileService.linkedOriginalPort,
		linkedVideoOriginalPort: fileService.linkedVideoOriginalPort,
	});
	const sourceBuffers = createSourceBufferCache({ maxBytes: options.sourceBufferCacheMaxBytes });
	const sourceChunkProviders = new SourceChunkProviderRegistry<string, ReturnType<typeof createStoredChunkProvider>>();
	const sourcePeaks = new Map<string, unknown>();
	const stagedProjectBinSourceIds = new Set<string>();
	const sessionController = options.sessionController || createAudioEditorSessionController();
	const engine = options.engine || createAudioEditorEngine({
		onPosition: callbacks.onPosition, onMeter: callbacks.onMeter, onState: callbacks.onState,
	});
	const renderEngineFactory = options.engineFactory || createAudioEditorEngine;
	const clipTimePitchCache = options.clipTimePitchCache || new ClipTimePitchRenderCacheCoordinator({
		store, client: options.staffPadRenderClient,
		loadSourceChannels: async (source: Readonly<{ id: string; frameCount: number; channelCount: number; storageKey?: string }>, context = {}) => {
			const buffer: AudioBuffer | undefined = sourceBuffers.get(source.id);
			// Web Audio lends channel views. Transfer only copies owned by the worker.
			if (buffer) return audioBufferChannels(buffer).map(channel => channel.slice());
			return loadStoredSourceChannels(store, source, context);
		},
		transferLoadedSourceChannels: true,
		maximumResidentChannelBytes: options.clipTimePitchMaximumResidentChannelBytes,
		onWarning: (warning: Readonly<{ stageCount: number }>) => callbacks.setStatus(
			callbacks.copy.staffPadRangeWarning.replace('{stageCount}', String(warning.stageCount)),
		),
	});
	const clipTimePitchSourceResolver = clipTimePitchCache.createEngineSourceResolver();
	engine.setSourceResolver?.(clipTimePitchSourceResolver);
	const ffmpeg: ControllerCodecRuntime = options.ffmpeg || createEditorCodecRuntime({
		onLoading: () => callbacks.setStatus(callbacks.copy.ffmpegLoading),
		onProgress: callbacks.updateExportProgress, fileService,
	});
	const nyquistClient = options.nyquistEvaluator ? null : deferredEffectRuntime.createNyquistClient(options.nyquistClientOptions);
	const nyquistEvaluator: DeferredNyquistClient['evaluate'] = options.nyquistEvaluator
		?? ((...args) => {
			if (!nyquistClient) throw new Error('The Nyquist evaluation client is unavailable.');
			return nyquistClient.evaluate(...args);
		});
	const playAtSpeedPitchPreserver: EnginePitchPreserver = options.playAtSpeedPitchPreserver || (async (
		channels, sampleRate, rate, { signal, onProgress }: Partial<Parameters<EnginePitchPreserver>[3]> = {},
	) => deferredEffectRuntime.applyAudacityEffectAsync(
		'audacity-change-tempo', channels, sampleRate, { tempoPercent: (rate - 1) * 100 },
		{ isCancelled: () => Boolean(signal?.aborted), onProgress },
	));
	return Object.freeze({
		fileService, store, sourceBuffers, sourceChunkProviders, sourcePeaks, stagedProjectBinSourceIds,
		sessionController, engine, renderEngineFactory, clipTimePitchCache, clipTimePitchSourceResolver,
		ffmpeg, nyquistClient, nyquistEvaluator, playAtSpeedPitchPreserver,
		mixRenderMemoryLimitBytes: normalizeByteLimit(options.mixRenderMemoryLimitBytes, AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES),
	});
}
