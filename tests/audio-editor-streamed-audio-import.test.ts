/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { hasContinuousAudioPacketTimeline, prepareStreamedAudioImport, type StreamedAudioImportSession } from '../src/common/editor/browser-streamed-audio-import.ts';
import { deferred, waitFor } from './helpers/async-test-control.ts';
import type { BrowserContainerAudioSample } from '../src/common/editor/browser-container-audio-decode.ts';

function fixture(values: readonly number[], options: { duration?: number; signal?: AbortSignal } = {}) {
	const events: string[] = [];
	const session: StreamedAudioImportSession = {
		sampleRate: 48_000, channelCount: 1, durationSeconds: options.duration ?? values.length / 48_000,
		timelineOrigin: 0,
		async *samples() {
			for (let start = 0; start < values.length; start += 3) {
				const data = Float32Array.from(values.slice(start, start + 3));
				events.push(`read:${start}`);
				yield {
					timestamp: start / 48_000, duration: data.length / 48_000,
					sampleRate: 48_000, numberOfChannels: 1, numberOfFrames: data.length,
					copyTo(destination, copy) { destination.set(data.subarray(copy.frameOffset ?? 0, (copy.frameOffset ?? 0) + (copy.frameCount ?? data.length))); },
					close() { events.push(`close:${start}`); },
				};
			}
		},
		dispose() { events.push('dispose'); },
	};
	return { events, session, prepare: () => prepareStreamedAudioImport(new Blob(['mp3']), {
		...(options.signal ? { signal: options.signal } : {}), openSession: async () => session,
	}) };
}

test('compressed import packs bounded source chunks and awaits every storage write', async () => {
	const { events, prepare } = fixture([1, 2, 3, 4, 5, 6, 7]);
	const prepared = await prepare();
	assert.equal(prepared.descriptor.frameCount, 7);
	const started = deferred<void>();
	const gate = deferred<void>();
	const chunks: number[][] = [];
	const pending = prepared.stream({ chunkFrames: 2, async onChunk(channels) {
		chunks.push(Array.from(channels[0]!));
		if (chunks.length === 1) { started.resolve(); await gate.promise; }
	} });
	await started.promise;
	assert.deepEqual(events, ['read:0']);
	gate.resolve();
	await pending;
	assert.deepEqual(chunks, [[1, 2], [3, 4], [5, 6], [7]]);
	assert.equal(events.filter((event) => event === 'dispose').length, 1);
});

test('cancellation closes the active decoded sample and session without pulling later audio', async () => {
	const controller = new AbortController();
	const { events, prepare } = fixture([1, 2, 3, 4, 5, 6], { signal: controller.signal });
	const prepared = await prepare();
	await assert.rejects(prepared.stream({ chunkFrames: 2, onChunk() { controller.abort(); } }), { name: 'AbortError' });
	assert.deepEqual(events.filter((event) => event.startsWith('read:')), ['read:0']);
	assert.ok(events.includes('close:0'));
	assert.equal(events.filter((event) => event === 'dispose').length, 1);
});

test('one hour of stereo 48 kHz admits metadata without allocating complete PCM', async () => {
	const { session, prepare } = fixture([], { duration: 3600 });
	Object.assign(session, { channelCount: 2 });
	const prepared = await prepare();
	assert.equal(prepared.descriptor.frameCount, 172_800_000);
	assert.equal(prepared.descriptor.channelCount, 2);
	prepared.dispose();
});

test('oversized original refuses before decoder opening and excessive duration closes the session', async () => {
	let opened = false;
	class LargeBlob extends Blob { override get size() { return 1_000_000_001; } }
	await assert.rejects(prepareStreamedAudioImport(new LargeBlob(), { openSession: async () => {
		opened = true; throw new Error('unexpected open');
	} }), /1 GB/u);
	assert.equal(opened, false);
	const { events, prepare } = fixture([], { duration: 3600.1 });
	await assert.rejects(prepare(), /one-hour/u);
	assert.equal(events.at(-1), 'dispose');
});

test('a storage failure closes decoding and is preserved', async () => {
	const { events, prepare } = fixture([1, 2, 3, 4]);
	const prepared = await prepare();
	const failure = new Error('disk full');
	await assert.rejects(prepared.stream({ chunkFrames: 2, onChunk() { throw failure; } }), (error: unknown) => error === failure);
	assert.deepEqual(events, ['read:0', 'close:0', 'dispose']);
});

test('a truncated decoded stream refuses instead of padding the declared long duration with silence', async () => {
	const { prepare, events } = fixture([1, 2, 3], { duration: 3600 });
	const prepared = await prepare();
	const writes: number[] = [];
	await assert.rejects(prepared.stream({ chunkFrames: 2, onChunk(channels) { writes.push(channels[0]!.length); } }), /ended before/u);
	assert.deepEqual(writes, [2]);
	assert.equal(events.at(-1), 'dispose');
});

test('a verified continuous stream preserves PCM when native sample timestamps regress', async () => {
	const session: StreamedAudioImportSession = Object.assign({
		sampleRate: 48000, channelCount: 1, durationSeconds: 0.5, timelineOrigin: 0,
		async *samples() {
			for (let start = -1024; start < 24000; start += 1024) {
				const data = Float32Array.from({ length: 1024 }, (_value, index) => start + index);
				yield { timestamp: (start >= 16384 ? start - 1024 : start) / 48000, duration: 1024 / 48000,
					sampleRate: 48000, numberOfChannels: 1, numberOfFrames: 1024,
					copyTo(destination: Float32Array, copy: { frameOffset?: number; frameCount?: number }) {
						destination.set(data.subarray(copy.frameOffset ?? 0, (copy.frameOffset ?? 0) + (copy.frameCount ?? data.length)));
					}, close() {}, };
			}
		}, dispose() {},
	}, { continuousTimeline: true });
	const prepared = await prepareStreamedAudioImport(new Blob(['AAC']), { openSession: async () => session });
	const values: number[] = [];
	await prepared.stream({ chunkFrames: 8192, onChunk(channels) { values.push(...channels[0]!); } });
	assert.deepEqual(values, Array.from({ length: 24000 }, (_value, index) => index));
});

test('cancellation rejects a pending decoder pull and closes any sample that arrives later', async () => {
	const controller = new AbortController();
	const started = deferred<void>();
	const gate = deferred<IteratorResult<BrowserContainerAudioSample>>();
	let disposed = 0;
	let returned = 0;
	let closed = 0;
	const session: StreamedAudioImportSession = {
		sampleRate: 48000, channelCount: 1, durationSeconds: 1, timelineOrigin: 0,
		samples() { return { [Symbol.asyncIterator]() { return {
			next() { started.resolve(); return gate.promise; },
			return() { returned++; return Promise.resolve({ done: true as const, value: undefined }); },
		}; } }; }, dispose() { disposed++; },
	};
	const prepared = await prepareStreamedAudioImport(new Blob(['AAC']), { signal: controller.signal, openSession: async () => session });
	let settled = false;
	const pending = prepared.stream({ chunkFrames: 8192, onChunk() { assert.fail('Cancelled audio must not reach storage.'); } });
	const outcome = assert.rejects(pending, { name: 'AbortError' }).then(() => { settled = true; });
	await started.promise;
	controller.abort();
	await waitFor(() => settled, 'a pending decoder pull to reject cancellation');
	await outcome;
	assert.equal(disposed, 1);
	assert.equal(returned, 1);
	gate.resolve({ done: false, value: { timestamp: 0, duration: 1 / 48000, sampleRate: 48000,
		numberOfChannels: 1, numberOfFrames: 1, copyTo() {}, close() { closed++; } } });
	await waitFor(() => closed === 1, 'the abandoned decoded sample to close');
});

test('only continuous encoded packet metadata permits sequential decoded sample placement', async () => {
	const packets = async function *(starts: readonly number[]) {
		for (const start of starts) yield { timestamp: start / 48000, duration: 1024 / 48000, byteLength: 128 };
	};
	assert.equal(await hasContinuousAudioPacketTimeline(packets([-1024, 0, 1024, 2048]), 48000), true);
	assert.equal(await hasContinuousAudioPacketTimeline(packets([0, 1024, 3072]), 48000), false, 'A real packet gap keeps timestamp placement');
	assert.equal(await hasContinuousAudioPacketTimeline(packets([0, 1024, 1024]), 48000), false, 'Duplicated packet timing is not made continuous');
	assert.equal(await hasContinuousAudioPacketTimeline(packets([]), 48000), false);
	const quantized = async function *() {
		for (let index = 0; index < 10; index++) yield { timestamp: Math.round(index * 1024 / 48000 * 1000000) / 1000000,
			duration: 1024 / 48000, byteLength: 128 };
	};
	assert.equal(await hasContinuousAudioPacketTimeline(quantized(), 48000), true, 'Timestamp quantization is bounded to one source frame');
});

test('cancellation of a pending session open closes the session if it finishes later', async () => {
	const controller = new AbortController();
	const gate = deferred<StreamedAudioImportSession>();
	const { session, events } = fixture([1, 2, 3]);
	const pending = prepareStreamedAudioImport(new Blob(['AAC']), { signal: controller.signal, openSession: () => gate.promise });
	controller.abort();
	await assert.rejects(pending, { name: 'AbortError' });
	gate.resolve(session);
	await waitFor(() => events.includes('dispose'), 'the abandoned decoder session to dispose');
	assert.deepEqual(events, ['dispose']);
});

test('an unverified timestamped stream retains real gaps and refuses overlapping audio', async () => {
	const { session } = fixture([1, 2, 3, 4, 5, 6], { duration: 106 / 48000 });
	const originalSamples = session.samples;
	session.samples = async function *() {
		let index = 0;
		for await (const sample of originalSamples()) yield { ...sample, timestamp: index++ === 0 ? 0 : 103 / 48000 };
	};
	const prepared = await prepareStreamedAudioImport(new Blob(['AAC']), { openSession: async () => session });
	const values: number[] = [];
	await prepared.stream({ chunkFrames: 128, onChunk(channels) { values.push(...channels[0]!); } });
	assert.deepEqual(values, [1, 2, 3, ...Array.from({ length: 100 }, () => 0), 4, 5, 6]);
	const overlap: StreamedAudioImportSession = { ...session, durationSeconds: 0.5,
		async *samples() { for (let index = 0; index < 2; index++) yield { timestamp: 0, duration: 1024 / 48000,
			sampleRate: 48000, numberOfChannels: 1, numberOfFrames: 1024, copyTo() {}, close() {} }; },
	};
	const overlapping = await prepareStreamedAudioImport(new Blob(['AAC']), { openSession: async () => overlap });
	await assert.rejects(overlapping.stream({ chunkFrames: 8192, onChunk() { assert.fail('Overlapping audio must not reach storage.'); } }), /samples overlap/u);
});
