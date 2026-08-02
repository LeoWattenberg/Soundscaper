/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorFileService } from '../src/common/editor/file-service.js';
import { encodeWav } from '../src/common/editor/wav.js';
import { LinkedAudioOriginalSourceReader } from '../src/common/editor/storage/linked-audio-original-source-reader.ts';
import { LinkedOriginalResolver } from '../src/common/editor/storage/linked-original-resolver.ts';
import { LinkedOriginalRepository } from '../src/common/editor/storage/linked-original-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';

const LOCATOR_ID = '1'.repeat(64);
const LOCATOR_REVISION = '2'.repeat(64);
const MATERIALIZED_READ_ID = '3'.repeat(64);
const RANGE_READ_ID = '4'.repeat(64);

test('desktop linked WAV decoding switches from binding materialization to an exact range lease', async () => {
	const body = encodedWave();
	const bridgeLoads: unknown[] = [];
	const releases: string[] = [];
	const rangeRequests: Array<Readonly<{ offset: number; length: number }>> = [];
	let materializedFetches = 0;
	const service = createAudioEditorFileService({
		bridge: bridgeFixture(body.byteLength, bridgeLoads, releases),
		fetch: async (url: string, init: RequestInit) => {
			if (url.includes('/materialized-v1/')) {
				materializedFetches += 1;
				return new Response(responseBody(body), {
					status: 200,
					headers: { 'Content-Length': String(body.byteLength) },
				});
			}
			const range = new Headers(init.headers).get('Range') ?? '';
			const match = /^bytes=(\d+)-(\d+)$/u.exec(range);
			assert.ok(match, `expected one exact byte range, received ${range}`);
			const offset = Number(match[1]);
			const end = Number(match[2]);
			const length = end - offset + 1;
			rangeRequests.push({ offset, length });
			return new Response(responseBody(body.slice(offset, end + 1)), {
				status: 206,
				headers: {
					'Accept-Ranges': 'bytes',
					'Content-Length': String(length),
					'Content-Range': `bytes ${offset}-${end}/${body.byteLength}`,
					'Content-Type': 'audio/wav',
				},
			});
		},
	});
	assert.ok(service.linkedOriginalPort);
	const bindings = new LinkedOriginalRepository({
		memory: getMemoryDatabase(`desktop-linked-audio-range-${Date.now()}-${Math.random()}`),
		database: async () => null,
	}, {
		now: () => new Date('2026-08-03T10:11:12.345Z'),
		createBindingToken: () => 'binding_desktop_audio_range_0001',
	});
	const resolver = new LinkedOriginalResolver(bindings, service.linkedOriginalPort);
	await resolver.bind('project-desktop-range', audioSource(), LOCATOR_ID, {
		expectedLocatorRevision: LOCATOR_REVISION,
	});
	const reader = new LinkedAudioOriginalSourceReader({ bindings, resolver });

	const chunk = await reader.chunk('physical-desktop-range', 1);

	assert.deepEqual([...chunk.channels[0]], [0.25, 1]);
	assert.equal(materializedFetches, 1, 'only binding may construct the whole WAV Blob');
	assert.deepEqual(bridgeLoads, [
		{ locatorId: LOCATOR_ID, expectedRevision: LOCATOR_REVISION, range: false },
		{ locatorId: LOCATOR_ID, expectedRevision: LOCATOR_REVISION, range: true },
	]);
	assert.ok(rangeRequests.length >= 3, 'digest, RIFF inspection, and PCM decoding use ranges');
	assert.ok(rangeRequests.every(({ length }) => length <= 4 * 1024 ** 2));
	assert.deepEqual(releases, [MATERIALIZED_READ_ID, RANGE_READ_ID]);
});

function bridgeFixture(byteLength: number, loads: unknown[], releases: string[]) {
	return {
		async chooseLinkedAudioOriginal() { return null; },
		async loadLinkedAudioOriginal(request: Readonly<{ range?: unknown }>) {
			loads.push(request);
			const ranged = request.range === true;
			return {
				locatorRevision: LOCATOR_REVISION,
				descriptor: readDescriptor(ranged ? RANGE_READ_ID : MATERIALIZED_READ_ID, byteLength, ranged),
			};
		},
		async chooseLinkedVideoOriginal() { return null; },
		async loadLinkedVideoOriginal() { return null; },
		async reconcileLinkedVideoOriginals() { return 0; },
		async releaseLinkedVideoOriginal() { return true; },
		async reconcileLinkedOriginals() { return 0; },
		async releaseLinkedOriginal() { return true; },
		async releaseRead(id: string) { releases.push(id); return true; },
	};
}

function readDescriptor(id: string, size: number, ranged: boolean) {
	const profile = ranged ? 'linked-audio-range-v1' : 'materialized-v1';
	return {
		id,
		url: `soundscaper-app://bundle/_desktop/read/${profile}/${id}/selected.wav`,
		name: 'selected.wav',
		size,
		mimeType: 'audio/wav',
		readProfile: profile,
		lastModified: 123,
	};
}

function encodedWave(): Uint8Array {
	const encoded = encodeWav([
		Float32Array.of(-1, -0.25, 0.25, 1),
	], { float: true, dither: false, sampleRate: 48_000 });
	const bytes = new Uint8Array(encoded.byteLength);
	bytes.set(encoded);
	return bytes;
}

function responseBody(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

function audioSource() {
	return Object.freeze({
		kind: 'audio' as const,
		id: 'source-desktop-range',
		storageKey: 'physical-desktop-range',
		mimeType: 'audio/wav',
		frameCount: 4,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32' as const,
		chunkFrames: 2,
	});
}
