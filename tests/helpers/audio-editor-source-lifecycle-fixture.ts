/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createSourceLifecycleService,
	type SourceLifecycleServiceRuntime,
	type SourceLifecycleWaveformPcmRequest,
	type SourceLifecycleWaveformPcmWindow,
} from '../../src/common/editor/controller/source-lifecycle-service.ts';

export function createSourceLifecycleFixture(options: Readonly<{ videoFailure?: Error }> = {}) {
	const source = { id: 'source', kind: 'audio', frameCount: 100, storageKey: 'source' };
	const clip = { id: 'clip', sourceId: source.id, durationFrames: 100 };
	let project = { id: 'project-a', clips: [clip], sources: [source] };
	let resolveRead: (channels: Float32Array[]) => void = () => undefined;
	let publishes = 0;
	const clipWaveformPcmRequests = new Map<string, SourceLifecycleWaveformPcmRequest>();
	const clipWaveformPcmWindows = new Map<string, SourceLifecycleWaveformPcmWindow>();
	const sourceChunkProviders = new Map<string, unknown>([['source', { id: 'provider' }]]);
	const sourcePeaks = new Map<string, unknown>();
	const cachedBuffers = new Map<string, unknown>();
	const deletedAnalyses: string[] = [];
	const activatedVideoSources: Array<Readonly<{ id: string }>> = [];
	const activatedVideoSignals: Array<AbortSignal | undefined> = [];
	const missingSourceIds = new Set<string>();
	const sourceBuffers = {
		[Symbol.iterator]: () => cachedBuffers[Symbol.iterator](),
		has: (id: string) => cachedBuffers.has(id),
		get: (id: string) => cachedBuffers.get(id),
		delete: (id: string) => cachedBuffers.delete(id),
		setIfFits(id: string, value: unknown) {
			cachedBuffers.set(id, value);
			return true;
		},
	};
	const runtime: SourceLifecycleServiceRuntime = {
		MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES: 2,
		MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES: 100,
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES: 1_024,
		activateVideoSource: async (candidate, activationOptions) => {
			if (options.videoFailure) throw options.videoFailure;
			activatedVideoSources.push(candidate);
			activatedVideoSignals.push(activationOptions?.signal);
		},
		allProjectClips: (value) => value.clips,
		audioBufferChannels: () => [],
		clipSourceWindowRange: (_value, startFrame, endFrame) => ({ startFrame, endFrame }),
		clipWaveformPcmRequests,
		clipWaveformPcmWindows,
		copy: {},
		createStoredChunkProviderCandidate: () => ({ id: 'created-provider' }),
		engine: { getAudioContext: async () => null },
		findClip: (value, id) => value.clips.find((candidate) => candidate.id === id),
		findSource: (value, id) => value.sources.find((candidate) => candidate.id === id),
		generateStoredWaveformPeaks: async () => ({ levels: [] }),
		generateWaveformPeaks: async () => ({ levels: [] }),
		getProject: () => project,
		legacyPeakCacheKey: (id) => `legacy:${id}`,
		peakCacheKey: (id) => `peak:${id}`,
		publishDocumentSnapshot: () => { publishes += 1; },
		readStoredAudioBuffer: async () => null,
		readWaveformPcmWindow: () => new Promise<Float32Array[]>((resolve) => { resolveRead = resolve; }),
		setStatus: () => undefined,
		sourceAudioBufferBytes: (value) => Number((value as Readonly<{ byteLength?: unknown }>).byteLength),
		sourceBuffers,
		sourceChunkProviders,
		sourcePcmBytes: () => 0,
		sourcePeaks,
		state: { missingSourceIds },
		store: {
			getSourceMetadata: async () => null,
			loadAnalysis: async () => null,
			saveAnalysis: async () => undefined,
			deleteAnalysis: async (key: string) => { deletedAnalyses.push(key); },
		},
		waveformPcmWindowContains: () => false,
		waveformPeaksHaveRms: () => true,
	};
	return {
		service: createSourceLifecycleService(runtime),
		source,
		clip,
		cachedBuffers,
		deletedAnalyses,
		sourceChunkProviders,
		sourcePeaks,
		activatedVideoSources,
		activatedVideoSignals,
		missingSourceIds,
		clipWaveformPcmRequests,
		clipWaveformPcmWindows,
		publishes: () => publishes,
		replaceProject() {
			project = { ...project, id: 'project-b' };
		},
		resolveRead(channels: Float32Array[]) {
			resolveRead(channels);
		},
	};
}
