/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import type { SchedulerWorkerData } from './fixtures/parallel-stack-scheduler-worker.ts';
import type { ParallelWorkerMessage } from './fixtures/parallel-stack-worker-adapter.ts';
import { compileParallelStackPlan } from '../src/common/editor/engine/parallel-stack-plan.ts';
import {
	claimParallelStackBank, createParallelStackBuffers, createParallelStackViews,
	publishParallelStackBank, startParallelStackBuffers, stopParallelStackBuffers,
	ParallelStackBankState, ParallelStackStatus,
} from '../src/common/editor/engine/parallel-stack-protocol.ts';

test('independent stacks execute concurrently on actual workers and retire while idle', { timeout: 10_000 }, async () => {
	const shared = createParallelStackBuffers({ generation: 1, planeCount: 4, taskCount: 3, workerCount: 2 });
	const views = createParallelStackViews(shared);
	const barrier = new SharedArrayBuffer(4);
	const tasks = [{ worker: 0, dependencies: [] }, { worker: 1, dependencies: [] }, { worker: 0, dependencies: [0, 1] }];
	const workers = [0, 1].map((workerIndex) => new Worker(new URL('./fixtures/parallel-stack-scheduler-worker.ts', import.meta.url), {
		workerData: { shared, tasks, workerIndex, barrier } satisfies SchedulerWorkerData,
	}));
	try {
		await Promise.all(workers.map(async (worker) => {
			const [message] = await once(worker, 'message');
			assert.equal(message, 'ready');
		}));
		startParallelStackBuffers(shared);
		for (let sequence = 0; sequence < 20; sequence += 1) {
			const bank = claimParallelStackBank(views, sequence);
			assert.ok(bank);
			bank.planes[0].fill(sequence + 1);
			publishParallelStackBank(views, bank);
			await waitUntil(() => bank.state() === ParallelStackBankState.Complete || views.status() === ParallelStackStatus.Faulted);
			assert.equal(views.status(), ParallelStackStatus.Running);
			assert.ok(bank.planes[3].every((sample) => sample === (sequence + 1) * 5));
			assert.equal(bank.unfinished(), 0);
			Atomics.store(views.control, bank.offset, ParallelStackBankState.Free);
		}
		assert.equal(Atomics.load(new Int32Array(barrier), 0), 2);
		const stopped = workers.map((worker) => once(worker, 'message'));
		stopParallelStackBuffers(shared);
		for (const [message] of await Promise.all(stopped)) assert.equal(message, 'stopped');
		for (let worker = 0; worker < 2; worker += 1) assert.equal(Atomics.load(views.control, views.workerStateIndex(worker)), 2);
	} finally {
		stopParallelStackBuffers(shared);
		await Promise.all(workers.map((worker) => worker.terminate()));
	}
});

test('production worker entry clones prepared EQ WASM, acknowledges start and renders on its thread', { timeout: 10_000 }, async () => {
	const parametricEqWasmModule = await WebAssembly.compile(await readFile(new URL('../src/common/editor/parametric-eq/parametric-eq.wasm', import.meta.url)));
	const track = { id: 'track', type: 'audio', channelCount: 2,
		effects: [{ id: 'eq', type: 'parametric-eq', params: { outputGain: 0, bands: [] } }] };
	const project = {
		schemaFamily: 'soundscaper', schemaVersion: 1, tracks: [track], masterChannels: 2,
		mixer: { schemaVersion: 1, groups: [], sends: [], cues: [], vcas: [],
			outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 }],
			edges: [
				{ id: 'a', kind: 'assignment', source: { kind: 'track', id: 'track' }, destination: { kind: 'master' }, position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] },
				{ id: 'b', kind: 'assignment', source: { kind: 'master' }, destination: { kind: 'output', id: 'main' }, position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] },
			] },
	};
	const plan = compileParallelStackPlan(project, { sampleRate: 48_000, workerCount: 1, parametricEqWasmModule });
	const shared = createParallelStackBuffers({ generation: 9, planeCount: plan.planeCount, taskCount: plan.tasks.length, workerCount: plan.workerCount });
	const views = createParallelStackViews(shared);
	const worker = new Worker(new URL('./fixtures/parallel-stack-worker-adapter.ts', import.meta.url));
	const receive = async (): Promise<ParallelWorkerMessage> => (await once(worker, 'message'))[0] as ParallelWorkerMessage;
	try {
		assert.equal((await receive()).type, 'installed');
		const prepared = receive();
		worker.postMessage({ type: 'prepare', shared, plan, workerIndex: 0, parametricEqWasmModule });
		assert.deepEqual(await prepared, { type: 'ready', generation: 9, workerIndex: 0 });
		startParallelStackBuffers(shared);
		const started = receive();
		worker.postMessage({ type: 'start' });
		assert.deepEqual(await started, { type: 'started', generation: 9, workerIndex: 0 });
		const bank = claimParallelStackBank(views, 0);
		assert.ok(bank);
		for (const input of plan.inputPlaneIndices[0]) bank.planes[input].fill(.25);
		publishParallelStackBank(views, bank);
		await waitUntil(() => bank.state() === ParallelStackBankState.Complete || views.status() === ParallelStackStatus.Faulted);
		assert.equal(views.status(), ParallelStackStatus.Running);
		for (const output of plan.outputPlaneIndices[0]) assert.ok(bank.planes[output].every((sample) => sample === .25));
		const stopped = receive();
		stopParallelStackBuffers(shared);
		assert.deepEqual(await stopped, { type: 'stopped', generation: 9, workerIndex: 0 });
	} finally {
		stopParallelStackBuffers(shared);
		await worker.terminate();
	}
});

async function waitUntil(predicate: () => boolean): Promise<void> {
	const expires = Date.now() + 5_000;
	while (!predicate()) {
		if (Date.now() > expires) throw new Error('Timed out waiting for parallel stack completion.');
		await new Promise<void>((resolve) => { setTimeout(resolve, 1); });
	}
}
