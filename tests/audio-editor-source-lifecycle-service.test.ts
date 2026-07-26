/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createSourceLifecycleService,
	type SourceLifecycleServiceRuntime,
} from '../src/common/editor/controller/source-lifecycle-service.ts';

function createFixture() {
	const source = { id: 'source', kind: 'audio', frameCount: 100, storageKey: 'source' };
	const clip = { id: 'clip', sourceId: source.id, durationFrames: 100 };
	let project = { id: 'project-a', clips: [clip], sources: [source] };
	let resolveRead: (channels: Float32Array[]) => void = () => undefined;
	let publishes = 0;
	const clipWaveformPcmRequests = new Map<string, unknown>();
	const clipWaveformPcmWindows = new Map<string, unknown>();
	const sourceChunkProviders = new Map<string, unknown>([['source', { id: 'provider' }]]);
	const sourcePeaks = new Map<string, unknown>();
	const cachedBuffers = new Map<string, unknown>();
	const sourceBuffers = {
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
		activateVideoSource: async () => undefined,
		allProjectClips: (value) => value.clips,
		audioBufferChannels: () => [],
		clipSourceWindowRange: (_value, startFrame, endFrame) => ({ startFrame, endFrame }),
		clipWaveformPcmRequests,
		clipWaveformPcmWindows,
		copy: {},
		createStoredChunkProvider: () => ({ id: 'created-provider' }),
		engine: { getAudioContext: async () => null },
		findClip: (value, id) => value.clips.find((candidate: { id: string }) => candidate.id === id),
		findSource: (value, id) => value.sources.find((candidate: { id: string }) => candidate.id === id),
		generateStoredWaveformPeaks: async () => ({ levels: [] }),
		generateWaveformPeaks: async () => ({ levels: [] }),
		getProject: () => project,
		isStreamableStoredSource: () => true,
		legacyPeakCacheKey: (id) => `legacy:${id}`,
		peakCacheKey: (id) => `peak:${id}`,
		publishDocumentSnapshot: () => { publishes += 1; },
		readStoredAudioBuffer: async () => null,
		readWaveformPcmWindow: () => new Promise<Float32Array[]>((resolve) => { resolveRead = resolve; }),
		setStatus: () => undefined,
		sourceAudioBufferBytes: (value) => value.byteLength,
		sourceBuffers,
		sourceChunkProviders,
		sourcePcmBytes: () => 0,
		sourcePeaks,
		state: { missingSourceIds: new Set<string>() },
		store: {},
		waveformPcmWindowContains: () => false,
		waveformPeaksHaveRms: () => true,
	};
	return {
		service: createSourceLifecycleService(runtime),
		cachedBuffers,
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

test('late waveform PCM completion is discarded after a project switch', async () => {
	const fixture = createFixture();
	const pending = fixture.service.requestWaveformPcmWindow('clip', { startFrame: 0, endFrame: 20 });
	fixture.replaceProject();
	fixture.resolveRead([new Float32Array(20)]);
	assert.equal(await pending, null);
	assert.equal(fixture.clipWaveformPcmRequests.size, 0);
	assert.equal(fixture.clipWaveformPcmWindows.size, 0);
	assert.equal(fixture.publishes(), 0);
});

test('short source buffers are cached and oversized buffers evict stale entries', () => {
	const fixture = createFixture();
	assert.equal(fixture.service.cacheSourceBuffer('source', { byteLength: 128 }), true);
	assert.equal(fixture.cachedBuffers.has('source'), true);
	assert.equal(fixture.service.cacheSourceBuffer('source', { byteLength: 2_048 }), false);
	assert.equal(fixture.cachedBuffers.has('source'), false);
});

test('clearing waveform windows also forgets in-flight ownership', () => {
	const fixture = createFixture();
	fixture.clipWaveformPcmRequests.set('clip', {});
	fixture.clipWaveformPcmWindows.set('clip', {});
	fixture.service.clearWaveformPcmWindows();
	assert.equal(fixture.clipWaveformPcmRequests.size, 0);
	assert.equal(fixture.clipWaveformPcmWindows.size, 0);
});
