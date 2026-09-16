/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { generateStoredWaveformPeaks, generateStoredWaveformPeaksFallback } from '../src/common/editor/controller/source/waveform-analysis.ts';
import { deferred } from './helpers/async-test-control.ts';

const source = { id: 'source', frameCount: 4, channelCount: 1 };
const copy = { audioAnalysisWorkerFailed: 'worker failed', audioAnalysisFailed: 'analysis failed' };

test('stored waveform fallback yields for UI cancellation and stops before pulling later chunks', async () => {
	const controller = new AbortController();
	const events: string[] = [];
	const progress: number[] = [];
	await assert.rejects(generateStoredWaveformPeaksFallback({ async *readSourceChunks() {
		try {
			events.push('first');
			yield { channels: [Float32Array.of(0, 1)], frames: 2 };
			events.push('second');
			yield { channels: [Float32Array.of(1, 0)], frames: 2 };
		} finally { events.push('closed'); }
	} }, source, { signal: controller.signal, onProgress(value) {
		progress.push(value);
		setTimeout(() => { controller.abort(); }, 0);
	} }), { name: 'AbortError' });
	assert.deepEqual(events, ['first', 'closed']);
	assert.deepEqual(progress, [0.5]);
});

test('stored waveform worker cancellation terminates an outstanding analysis ack', { timeout: 1000 }, async () => {
	const previous = globalThis.Worker;
	const started = deferred<void>();
	let terminated = 0;
	let pulled = 0;
	class FakeWorker {
		onmessage: ((event: { data: unknown }) => void) | null = null;
		onerror = null;
		onmessageerror = null;
		postMessage(message: { type: string }) {
			if (message.type === 'start') queueMicrotask(() => { this.onmessage?.({ data: { type: 'ready' } }); });
			if (message.type === 'chunk') started.resolve();
		}
		terminate() { terminated++; }
	}
	globalThis.Worker = FakeWorker as unknown as typeof Worker;
	try {
		const controller = new AbortController();
		const pending = generateStoredWaveformPeaks({ async *readSourceChunks() {
			pulled++; yield { channels: [Float32Array.of(0, 1)], frames: 2 };
			pulled++; yield { channels: [Float32Array.of(1, 0)], frames: 2 };
		} }, source, copy, { signal: controller.signal });
		const rejected = assert.rejects(pending, { name: 'AbortError' });
		await started.promise;
		controller.abort();
		await rejected;
		assert.equal(terminated, 1);
		assert.equal(pulled, 1);
	} finally { globalThis.Worker = previous; }
});

test('stored waveform progress follows processed chunks and preserves exact geometry', async () => {
	const progress: number[] = [];
	const peaks = await generateStoredWaveformPeaksFallback({ async *readSourceChunks() {
		yield { channels: [Float32Array.of(0, 1)], frames: 2 };
		yield { channels: [Float32Array.of(1, 0)], frames: 2 };
	} }, source, { onProgress(value) { progress.push(value); } });
	assert.deepEqual(progress, [0.5, 1]);
	assert.equal(peaks.channelCount, 1);
});
