/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAudioAnalysisReportInWorker } from '../src/common/editor/audio-analysis-report-worker-client.ts';
import { calculateAudioAnalysisReport, executeAudioAnalysisReportRequest } from '../src/common/editor/audio-analysis-report-worker-runtime.ts';
import type { OneShotWorkerPort } from '../src/common/editor/one-shot-worker-task.ts';

type Listener = Parameters<OneShotWorkerPort['addEventListener']>[1];
class Worker implements OneShotWorkerPort {
	readonly listeners = new Map<string, Set<Listener>>();
	terminated = false;
	stalled = false;
	addEventListener(type: string, listener: Listener): void {
		const listeners = this.listeners.get(type) ?? new Set(); listeners.add(listener); this.listeners.set(type, listeners);
	}
	removeEventListener(type: string, listener: Listener): void { this.listeners.get(type)?.delete(listener); }
	postMessage(message: unknown, transfer: readonly Transferable[] = []): void {
		if (this.stalled) return;
		const request = structuredClone(message, { transfer: [...transfer] });
		queueMicrotask(() => {
			const response = structuredClone(executeAudioAnalysisReportRequest(request));
			for (const listener of this.listeners.get('message') ?? []) listener({ data: response });
		});
	}
	terminate(): void { this.terminated = true; }
}

for (const kind of ['spectrum', 'clipping', 'loudness'] as const) {
	test(`worker ${kind} reports preserve exact results and borrowed PCM`, async () => {
		const worker = new Worker();
		const channels = [Float32Array.from({ length: 32_000 }, (_, frame) => Math.sin(frame / 5) * 1.1)];
		const request = { kind, channels, sampleRate: 8_000, scope: 'track', range: { startFrame: 500, endFrame: 32_500 },
			options: { size: 512, minimumConsecutiveSamples: 2 }, channelWeights: [1] };
		const expected = calculateAudioAnalysisReport(request);
		const actual = await calculateAudioAnalysisReportInWorker(request, { workerFactory: () => worker });
		assert.deepEqual(actual, expected);
		assert.equal(channels[0]?.length, 32_000);
		assert.equal(Object.isFrozen(actual), true);
		if ('bins' in actual) assert.equal(Object.isFrozen(actual.bins), true);
		assert.equal(worker.terminated, true);
	});
}

test('report workers cancel without retaining borrowed PCM or publishing stale results', async () => {
	const worker = new Worker(); worker.stalled = true;
	const controller = new AbortController();
	const channels = [new Float32Array(16)];
	const pending = calculateAudioAnalysisReportInWorker({ kind: 'clipping', channels, sampleRate: 48_000, scope: 'master',
		range: { startFrame: 0, endFrame: 16 }, options: {} }, { signal: controller.signal, workerFactory: () => worker });
	controller.abort();
	await assert.rejects(pending, { name: 'AbortError' });
	assert.equal(worker.terminated, true);
	assert.equal(channels[0]?.byteLength, 64);
});
