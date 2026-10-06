/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSelectionEffectWorkerService, type EffectWorkerLike } from '../src/common/editor/controller/effects/internal/selection-effect-worker-service.ts';

class Worker implements EffectWorkerLike {
	onmessage: EffectWorkerLike['onmessage'] = null;
	onerror: EffectWorkerLike['onerror'] = null;
	onmessageerror: EffectWorkerLike['onmessageerror'] = null;
	request: Record<string, unknown> = {};
	terminated = 0;
	postMessage(value: unknown): void { this.request = value as Record<string, unknown>; }
	terminate(): void { this.terminated++; }
	result(requestId = this.request.requestId): void {
		this.onmessage?.({ data: { type: 'result', requestId, channels: [new Float32Array([1, 2])] } });
	}
}

function fixture() {
	const workers: Worker[] = [];
	const service = createSelectionEffectWorkerService({
		state: { audacityEffectWorker: null, spectralWorker: null }, copy: { effectProcessingFailed: 'Failed' },
		reuseWorkers: true, workerAvailable: () => true,
		createSelectionWorker: () => { const worker = new Worker(); workers.push(worker); return worker; },
		captureProject: () => ({ projectId: 'project', generation: 1 }), assertProject: () => {},
		loadParametricEqWasmModule: async () => null, initializePffft: async () => null,
		captureNoiseProfile: () => null, applySelectionEffect: async () => [], applySpectralGain: () => [],
	});
	const request = { operation: 'apply' as const, channels: [new Float32Array([0, 1])], sampleRate: 48_000, params: {} };
	return { workers, service, request };
}

test('completed effect workers are reused, bound messages to each request, and retire on cancellation', async () => {
	const f = fixture();
	const first = f.service.runSelectionEffectWorker(f.request);
	const worker = f.workers[0]!;
	const oldId = worker.request.requestId;
	worker.result();
	await first;
	assert.equal(worker.terminated, 0);
	assert.equal(worker.onmessage, null);
	const second = f.service.runSelectionEffectWorker(f.request);
	assert.equal(f.workers.length, 1);
	let settled = false;
	void second.then(() => { settled = true; });
	worker.result(oldId);
	await Promise.resolve();
	assert.equal(settled, false, 'old results cannot complete the new job');
	worker.result();
	await second;
	f.service.cancelWorkers();
	assert.equal(worker.terminated, 1);
	const third = f.service.runSelectionEffectWorker(f.request);
	assert.equal(f.workers.length, 2);
	f.service.cancelWorkers();
	await assert.rejects(third, { name: 'AbortError' });
	assert.equal(f.workers[1]?.terminated, 1);
});

test('failed reused workers are retired before a replacement is created', async () => {
	const f = fixture();
	const first = f.service.runSelectionEffectWorker(f.request);
	f.workers[0]?.onmessageerror?.({});
	await assert.rejects(first, /Failed/u);
	assert.equal(f.workers[0]?.terminated, 1);
	const second = f.service.runSelectionEffectWorker(f.request);
	f.workers[1]?.result();
	await second;
	f.service.cancelWorkers();
	assert.equal(f.workers.length, 2);
});
