/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoundedSelectionEffectWorkerService } from '../src/common/editor/controller/effects/internal/bounded-selection-effect-workers.ts';
import type { EffectWorkerLike, SelectionEffectWorkerServiceRuntime, SelectionEffectWorkerRequest } from '../src/common/editor/controller/effects/internal/selection-effect-worker-service.ts';

function fixture(overrides: Partial<SelectionEffectWorkerServiceRuntime> = {}) {
	const workers: Array<EffectWorkerLike & { message: SelectionEffectWorkerRequest & { requestId?: string }; terminated: boolean; complete(): void }> = [];
	const runtime: SelectionEffectWorkerServiceRuntime = { state: { audacityEffectWorker: null, spectralWorker: null }, copy: { effectProcessingFailed: 'failed' },
		workerAvailable: () => true, reuseWorkers: true, captureProject: () => ({ projectId: 'project', generation: 1 }), assertProject() {},
		async loadParametricEqWasmModule() { return null; }, async initializePffft() { return null; }, captureNoiseProfile() {},
		async applySelectionEffect(_type, channels) { return channels; }, applySpectralGain: (channels) => channels,
		createSelectionWorker() {
			const worker = { onmessage: null, onerror: null, onmessageerror: null, message: {} as SelectionEffectWorkerRequest & { requestId?: string }, terminated: false,
				postMessage(message: unknown) { this.message = message as typeof this.message; }, terminate() { this.terminated = true; },
				complete() { this.onmessage?.({ data: { type: 'result', requestId: this.message.requestId, channels: this.message.channels.map((channel) => Float32Array.from(channel, (sample) => -sample)) } }); },
			} as EffectWorkerLike & { message: SelectionEffectWorkerRequest & { requestId?: string }; terminated: boolean; complete(): void };
			workers.push(worker); return worker;
		},
	};
	const service = createBoundedSelectionEffectWorkerService({ ...runtime, ...overrides });
	return { service, workers };
}
function request(sample: number): SelectionEffectWorkerRequest {
	return { operation: 'apply', effectType: 'audacity-invert', channels: [Float32Array.of(sample)], sampleRate: 48000, params: {} };
}

test('independent jobs have at most two workers in flight and preserve target order despite reverse completion', async () => {
	const subject = fixture(); const running = subject.service.runIndependentSelectionEffects([request(1), request(2), request(3)]);
	void running.catch(() => undefined);
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	assert.equal(subject.workers.length, 2); subject.workers[1]!.complete();
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	assert.equal(subject.workers.length, 2); assert.equal(subject.workers[1]!.message.channels[0]![0], 3);
	subject.workers[1]!.complete(); subject.workers[0]!.complete();
	assert.deepEqual((await running).map((result) => result.channels![0]![0]), [-1, -2, -3]);
	subject.service.cancelWorkers(); assert.equal(subject.workers.every((worker) => worker.terminated), true);
});

test('single-job supersession and task cancellation stop both lanes and queued work', async () => {
	for (const supersede of [false, true]) {
		const subject = fixture(); const controller = new AbortController(); const reason = new Error('job cancelled');
		const running = subject.service.runIndependentSelectionEffects([request(1), request(2), request(3)], { signal: controller.signal });
		void running.catch(() => undefined);
		await new Promise<void>((resolve) => { setImmediate(resolve); });
		let single: ReturnType<typeof subject.service.runSelectionEffectWorker> | null = null;
		if (supersede) single = subject.service.runSelectionEffectWorker(request(4)); else controller.abort(reason);
		await assert.rejects(running);
		assert.equal(subject.workers.slice(0, 2).every((worker) => worker.terminated), true);
		if (single) { subject.workers[2]!.complete(); assert.equal((await single).channels![0]![0], -4); }
		subject.service.cancelWorkers();
	}
});

test('a failed lane cancels the sibling and current authority fences every queued dispatch', async () => {
	const subject = fixture(); let current = true; const reason = new Error('project changed');
	const running = subject.service.runIndependentSelectionEffects([request(1), request(2), request(3)], { assertCurrent() { if (!current) throw reason; } });
	void running.catch(() => undefined);
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	current = false; subject.workers[1]!.complete();
	await assert.rejects(running, (error: unknown) => error === reason);
	assert.equal(subject.workers.length, 2); assert.equal(subject.workers.every((worker) => worker.terminated), true);
});


test('supersession cancels an ordinary request while its EQ WASM preflight is still pending', async () => {
	for (const supersede of ['batch', 'single', 'cancel', 'caller-abort'] as const) {
		let resolveWasm: (value: unknown) => void = () => undefined;
		const wasm = new Promise<unknown>((resolve) => { resolveWasm = resolve; });
		const subject = fixture({ loadParametricEqWasmModule: () => wasm });
		const caller = new AbortController();
		const old = subject.service.runSelectionEffectWorker({ ...request(.5), effectType: 'eq' }, { signal: caller.signal });
		void old.catch(() => undefined);
		assert.equal(subject.workers.length, 0);
		let current: Promise<unknown> | null = null;
		if (supersede === 'batch') current = subject.service.runIndependentSelectionEffects([request(1), request(2)]);
		else if (supersede === 'single') current = subject.service.runSelectionEffectWorker(request(3));
		else if (supersede === 'caller-abort') caller.abort();
		else subject.service.cancelWorkers();
		if (current) void current.catch(() => undefined);
		await assert.rejects(old, { name: 'AbortError' });
		resolveWasm({});
		await new Promise<void>((resolve) => { setImmediate(resolve); });
		assert.equal(subject.workers.length, supersede === 'batch' ? 2 : supersede === 'single' ? 1 : 0, 'stale preflight must not allocate or supersede a worker');
		assert.equal(subject.workers.some((worker) => worker.terminated), false);
		for (const worker of subject.workers) worker.complete();
		if (current) await current;
		subject.service.cancelWorkers();
	}
});

test('a cancelled batch rejects promptly while both lane preflights await shared EQ WASM', async () => {
	let resolveWasm: (value: unknown) => void = () => undefined;
	const wasm = new Promise<unknown>((resolve) => { resolveWasm = resolve; });
	const subject = fixture({ loadParametricEqWasmModule: () => wasm });
	const old = subject.service.runIndependentSelectionEffects([{ ...request(1), effectType: 'eq' }, { ...request(2), effectType: 'eq' }]);
	void old.catch(() => undefined);
	const current = subject.service.runSelectionEffectWorker(request(3));
	void current.catch(() => undefined);
	const pending = Symbol('loader pending');
	const outcome = await Promise.race([old.then(() => null, (error: unknown) => error), new Promise<symbol>((resolve) => { setImmediate(() => resolve(pending)); })]);
	resolveWasm({});
	await assert.rejects(old, { name: 'AbortError' });
	await new Promise<void>((resolve) => { setImmediate(resolve); });
	assert.notEqual(outcome, pending, 'cancelled batch must release caller ownership before shared preflight completes');
	assert.equal(subject.workers.length, 1); assert.equal(subject.workers[0]!.terminated, false);
	subject.workers[0]!.complete(); await current; subject.service.cancelWorkers();
});
