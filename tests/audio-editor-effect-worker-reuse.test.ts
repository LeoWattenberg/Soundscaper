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
	postMessage(value: unknown, transfer: readonly Transferable[] = []): void {
		this.request = structuredClone(value, { transfer: [...transfer] }) as Record<string, unknown>;
	}
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

test('consumed render PCM transfers without copying while borrowed effect context keeps its buffers', async () => {
	const f = fixture();
	const channels = [new Float32Array([0, 1])];
	const beforeChannels = [new Float32Array([0.5, 0.25])];
	const pending = f.service.runSelectionEffectWorker({ ...f.request, channels, context: { beforeChannels } }, { pcmOwnership: 'transfer' });
	assert.equal(channels[0]?.byteLength, 0);
	assert.equal(beforeChannels[0]?.byteLength, 8);
	const delivered = f.workers[0]?.request.channels as Float32Array[];
	assert.deepEqual(delivered[0], new Float32Array([0, 1]));
	f.workers[0]?.result(); await pending;
	f.service.cancelWorkers();
});

test('invalid transfer geometry is rejected before acquiring a worker', async () => {
	const f = fixture();
	const storage = new Float32Array(4);
	await assert.rejects(f.service.runSelectionEffectWorker({ ...f.request, channels: [storage.subarray(1, 3)] }, {
		pcmOwnership: 'transfer',
	}), /exact-span/iu);
	assert.equal(f.workers.length, 0);
	assert.equal(storage.byteLength, 16);
});
