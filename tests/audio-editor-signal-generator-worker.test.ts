/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAudioEditorSignal } from '../src/common/editor/generators.js';
import { generateAudioEditorSignalInWorker } from '../src/common/editor/signal-generator-worker-client.ts';
import { executeSignalGeneratorRequest } from '../src/common/editor/signal-generator-worker-runtime.ts';

type Listener = (event: Readonly<{ data?: unknown; message?: string }>) => void;

class TestWorker {
	readonly listeners = new Map<string, Set<Listener>>();
	terminated = false;
	stalled = false;
	addEventListener(type: string, listener: Listener): void {
		const entries = this.listeners.get(type) ?? new Set();
		entries.add(listener);
		this.listeners.set(type, entries);
	}
	removeEventListener(type: string, listener: Listener): void { this.listeners.get(type)?.delete(listener); }
	postMessage(request: unknown): void {
		if (this.stalled) return;
		queueMicrotask(() => {
			const response = executeSignalGeneratorRequest(structuredClone(request));
			const delivered = structuredClone(response, { transfer: response.type === 'result'
				? response.result.channels.map(channel => channel.buffer as ArrayBuffer) : [] });
			for (const listener of this.listeners.get('message') ?? []) listener({ data: delivered });
		});
	}
	terminate(): void { this.terminated = true; }
}

for (const type of ['silence', 'tone', 'chirp', 'noise', 'dtmf', 'morse']) {
	test(`worker generation preserves every ${type} sample and transfers independent channels`, async () => {
		const worker = new TestWorker();
		const options = { sampleRate: 8_000, durationSeconds: 0.21, channelCount: 3,
			color: 'pink', seed: 123, sequence: '1551', text: 'SOS' };
		const expected = generateAudioEditorSignal(type, options);
		const pending = generateAudioEditorSignalInWorker(type, options, { workerFactory: () => worker });
		assert.equal(worker.terminated, false);
		const actual = await pending;
		assert.deepEqual(actual, expected);
		assert.equal(new Set(actual.channels.map(channel => channel.buffer)).size, 3);
		assert.equal(worker.terminated, true);
		assert.equal([...worker.listeners.values()].every(listeners => !listeners.size), true);
	});
}

test('cancelled generation terminates its worker and preserves the cancellation reason', async () => {
	const worker = new TestWorker();
	worker.stalled = true;
	const controller = new AbortController();
	const pending = generateAudioEditorSignalInWorker('noise', {}, {
		workerFactory: () => worker, signal: controller.signal,
	});
	const reason = new DOMException('Project replaced', 'AbortError');
	controller.abort(reason);
	await assert.rejects(pending, error => error === reason);
	assert.equal(worker.terminated, true);
});

test('aborted generation does not allocate a worker', async () => {
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(generateAudioEditorSignalInWorker('noise', {}, {
		signal: controller.signal, workerFactory: () => { throw new Error('Unexpected allocation'); },
	}), { name: 'AbortError' });
});

test('worker validation failures preserve names and clean up', async () => {
	const worker = new TestWorker();
	await assert.rejects(generateAudioEditorSignalInWorker('tone', { frequency: -1 }, {
		workerFactory: () => worker,
	}), { name: 'RangeError' });
	assert.equal(worker.terminated, true);
	assert.equal(executeSignalGeneratorRequest({ type: 'unknown', requestId: 'request' }).type, 'error');
});
