/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareStreamedAudioImport, type StreamedAudioImportSession } from '../src/common/editor/browser-streamed-audio-import.ts';
import { deferred } from './helpers/async-test-control.ts';

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
