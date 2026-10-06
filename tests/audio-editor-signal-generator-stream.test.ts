/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAudioEditorSignal } from '../src/common/editor/generators.js';
import { generateAudioEditorSignalStream } from '../src/common/editor/signal-generator-stream-client.ts';
import { createSignalGeneratorStreamRuntime } from '../src/common/editor/signal-generator-stream-runtime.ts';
import { createWaveformPeakBuilder } from '../src/common/editor/waveform-peak-builder.ts';
import type { OneShotWorkerPort } from '../src/common/editor/one-shot-worker-task.ts';

type Listener = Parameters<OneShotWorkerPort['addEventListener']>[1];
class StreamWorker implements OneShotWorkerPort {
	readonly listeners = new Map<string, Set<Listener>>();
	readonly requests: unknown[] = [];
	readonly handle = createSignalGeneratorStreamRuntime();
	terminated = false;
	stalled = false;
	addEventListener(type: string, listener: Listener): void {
		const entries = this.listeners.get(type) ?? new Set(); entries.add(listener); this.listeners.set(type, entries);
	}
	removeEventListener(type: string, listener: Listener): void { this.listeners.get(type)?.delete(listener); }
	postMessage(request: unknown): void {
		this.requests.push(request);
		if (this.stalled) return;
		queueMicrotask(() => {
			if (this.terminated) return;
			const response = this.handle(structuredClone(request));
			const transfer: ArrayBuffer[] = [];
			if (response.type === 'result' && 'channels' in response.result) {
				for (const channel of response.result.channels ?? []) transfer.push(channel.buffer as ArrayBuffer);
			}
			const delivered = structuredClone(response, { transfer });
			for (const listener of this.listeners.get('message') ?? []) listener({ data: delivered });
		});
	}
	terminate(): void { this.terminated = true; }
}

for (const type of ['silence', 'tone', 'chirp', 'noise', 'dtmf', 'morse']) {
	test(`bounded ${type} generation retains exact PCM and peak statistics across transferred blocks`, async () => {
		const worker = new StreamWorker();
		const options = { sampleRate: 48_000, durationSeconds: 1.5, channelCount: 3,
			color: 'pink', seed: 123, sequence: '1551', text: 'SOS' };
		const expected = generateAudioEditorSignal(type, options);
		const stream = await generateAudioEditorSignalStream(type, options, { workerFactory: () => worker });
		assert.equal(worker.requests.length, 1, 'metadata admission produces no PCM blocks');
		const actual = Array.from({ length: stream.channelCount }, () => new Float32Array(stream.frameCount));
		let frames = 0;
		for await (const block of stream.chunks()) {
			assert.ok(block[0]!.length <= 65_536);
			block.forEach((channel, index) => actual[index]!.set(channel, frames));
			frames += block[0]!.length;
			const count: number = worker.requests.length;
			await Promise.resolve();
			assert.equal(worker.requests.length, count, 'consumer persistence applies backpressure');
		}
		assert.deepEqual(actual, expected.channels);
		const builder = createWaveformPeakBuilder(stream); builder.append(expected.channels);
		assert.deepEqual(await stream.finish(), builder.finish());
		assert.equal(worker.terminated, true);
		assert.ok([...worker.listeners.values()].every(listeners => listeners.size === 0));
	});
}

test('abandoning a stream or aborting an in-flight block retires the generator', async () => {
	const worker = new StreamWorker();
	const controller = new AbortController();
	const stream = await generateAudioEditorSignalStream('tone', { durationSeconds: 2 }, {
		workerFactory: () => worker, signal: controller.signal,
	});
	const iterator = stream.chunks()[Symbol.asyncIterator]();
	await iterator.next();
	worker.stalled = true;
	const next = iterator.next();
	const reason = new DOMException('Project replaced', 'AbortError'); controller.abort(reason);
	await assert.rejects(next, error => error === reason);
	assert.equal(worker.terminated, true);
	const abandoned = new StreamWorker();
	const other = await generateAudioEditorSignalStream('noise', {}, { workerFactory: () => abandoned });
	for await (const block of other.chunks()) { assert.ok(block.length); break; }
	assert.equal(abandoned.terminated, true);
	await assert.rejects(other.finish(), /incomplete/);
});

test('invalid generation fails before block allocation and cleans up its worker', async () => {
	const worker = new StreamWorker();
	await assert.rejects(generateAudioEditorSignalStream('tone', { frequency: -1 }, { workerFactory: () => worker }), { name: 'RangeError' });
	assert.equal(worker.terminated, true);
});
