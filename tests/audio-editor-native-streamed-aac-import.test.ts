/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { getEventListeners } from 'node:events';
import { createNativeStreamedAacImport } from '../src/common/editor/browser-native-streamed-aac-import.ts';
import { prepareStreamedAudioImport } from '../src/common/editor/browser-streamed-audio-import.ts';
import { deferred, waitFor } from './helpers/async-test-control.ts';
import type { BrowserContainerAudioSample } from '../src/common/editor/browser-container-audio-decode.ts';

function fixture(packetCount: number, options: { signal?: AbortSignal; pendingFlush?: Promise<void>; gapAt?: number; firstStart?: number; heldOutputs?: boolean; dequeuedWithoutOutput?: boolean; dequeueOnlyUntil?: number } = {}) {
	const queued: number[] = [];
	const events: string[] = [];
	const closed = new Set<number>();
	let init: AudioDecoderInit;
	let decoderClosed = false;
	let read = 0;
	let created = 0;
	let nativePending = 0;
	const listeners = new Set<() => void>();
	const offset = Math.max(0, -(options.firstStart ?? 0)) / 48000;
	const sample = (index: number): BrowserContainerAudioSample => {
		const start = (options.firstStart ?? 0) + index * 1024 + (options.gapAt !== undefined && index >= options.gapAt ? 100 : 0);
		return { timestamp: start / 48000 + offset, duration: 1024 / 48000, sampleRate: 48000, numberOfChannels: 1, numberOfFrames: 1024,
			copyTo(destination, copy) { const offset = copy.frameOffset ?? 0; const count = copy.frameCount ?? 1024;
				for (let frame = 0; frame < count; frame++) destination[frame] = index * 1024 + offset + frame; },
			close() { closed.add(index); },
		};
	};
	const session = createNativeStreamedAacImport({ config: { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 1 },
		...(options.signal ? { signal: options.signal } : {}),
		packets: () => ({ [Symbol.asyncIterator]() { return {
			async next() { if (read === packetCount) return { done: true as const, value: undefined };
				const index = read++; events.push(`read:${index}`);
				return { done: false as const, value: { byteLength: 10, data: new Uint8Array(10), type: 'key' as const, duration: 1024 / 48000,
					timestamp: ((options.firstStart ?? 0) + index * 1024 + (options.gapAt !== undefined && index >= options.gapAt ? 100 : 0)) / 48000 } };
			}, async return() { events.push('return'); return { done: true as const, value: undefined }; },
		}; } }),
		wrapSample: (data) => sample(data.timestamp),
		createChunk(chunk) { assert.equal(chunk.duration, undefined, 'Native duration hints must be omitted.');
			assert.ok(chunk.timestamp >= 0, 'Native decode must use a forward timeline.');
			return { timestamp: created++ } as EncodedAudioChunk;
		},
		createDecoder(callbacks) { init = callbacks; return {
			get decodeQueueSize() { return options.dequeuedWithoutOutput ? 0 : options.dequeueOnlyUntil === undefined ? queued.length : nativePending; },
			addEventListener(_type, listener) { listeners.add(listener); }, removeEventListener(_type, listener) { listeners.delete(listener); },
			configure() {}, decode(packet) { queued.push(packet.timestamp);
				if (options.dequeueOnlyUntil !== undefined) { nativePending++; setImmediate(() => {
					nativePending--;
					if (packet.timestamp >= options.dequeueOnlyUntil!) for (const index of queued.splice(0)) init.output({ timestamp: index, close() { closed.add(index); } } as AudioData);
					for (const listener of listeners) listener();
				}); } else if (!options.heldOutputs) queueMicrotask(() => {
				const index = queued.shift()!; init.output({ timestamp: index, close() { closed.add(index); } } as AudioData);
				for (const listener of listeners) listener();
			}); },
			async flush() { events.push(`flush:${queued.length}`); if (options.pendingFlush) await options.pendingFlush;
				for (const index of queued.splice(0)) init.output({ timestamp: index, close() { closed.add(index); } } as AudioData);
			}, close() { if (!decoderClosed) { decoderClosed = true; events.push('close'); } },
		}; },
	});
	return { session, events, closed, get read() { return read; }, fail: (error: DOMException) => init.error(error),
		lateOutput: (index: number) => init.output({ timestamp: index, close() { closed.add(index); } } as AudioData) };
}

for (const count of [40, 41, 48, 81]) test(`native AAC drains ${count} packets without resetting its synthesis state`, async () => {
	const { session, events, closed } = fixture(count, { dequeueOnlyUntil: 41 });
	let frames = 0;
	for await (const sample of session.samples()) { const values = new Float32Array(sample.numberOfFrames); sample.copyTo(values, { planeIndex: 0, format: 'f32-planar' });
		assert.equal(values[0], frames); assert.equal(values.at(-1), frames + 1023); frames += sample.numberOfFrames; sample.close(); }
	assert.equal(frames, count * 1024); assert.equal(closed.size, count);
	assert.equal(events.filter(event => event.startsWith('flush:')).length, 1, 'Only EOF may reset synthesis state.');
	assert.equal(events.filter(event => event === 'close').length, 1);
});

test('native AAC storage backpressure keeps only one bounded packet batch decoded', async () => {
	const current = fixture(10000);
	const iterator = current.session.samples()[Symbol.asyncIterator]();
	const first = await iterator.next(); assert.equal(first.done, false);
	const read = current.read; assert.ok(read >= 1 && read <= 8); assert.equal(current.closed.size, 0);
	await new Promise<void>(resolve => { setImmediate(resolve); });
	assert.equal(current.read, read);
	await iterator.return?.(undefined); assert.equal(current.closed.size, read);
	assert.equal(current.events.filter(event => event === 'close').length, 1);
});

test('native AAC cancellation settles a pending flush and releases late PCM', async () => {
	const controller = new AbortController(); const gate = deferred<void>();
	const current = fixture(1, { signal: controller.signal, pendingFlush: gate.promise, heldOutputs: true });
	const iterator = current.session.samples()[Symbol.asyncIterator]();
	const pending = iterator.next(); await waitFor(() => current.events.includes('flush:1'), 'the native EOF flush to start');
	controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
	assert.equal(current.read, 1); assert.equal(current.events.filter(event => event === 'close').length, 1);
	gate.resolve(); await new Promise<void>(resolve => { setImmediate(resolve); });
	assert.equal(current.closed.size, 1); current.lateOutput(99); assert.ok(current.closed.has(99));
});

test('unverified AAC retains encoded gaps instead of cumulatively closing them', async () => {
	const { session } = fixture(48, { gapAt: 20, firstStart: -1024 });
	const timestamps: number[] = [];
	for await (const sample of session.samples()) timestamps.push(sample.timestamp);
	assert.equal(Math.round(timestamps[0]! * 48000), -1024);
	assert.equal(Math.round(timestamps[20]! * 48000), 19 * 1024 + 100);
	assert.equal(Math.round((timestamps[20]! - timestamps[19]!) * 48000), 1124);
});

test('disposing native AAC without an opening signal wakes a pending flush and closes late output', async () => {
	const gate = deferred<void>(); const current = fixture(1, { pendingFlush: gate.promise, heldOutputs: true });
	const iterator = current.session.samples()[Symbol.asyncIterator](); const pending = iterator.next();
	await waitFor(() => current.events.includes('flush:1'), 'the native EOF flush to start'); current.session.dispose();
	await assert.rejects(pending, { name: 'AbortError' }); assert.ok(current.events.includes('close'));
	gate.resolve(); await new Promise<void>(resolve => { setImmediate(resolve); }); assert.equal(current.closed.size, 1);
});

test('disposing native AAC before iteration detaches its opening signal listener', () => {
	const controller = new AbortController(); const listeners = getEventListeners(controller.signal, 'abort').length;
	const current = fixture(48, { signal: controller.signal });
	assert.equal(getEventListeners(controller.signal, 'abort').length, listeners + 1);
	current.session.dispose(); assert.equal(getEventListeners(controller.signal, 'abort').length, listeners);
	assert.equal(current.read, 0); assert.deepEqual(current.events, []);
});

test('disposing native AAC wakes a full decode queue without reading or publishing more samples', async () => {
	const current = fixture(81, { heldOutputs: true });
	const iterator = current.session.samples()[Symbol.asyncIterator](); const pending = iterator.next();
	await waitFor(() => current.read === 8, 'the native queue to fill'); current.session.dispose();
	await assert.rejects(pending, { name: 'AbortError' }); assert.equal(current.read, 8);
	assert.equal(current.events.filter(event => event === 'return').length, 1);
	for (let index = 0; index < 8; index++) current.lateOutput(index);
	assert.equal(current.closed.size, 8);
});

for (const cause of ['opening abort', 'stream abort', 'native error'] as const) test(`${cause} rejects blocked native AAC storage and closes the active sample immediately`, async () => {
	const controller = new AbortController(); const current = fixture(48);
	const entered = deferred<void>(); const storage = deferred<void>();
	const prepared = await prepareStreamedAudioImport(new Blob(['aac']), {
		...(cause === 'opening abort' ? { signal: controller.signal } : {}),
		openSession: async () => ({ sampleRate: 48000, channelCount: 1, timelineOrigin: 0, durationSeconds: 48 * 1024 / 48000,
			samples: current.session.samples, dispose: current.session.dispose, failureSignal: current.session.failureSignal }),
	});
	let settled = false;
	const pending = prepared.stream({ chunkFrames: 1024, ...(cause === 'stream abort' ? { signal: controller.signal } : {}),
		onChunk() { entered.resolve(); return storage.promise; },
	}).then(() => { settled = true; assert.fail('Interrupted storage must reject.'); }, (error: unknown) => { settled = true; return error; });
	await entered.promise;
	const failure = new DOMException('Interrupted native AAC storage.', 'AbortError');
	if (cause === 'native error') current.fail(failure); else controller.abort(failure);
	await waitFor(() => settled, 'blocked native AAC storage to reject interruption', { turns: 5 });
	assert.equal(await pending, failure); assert.ok(current.closed.has(0));
	const read = current.read; storage.reject(new Error('A late storage rejection must remain observed.'));
	await new Promise<void>(resolve => { setImmediate(resolve); }); assert.equal(current.read, read);
	assert.equal(current.events.filter(event => event === 'close').length, 1);
});

test('ordinary native AAC EOF and trimmed-source retirement leave the failure signal clear', async () => {
	for (const frames of [500, 2048]) {
		const current = fixture(2); const chunks: number[] = [];
		const prepared = await prepareStreamedAudioImport(new Blob(['aac']), { openSession: async () => ({
			sampleRate: 48000, channelCount: 1, timelineOrigin: 0, durationSeconds: frames / 48000,
			samples: current.session.samples, dispose: current.session.dispose, failureSignal: current.session.failureSignal,
		}) });
		await prepared.stream({ chunkFrames: 512, onChunk(channels) { chunks.push(...channels[0]!); } });
		assert.equal(chunks.length, frames); assert.deepEqual(chunks, Array.from({ length: frames }, (_, index) => index));
		assert.equal(current.session.failureSignal.aborted, false);
	}
});

test('native AAC refuses a decoder that retains excessive PCM internally after draining its input queue', async () => {
	const current = fixture(81, { heldOutputs: true, dequeuedWithoutOutput: true });
	await assert.rejects(current.session.samples().next(), /sample geometry/u);
	assert.equal(current.read, 65); assert.equal(current.events.filter(event => event.startsWith('flush:')).length, 0);
	assert.ok(current.events.includes('close'));
});

test('native AAC disposal wakes a pending encoded packet pull and ignores its late completion', async () => {
	const started = deferred<void>();
	const gate = deferred<IteratorResult<{ data: Uint8Array; type: 'key'; timestamp: number; duration: number; byteLength: number }>>();
	let returned = 0; let closed = 0;
	const session = createNativeStreamedAacImport({ config: { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 1 },
		packets: () => ({ [Symbol.asyncIterator]() { return { next() { started.resolve(); return gate.promise; },
			async return() { returned++; return { done: true as const, value: undefined }; },
		}; } }),
		wrapSample() { assert.fail('Abandoned packets must not produce PCM.'); },
		createDecoder() { return { decodeQueueSize: 0, configure() {}, addEventListener() {}, removeEventListener() {},
			decode() { assert.fail('A late packet must not reach the closed decoder.'); },
			flush() { assert.fail('A pending packet pull must not flush.'); }, close() { closed++; },
		}; },
	});
	const pending = session.samples().next(); await started.promise; session.dispose();
	await assert.rejects(pending, { name: 'AbortError' }); assert.equal(returned, 1); assert.equal(closed, 1);
	gate.resolve({ done: false, value: { data: new Uint8Array(1), type: 'key', timestamp: 0, duration: 1024 / 48000, byteLength: 1 } });
	await new Promise<void>(resolve => { setImmediate(resolve); }); assert.equal(returned, 1); assert.equal(closed, 1);
});
