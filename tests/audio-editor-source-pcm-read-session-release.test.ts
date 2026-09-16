/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createStoredChunkProvider, isRetiredSourceReadError } from '../src/common/editor/controller/source/source-audio.ts';
import {
	createSourcePcmReadSession,
	SOURCE_PCM_READ_SESSION_RELEASED_ERROR_NAME,
} from '../src/common/editor/storage/source-pcm-read-session.ts';
import { WavPackCodecClient } from '../src/common/editor/wavpack/client.js';
import { PCM_ENCODING_WAVPACK_F32_V1 } from '../src/common/editor/wavpack/pcm.js';
import { deferred } from './helpers/async-test-control.ts';

const chunk = { index: 0, frames: 1, channels: [Float32Array.of(0.25)] };
const source = { id: 'source', frameCount: 1, channelCount: 1, sampleRate: 48_000, chunkFrames: 1 };
const metadata = { ...source, chunkCount: 1 };

function fixture() {
	const started = deferred<void>();
	let workerCloses = 0;
	let releases = 0;
	let releasedNotifications = 0;
	class ControlledWorker extends EventTarget {
		postMessage(): void { started.resolve(); }
		terminate(): void { workerCloses += 1; }
	}
	const worker = new ControlledWorker();
	const codec = new WavPackCodecClient({ workerFactory: () => worker });
	const session = createSourcePcmReadSession({
		async readChunk(_index, signal) {
			await codec.decode(new Uint8Array([1]), {
				encoding: PCM_ENCODING_WAVPACK_F32_V1,
				frames: 1, channelCount: 1, sampleRate: 48_000, pcmCrc32: 0, signal,
			});
			return chunk;
		},
		async release() { releases += 1; },
		onRelease() { releasedNotifications += 1; },
	});
	return {
		codec, session, started,
		fail(error: Error): void { worker.dispatchEvent(Object.assign(new Event('error'), { error })); },
		counts: () => ({ workerCloses, releases, releasedNotifications }),
	};
}

test('release during a real PCM worker decode retains the named session retirement reason', async () => {
	const f = fixture();
	let retired: unknown;
	const rejection = assert.rejects(f.session.chunk(0), (error: unknown) => {
		retired = error;
		assert.ok(error instanceof Error);
		assert.equal(error.name, SOURCE_PCM_READ_SESSION_RELEASED_ERROR_NAME);
		assert.equal(isRetiredSourceReadError(error), true, 'speculative readers recognize this expected retirement');
		return true;
	});
	await f.started.promise;
	const release = f.session.release();
	assert.strictEqual(f.session.release(), release);
	await Promise.all([rejection, release]);
	await assert.rejects(f.session.chunk(0), (error: unknown) => error === retired);
	assert.deepEqual(f.counts(), { workerCloses: 1, releases: 1, releasedNotifications: 1 });
	f.codec.close();
});

test('a provider retries a maintenance-released pending worker read against its successor session', async () => {
	const f = fixture();
	let openings = 0;
	let successorReleases = 0;
	const successor = createSourcePcmReadSession({
		readChunk: async () => chunk,
		async release() { successorReleases += 1; },
		onRelease() { /* The provider owns this session. */ },
	});
	const provider = createStoredChunkProvider({
		readSourceChunk() { throw new Error('An unfenced fallback must not be used.'); },
		async openSourceReadSession(_id, options) {
			assert.strictEqual(options?.expectedSource, metadata);
			openings += 1;
			return openings === 1 ? f.session : successor;
		},
	}, source, metadata);
	const read = Promise.resolve(provider.readStorageChunk(0));
	void read.catch(() => undefined);
	await f.started.promise;
	const maintenance = f.session.release();
	try {
		assert.deepEqual(await read, chunk);
		await maintenance;
		assert.deepEqual(await provider.readStorageChunk(0), chunk);
		assert.equal(openings, 2);
		assert.deepEqual(f.counts(), { workerCloses: 1, releases: 1, releasedNotifications: 1 });
	} finally {
		await provider.dispose();
		f.codec.close();
	}
	assert.equal(successorReleases, 1);
});

test('an explicit request cancellation takes precedence when session release follows immediately', async () => {
	const f = fixture();
	const request = new AbortController();
	const cancellation = new Error('withdraw only this playback request');
	const rejection = assert.rejects(f.session.chunk(0, { signal: request.signal }), (error: unknown) => error === cancellation);
	await f.started.promise;
	request.abort(cancellation);
	await Promise.all([f.session.release(), rejection]);
	assert.deepEqual(f.counts(), { workerCloses: 1, releases: 1, releasedNotifications: 1 });
	f.codec.close();
});

test('a genuine worker failure retains its identity even when release begins before its catch runs', async () => {
	const f = fixture();
	const failure = new Error('PCM decode failed its integrity check');
	const rejection = assert.rejects(f.session.chunk(0), (error: unknown) => error === failure);
	await f.started.promise;
	f.fail(failure);
	await Promise.all([f.session.release(), rejection]);
	assert.equal(isRetiredSourceReadError(failure), false);
	assert.deepEqual(f.counts(), { workerCloses: 1, releases: 1, releasedNotifications: 1 });
	f.codec.close();
});

test('an active backend AbortError remains a primary failure when no request or lifetime was cancelled', async () => {
	const f = fixture();
	const failure = Object.assign(new Error('backend independently aborted its decode'), { name: 'AbortError' });
	const rejection = assert.rejects(f.session.chunk(0), (error: unknown) => error === failure);
	await f.started.promise;
	f.fail(failure);
	await rejection;
	await f.session.release();
	assert.equal(isRetiredSourceReadError(failure), false);
	assert.deepEqual(f.counts(), { workerCloses: 1, releases: 1, releasedNotifications: 1 });
	f.codec.close();
});
