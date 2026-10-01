/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { canUseDesktopAacImport, openDesktopAacImportSession } from '../src/common/editor/desktop-aac-import.ts';
import { aacLcM4a48_000Fixture } from './helpers/os-audio-codec-fixtures.ts';
import { deferred } from './helpers/async-test-control.ts';

test('desktop M4A import reaches the utility codec without browser AAC and trims only its final packet padding', async () => {
	class RangeFile extends File {
		override arrayBuffer(): Promise<ArrayBuffer> { throw new Error('Whole original read forbidden.'); }
		override slice(start?: number, end?: number, type?: string): Blob {
			assert.ok((end ?? this.size) - (start ?? 0) <= 4 * 1024 * 1024);
			return super.slice(start, end, type);
		}
	}
	const originalDecoder = Object.getOwnPropertyDescriptor(globalThis, 'AudioDecoder');
	const originalFetch = globalThis.fetch;
	Reflect.deleteProperty(globalThis, 'AudioDecoder');
	globalThis.fetch = () => { throw new Error('Desktop renderer codec fetch forbidden.'); };
	let calls = 0;
	try {
		const prepared = await prepareStreamedAudioImport(new RangeFile([Uint8Array.from(aacLcM4a48_000Fixture())], 'voice.m4a', { type: 'audio/mp4' }), {
			desktop: true, reviewedFallback: false, desktopCodec: { decode(file, options) {
				calls++;
				assert.ok(file instanceof File);
				assert.equal(file.name, 'voice.m4a');
				assert.equal(options.format, 'aac-m4a');
				assert.equal(options.maximumOutputBytes, 128 * 1024 * 1024);
				return Promise.resolve({ sampleRate: 48_000,
					channels: [Float32Array.from({ length: 3072 }, (_, index) => index), new Float32Array(3072)] });
			} },
		});
		assert.equal(prepared.descriptor.frameCount, 2400);
		assert.equal(prepared.descriptor.sampleRate, 48_000);
		assert.equal(prepared.descriptor.channelCount, 2);
		assert.equal(calls, 0, 'Utility allocation must wait until source admission and storage preflight finish.');
		const values: number[] = [];
		await prepared.stream({ chunkFrames: 127, onChunk(channels) {
			assert.equal(channels.length, 2);
			assert.ok(channels[0]!.length <= 127);
			values.push(...channels[0]!);
		} });
		assert.deepEqual(values, Array.from({ length: 2400 }, (_, index) => index));
		assert.equal(calls, 1);
	} finally {
		globalThis.fetch = originalFetch;
		if (originalDecoder) Object.defineProperty(globalThis, 'AudioDecoder', originalDecoder);
	}
});

test('desktop AAC utility rejects a changed rate, changed channels, truncation, and excessive padding before publication', async () => {
	const geometry = { sampleRate: 48_000, channelCount: 2, durationSeconds: 2400 / 48_000, timelineOrigin: 0 };
	for (const decoded of [
		{ sampleRate: 44_100, channels: [new Float32Array(2400), new Float32Array(2400)] },
		{ sampleRate: 48_000, channels: [new Float32Array(2400)] },
		{ sampleRate: 48_000, channels: [new Float32Array(2399), new Float32Array(2399)] },
		{ sampleRate: 48_000, channels: [new Float32Array(3424), new Float32Array(3424)] },
		{ sampleRate: 48_000, channels: [new Float32Array(2400), new Float32Array(2401)] },
	]) {
		const session = openDesktopAacImportSession(new Blob(['m4a']), geometry, { decode: () => Promise.resolve(decoded) });
		try { await assert.rejects(session.samples()[Symbol.asyncIterator]().next(), /different PCM geometry/u); }
		finally { session.dispose(); }
	}
});

test('desktop AAC utility admission preserves the existing whole-file limits', () => {
	const codec = { decode() { assert.fail('Oversized AAC must not reach whole-file decode.'); } };
	const geometry = { sampleRate: 48_000, channelCount: 2, durationSeconds: 1, timelineOrigin: 0 };
	class LargeOriginal extends Blob { override get size() { return 32 * 1024 * 1024 + 1; } }
	assert.equal(canUseDesktopAacImport(new Blob(['m4a']), geometry), true);
	for (const [file, source] of [[new LargeOriginal(), geometry], [new Blob(['m4a']), { ...geometry, durationSeconds: 3600 }]] as const) {
		assert.equal(canUseDesktopAacImport(file, source), false);
		assert.throws(() => openDesktopAacImportSession(file, source, codec), /32 MiB input and 128 MiB decoded PCM/u);
	}
});

test('retiring desktop AAC cancels a pending utility decode and removes its opening listener', async () => {
	const controller = new AbortController();
	const entered = deferred<AbortSignal>();
	const session = openDesktopAacImportSession(new Blob(['m4a']),
		{ sampleRate: 48_000, channelCount: 2, durationSeconds: 1, timelineOrigin: 0 }, {
			decode(_file, options) {
				assert.ok(options.signal instanceof AbortSignal);
				const signal = options.signal;
				entered.resolve(signal);
				return new Promise((_resolve, reject) => {
					signal.addEventListener('abort', () => { reject(signal.reason); }, { once: true });
				});
			},
		}, controller.signal);
	const pending = session.samples()[Symbol.asyncIterator]().next();
	const activeSignal = await entered.promise;
	assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
	session.dispose();
	await assert.rejects(pending, { name: 'AbortError' });
	assert.equal(activeSignal.aborted, true);
	assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
	session.dispose();
});
