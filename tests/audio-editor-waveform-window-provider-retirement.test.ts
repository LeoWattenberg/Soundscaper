/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	STORED_CHUNK_PROVIDER_DISPOSED_ERROR_NAME,
	isRetiredSourceReadError,
} from '../src/common/editor/controller/source-audio.ts';
import { SOURCE_PCM_READ_SESSION_RELEASED_ERROR_NAME } from '../src/common/editor/storage/source-pcm-read-session.ts';
import {
	createSourceLifecycleService,
	type SourceLifecycleServiceRuntime,
} from '../src/common/editor/controller/source-lifecycle-service.ts';

interface FixtureProject {
	readonly id: string;
	readonly clips: ReadonlyArray<Readonly<{ id: string; sourceId: string; durationFrames: number }>>;
	readonly sources: ReadonlyArray<Readonly<{ id: string; kind: string; frameCount: number; storageKey: string }>>;
}

function createFixture(readFailure: unknown) {
	const source = { id: 'source', kind: 'audio', frameCount: 100, storageKey: 'source' };
	const clip = { id: 'clip', sourceId: source.id, durationFrames: 100 };
	const project: FixtureProject = { id: 'project-a', clips: [clip], sources: [source] };
	const clipWaveformPcmRequests = new Map<string, unknown>();
	const clipWaveformPcmWindows = new Map<string, unknown>();
	const sourceChunkProviders = new Map<string, unknown>([['source', { id: 'provider' }]]);
	const statuses: Array<readonly [string, string]> = [];
	const runtime = {
		MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES: 2,
		MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES: 100,
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES: 1_024,
		activateVideoSource: async () => undefined,
		allProjectClips: (value: FixtureProject) => value.clips,
		audioBufferChannels: () => [],
		clipSourceWindowRange: (_value: unknown, startFrame: number, endFrame: number) => ({ startFrame, endFrame }),
		clipWaveformPcmRequests,
		clipWaveformPcmWindows,
		copy: {},
		createStoredChunkProvider: () => ({ id: 'created-provider' }),
		engine: { getAudioContext: async () => null },
		findClip: (value: FixtureProject, id: string) => value.clips.find((candidate) => candidate.id === id),
		findSource: (value: FixtureProject, id: string) => value.sources.find((candidate) => candidate.id === id),
		generateStoredWaveformPeaks: async () => ({ levels: [] }),
		generateWaveformPeaks: async () => ({ levels: [] }),
		getProject: () => project,
		isStreamableStoredSource: () => true,
		legacyPeakCacheKey: (id: string) => `legacy:${id}`,
		peakCacheKey: (id: string) => `peak:${id}`,
		publishDocumentSnapshot: () => undefined,
		readStoredAudioBuffer: async () => null,
		readWaveformPcmWindow: () => Promise.reject(readFailure),
		setStatus: (message: string, state: string) => { statuses.push([message, state]); },
		sourceAudioBufferBytes: (value: Readonly<{ byteLength: number }>) => value.byteLength,
		sourceBuffers: {
			has: () => false,
			get: () => undefined,
			delete: () => false,
			setIfFits: () => true,
		},
		sourceChunkProviders,
		sourcePcmBytes: () => 0,
		sourcePeaks: new Map<string, unknown>(),
		state: { missingSourceIds: new Set<string>() },
		store: { deleteAnalysis: async () => undefined },
		waveformPcmWindowContains: () => false,
		waveformPeaksHaveRms: () => true,
	} as unknown as SourceLifecycleServiceRuntime;
	return {
		clipWaveformPcmRequests,
		service: createSourceLifecycleService(runtime),
		statuses,
	};
}

test('a waveform window whose provider was retired resolves empty instead of surfacing an error', async () => {
	for (const name of [
		SOURCE_PCM_READ_SESSION_RELEASED_ERROR_NAME,
		STORED_CHUNK_PROVIDER_DISPOSED_ERROR_NAME,
	]) {
		const failure = new Error('the provider serving this window was retired');
		failure.name = name;
		const fixture = createFixture(failure);
		// Reporting this put a generic error over the status bar while an
		// unrelated export was still running; the row simply asks again.
		assert.equal(await fixture.service.requestWaveformPcmWindow('clip', { startFrame: 0, endFrame: 20 }), null);
		assert.equal(fixture.clipWaveformPcmRequests.size, 0);
		assert.deepEqual(fixture.statuses, []);
	}
});

test('a waveform window still reports a genuine read failure', async () => {
	const failure = new Error('the stored PCM could not be decoded');
	const fixture = createFixture(failure);
	await assert.rejects(
		fixture.service.requestWaveformPcmWindow('clip', { startFrame: 0, endFrame: 20 }),
		(error: unknown) => error === failure,
	);
	assert.equal(fixture.clipWaveformPcmRequests.size, 0);
});

test('retired-source read recognition covers both retirement paths and nothing else', () => {
	const released = new Error('released');
	released.name = SOURCE_PCM_READ_SESSION_RELEASED_ERROR_NAME;
	const disposed = new Error('disposed');
	disposed.name = STORED_CHUNK_PROVIDER_DISPOSED_ERROR_NAME;
	assert.equal(isRetiredSourceReadError(released), true);
	assert.equal(isRetiredSourceReadError(disposed), true);
	assert.equal(isRetiredSourceReadError(new Error('decode failed')), false);
	assert.equal(isRetiredSourceReadError(null), false);
});
