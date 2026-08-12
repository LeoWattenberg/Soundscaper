/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createSourceLifecycleService,
	type SourceLifecycleServiceRuntime,
} from '../src/common/editor/controller/source-lifecycle-service.ts';

test('warped waveform PCM requests read the exact mapped source window', async () => {
	const source = { id: 'source', kind: 'audio', frameCount: 2_000, storageKey: 'source' };
	const clip = {
		id: 'clip', kind: 'audio' as const, anchor: 'sample' as const, sourceId: source.id,
		timelineStartFrame: 0, durationFrames: 100, sourceStartFrame: 1_000, sourceDurationFrames: 200,
		warpMap: {
			feature: 'audio-warp' as const,
			points: [
				{ outer: 0, source: 1_000, mode: 'forward' as const },
				{ outer: 50, source: 1_050, mode: 'forward' as const },
				{ outer: 100, source: 1_200, mode: 'forward' as const },
			],
		},
	};
	const project = {
		id: 'project', clips: [clip], sources: [source], sampleRate: 48_000,
		tempoMap: {
			mode: 'musical' as const,
			events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
		},
	};
	let readRange: Readonly<{ startFrame: number; endFrame: number }> | null = null;
	const unavailable = () => { throw new Error('This port is not used by waveform source-window requests.'); };
	const service = createSourceLifecycleService({
		MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES: 2,
		MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES: 200,
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES: 1_024,
		activateVideoSource: unavailable,
		allProjectClips: unavailable,
		audioBufferChannels: unavailable,
		clipSourceWindowRange: unavailable,
		clipWaveformPcmRequests: new Map(),
		clipWaveformPcmWindows: new Map(),
		copy: {},
		createStoredChunkProvider: unavailable,
		engine: {},
		findClip: (value, id) => value.clips.find((candidate: { id: string }) => candidate.id === id),
		findSource: (value, id) => value.sources.find((candidate: { id: string }) => candidate.id === id),
		generateStoredWaveformPeaks: unavailable,
		generateWaveformPeaks: unavailable,
		getProject: () => project,
		isStreamableStoredSource: unavailable,
		legacyPeakCacheKey: unavailable,
		peakCacheKey: unavailable,
		publishDocumentSnapshot: () => undefined,
		readStoredAudioBuffer: unavailable,
		readWaveformPcmWindow: async (_provider, range) => {
			readRange = Object.freeze({ ...range });
			return [new Float32Array(range.endFrame - range.startFrame)];
		},
		setStatus: unavailable,
		sourceAudioBufferBytes: unavailable,
		sourceBuffers: {
			has: () => false,
			delete: () => false,
			setIfFits: () => false,
		},
		sourceChunkProviders: new Map([['source', { id: 'provider' }]]),
		sourcePcmBytes: unavailable,
		sourcePeaks: new Map(),
		state: { missingSourceIds: new Set() },
		store: {},
		waveformPcmWindowContains: () => false,
		waveformPeaksHaveRms: unavailable,
	} satisfies SourceLifecycleServiceRuntime);

	const window = await service.requestWaveformPcmWindow('clip', { startFrame: 25, endFrame: 75 });

	assert.deepEqual(readRange, { startFrame: 1_023, endFrame: 1_127 });
	assert.deepEqual(
		{ startFrame: window?.startFrame, endFrame: window?.endFrame },
		readRange,
	);
});
