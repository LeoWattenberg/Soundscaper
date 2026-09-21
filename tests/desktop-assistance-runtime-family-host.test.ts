/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AssistanceRuntimeFamilyError,
} from '../desktop/assistance-runtime-family-host.ts';
import type {
	AssistancePowerEtiquettePort,
	AssistancePowerObservation,
} from '../desktop/assistance-power-etiquette-v1.ts';
import {
	GIB, JOB_ID, request, routerHarness as harness,
	typedRuntimeFailure as typed, untilRuntime as until,
} from './helpers/assistance-runtime-family-router-double.ts';

test('routing is lazy, task-closed, CPU-bound, and reuses only the selected family process', async () => {
	const { router, processes } = harness();
	assert.deepEqual(Object.values(processes).map(({ length }) => length), [0, 0, 0]);
	const first = router.run(request());
	await until(() => processes['onnxruntime-node'].length === 1);
	assert.deepEqual(Object.values(processes).map(({ length }) => length), [1, 0, 0]);
	const process = processes['onnxruntime-node'][0]!;
	assert.equal(process.jobs[0]!.descriptor.executionProvider, 'cpu');
	process.workers[0]!.resolve({ boundaries: [] });
	assert.deepEqual(await first, { boundaries: [] });

	const second = router.run(request('onnxruntime-node', 'shot-detection', 'cd'.repeat(20)));
	await until(() => process.workers.length === 2);
	process.workers[1]!.resolve('again');
	assert.equal(await second, 'again');
	assert.equal(processes['onnxruntime-node'].length, 1);

	await assert.rejects(router.run(request('whisper-cpp', 'shot-detection')), typed('unsupported-task'));
	assert.equal(processes['whisper-cpp'].length, 0);
	router.dispose();
});

test('missing and unsupported payload states remain typed and never spawn', async () => {
	const { router, processes } = harness({
		availability: async () => Object.freeze({
			status: 'unavailable' as const,
			reason: 'payload-not-packaged' as const,
			detail: 'The target package has not supplied its runtime files.',
		}),
	});
	await assert.rejects(router.run(request()), typed('payload-not-packaged'));
	assert.equal(processes['onnxruntime-node'].length, 0);
	router.dispose();
});

test('memory admission happens before process creation and enforces the Qwen system floor', async () => {
	const lowAvailable = harness({ availableMemoryBytes: () => GIB });
	await assert.rejects(lowAvailable.router.run(request()), typed('insufficient-memory'));
	assert.equal(lowAvailable.processes['onnxruntime-node'].length, 0);
	lowAvailable.router.dispose();

	const lowSystem = harness({ totalMemoryBytes: () => 8 * GIB });
	await assert.rejects(
		lowSystem.router.run(request('llama-cpp', 'editorial-generation')),
		typed('insufficient-memory'),
	);
	assert.equal(lowSystem.processes['llama-cpp'].length, 0);
	lowSystem.router.dispose();
});

test('concurrent family reservations cannot overcommit one available-memory snapshot', async () => {
	const { router, processes } = harness({ availableMemoryBytes: () => 3 * GIB });
	const onnx = router.run(request());
	await until(() => processes['onnxruntime-node'][0]?.workers.length === 1);
	await assert.rejects(
		router.run(request('whisper-cpp', 'speech-recognition')),
		typed('insufficient-memory'),
	);
	assert.equal(processes['whisper-cpp'].length, 0);
	processes['onnxruntime-node'][0]!.workers[0]!.resolve('cuts');
	assert.equal(await onnx, 'cuts');
	router.dispose();
});

test('cancellation terminates the family worker and settles only after termination', async () => {
	const { router, processes } = harness();
	const controller = new AbortController();
	const result = router.run(request(), { signal: controller.signal });
	await until(() => processes['onnxruntime-node'][0]?.workers.length === 1);
	const worker = processes['onnxruntime-node'][0]!.workers[0]!;
	let release!: () => void;
	worker.terminateImpl = () => {
		worker.terminations += 1;
		return new Promise<void>((resolve) => { release = resolve; });
	};
	controller.abort();
	await until(() => worker.terminations === 1);
	let settled = false;
	void result.catch(() => { settled = true; });
	await Promise.resolve();
	assert.equal(settled, false);
	release();
	await assert.rejects(result, typed('cancelled'));
	assert.equal(processes['onnxruntime-node'][0]!.terminations, 0);
	router.dispose();
});

test('a worker that misses cancellation is contained by family process termination', async () => {
	const { router, processes } = harness({ cancellationBudgetMs: 10 });
	const controller = new AbortController();
	const result = router.run(request(), { signal: controller.signal });
	await until(() => processes['onnxruntime-node'][0]?.workers.length === 1);
	processes['onnxruntime-node'][0]!.workers[0]!.terminateImpl = () => new Promise(() => undefined);
	controller.abort();
	await assert.rejects(result, typed('cancellation-timeout'));
	assert.equal(processes['onnxruntime-node'][0]!.terminations, 1);
	router.dispose();
});

test('one cancellation deadline settles even when neither worker nor family process terminates', async () => {
	const { router, processes } = harness({ cancellationBudgetMs: 10 });
	const controller = new AbortController();
	const result = router.run(request(), { signal: controller.signal });
	await until(() => processes['onnxruntime-node'][0]?.workers.length === 1);
	const process = processes['onnxruntime-node'][0]!;
	process.workers[0]!.terminateImpl = () => new Promise(() => undefined);
	process.terminateImpl = () => new Promise(() => undefined);
	controller.abort();
	await assert.rejects(within(result, 100), typed('cancellation-timeout'));
	assert.equal(process.terminations, 1);
	router.dispose();
});

test('RSS violations terminate only that family process', async () => {
	const { router, processes } = harness({ rssPollIntervalMs: 2 });
	const result = router.run({ ...request(), maximumRssBytes: 64 * 1024 ** 2 });
	await until(() => processes['onnxruntime-node'][0]?.workers.length === 1);
	processes['onnxruntime-node'][0]!.rss = 65 * 1024 ** 2;
	await assert.rejects(result, typed('resource-violation'));
	assert.equal(processes['onnxruntime-node'][0]!.terminations, 1);
	router.dispose();
});

test('crash quarantine is independent for each runtime family and explicit to clear', async () => {
	const { router, processes } = harness({ quarantineCrashLimit: 2 });
	for (let index = 0; index < 2; index += 1) {
		const result = router.run(request('onnxruntime-node', 'shot-detection', String(index + 1).repeat(40)));
		await until(() => processes['onnxruntime-node'].length === index + 1);
		processes['onnxruntime-node'][index]!.exit(139);
		await assert.rejects(result, typed('runtime-exit'));
	}
	assert.equal(router.snapshot('onnxruntime-node').quarantined, true);
	await assert.rejects(router.run(request()), typed('quarantined'));

	const whisper = router.run(request('whisper-cpp', 'speech-recognition'));
	await until(() => processes['whisper-cpp'][0]?.workers.length === 1);
	processes['whisper-cpp'][0]!.workers[0]!.resolve('transcript');
	assert.equal(await whisper, 'transcript');

	router.clearQuarantine('onnxruntime-node');
	assert.equal(router.snapshot('onnxruntime-node').quarantined, false);
	router.dispose();
});

async function within<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
	return await Promise.race([
		promise,
		new Promise<never>((_resolve, reject) => {
			setTimeout(() => reject(new Error('The runtime-family cancellation did not settle.')), milliseconds);
		}),
	]);
}

class FakeEtiquettePort implements AssistancePowerEtiquettePort {
	observation: AssistancePowerObservation;
	subscriptions = 0;
	readonly #listeners = new Set<() => void>();

	constructor(observation: AssistancePowerObservation) {
		this.observation = observation;
	}

	observe(): AssistancePowerObservation { return this.observation; }

	subscribe(listener: () => void): () => void {
		this.subscriptions += 1;
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	change(observation: AssistancePowerObservation): void {
		this.observation = observation;
		for (const listener of [...this.#listeners]) listener();
	}
}

/** Arms only the power hold, so the router's own timers keep their real behaviour. */
function heldTimers(budgetMs: number) {
	const held: { fire: (() => void) | null } = { fire: null };
	const setTimeoutImpl = ((callback: () => void, delay: number) => {
		if (delay === budgetMs && held.fire === null) {
			held.fire = callback;
			return 0 as unknown as ReturnType<typeof setTimeout>;
		}
		return setTimeout(callback, delay);
	}) as unknown as typeof setTimeout;
	return { held, setTimeoutImpl };
}

test('a machine on mains power spawns inference without arming a hold', async () => {
	const powerEtiquette = new FakeEtiquettePort({ onBatteryPower: false, thermalState: 'nominal' });
	const { router, processes } = harness({ powerEtiquette });
	const first = router.run(request());
	await until(() => processes['onnxruntime-node'][0]?.workers.length === 1);
	processes['onnxruntime-node'][0]!.workers[0]!.resolve({ boundaries: [] });
	assert.deepEqual(await first, { boundaries: [] });
	assert.equal(powerEtiquette.subscriptions, 0);
	router.dispose();
});

test('a battery hold delays the spawn and releases it when mains power returns', async () => {
	const powerEtiquette = new FakeEtiquettePort({ onBatteryPower: true, thermalState: 'nominal' });
	const holds: string[] = [];
	const { router, processes } = harness({ powerEtiquette });
	const pending = router.run(request(), { onPowerHold: (reason) => holds.push(reason) });
	await until(() => powerEtiquette.subscriptions === 1);
	assert.deepEqual(holds, ['on-battery']);
	assert.equal(processes['onnxruntime-node'].length, 0,
		'a held job must not spawn its utility process');
	powerEtiquette.change({ onBatteryPower: false, thermalState: 'nominal' });
	await until(() => processes['onnxruntime-node'][0]?.workers.length === 1);
	processes['onnxruntime-node'][0]!.workers[0]!.resolve({ boundaries: [] });
	assert.deepEqual(await pending, { boundaries: [] });
	router.dispose();
});

test('a sustained thermal hold defers the job with a typed code and no spawn', async () => {
	const powerEtiquette = new FakeEtiquettePort({ onBatteryPower: false, thermalState: 'critical' });
	const { held, setTimeoutImpl } = heldTimers(5_000);
	const { router, processes } = harness({
		powerEtiquette, powerHoldBudgetMs: 5_000, setTimeoutImpl,
	});
	const pending = router.run(request());
	await until(() => held.fire !== null);
	held.fire!();
	const error = await pending.then(() => null, (value: unknown) => value);
	assert.ok(error instanceof AssistanceRuntimeFamilyError);
	assert.equal(error.code, 'power-deferred');
	assert.equal(error.jobId, JOB_ID);
	assert.match(error.message, /critical thermal pressure/u);
	assert.equal(processes['onnxruntime-node'].length, 0);
	router.dispose();
});

test('cancelling a power-held job reports cancellation rather than a deferral', async () => {
	const powerEtiquette = new FakeEtiquettePort({ onBatteryPower: true, thermalState: 'nominal' });
	const controller = new AbortController();
	const { router, processes } = harness({ powerEtiquette });
	const pending = router.run(request(), { signal: controller.signal });
	await until(() => powerEtiquette.subscriptions === 1);
	controller.abort();
	await assert.rejects(pending, typed('cancelled'));
	assert.equal(processes['onnxruntime-node'].length, 0);
	router.dispose();
});

test('a deferred job releases its family slot instead of leaving it reserved', async () => {
	const powerEtiquette = new FakeEtiquettePort({ onBatteryPower: false, thermalState: 'serious' });
	const { held, setTimeoutImpl } = heldTimers(5_000);
	const { router, processes } = harness({
		powerEtiquette, powerHoldBudgetMs: 5_000, setTimeoutImpl,
	});
	const deferred = router.run(request());
	await until(() => held.fire !== null);
	held.fire!();
	await assert.rejects(deferred, typed('power-deferred'));
	powerEtiquette.change({ onBatteryPower: false, thermalState: 'nominal' });
	const pending = router.run(request());
	await until(() => processes['onnxruntime-node'][0]?.workers.length === 1);
	processes['onnxruntime-node'][0]!.workers[0]!.resolve({ boundaries: [] });
	assert.deepEqual(await pending, { boundaries: [] });
	router.dispose();
});

test('the router refuses a power etiquette port that cannot be observed', () => {
	assert.throws(() => harness({
		powerEtiquette: { observe: () => ({ onBatteryPower: false, thermalState: 'nominal' }) } as never,
	}), TypeError);
});

test('a family that finished its work releases its process after the quiet period', async () => {
	const idle: { fire: (() => void) | null } = { fire: null };
	const { router, processes } = harness({
		idleUnloadMs: 90_000,
		setTimeoutImpl: ((callback: () => void, delay: number) => {
			if (delay === 90_000) { idle.fire = callback; return 0 as unknown as ReturnType<typeof setTimeout>; }
			return setTimeout(callback, delay);
		}) as unknown as typeof setTimeout,
	});
	const first = router.run(request());
	await until(() => processes['onnxruntime-node'][0]?.workers.length === 1);
	const process = processes['onnxruntime-node'][0]!;
	process.workers[0]!.resolve({ boundaries: [] });
	await first;
	assert.deepEqual(router.snapshot('onnxruntime-node').state, 'ready');
	await until(() => idle.fire !== null);
	idle.fire!();
	await until(() => process.shutdowns === 1);
	assert.equal(process.terminations, 0, 'idle retirement must preserve Node coverage on clean exit');
	assert.equal(router.snapshot('onnxruntime-node').processSpawned, false);
	assert.equal(router.snapshot('onnxruntime-node').recentCrashes, 0,
		'an intentional idle unload is not a crash');

	const second = router.run(request('onnxruntime-node', 'shot-detection', 'cd'.repeat(20)));
	await until(() => processes['onnxruntime-node'].length === 2);
	processes['onnxruntime-node'][1]!.workers[0]!.resolve('again');
	assert.equal(await second, 'again');
	router.dispose();
});

test('a family that is busy again keeps the process its next job is using', async () => {
	const idle: { fire: (() => void) | null } = { fire: null };
	const { router, processes } = harness({
		idleUnloadMs: 90_000,
		setTimeoutImpl: ((callback: () => void, delay: number) => {
			if (delay === 90_000) { idle.fire = callback; return 0 as unknown as ReturnType<typeof setTimeout>; }
			return setTimeout(callback, delay);
		}) as unknown as typeof setTimeout,
	});
	const first = router.run(request());
	await until(() => processes['onnxruntime-node'][0]?.workers.length === 1);
	const process = processes['onnxruntime-node'][0]!;
	process.workers[0]!.resolve('cuts');
	await first;
	await until(() => idle.fire !== null);
	const second = router.run(request('onnxruntime-node', 'shot-detection', 'cd'.repeat(20)));
	await until(() => process.workers.length === 2);
	idle.fire!();
	assert.equal(process.terminations, 0, 'a busy family must never be unloaded underneath its job');
	process.workers[1]!.resolve('again');
	assert.equal(await second, 'again');
	assert.equal(processes['onnxruntime-node'].length, 1);
	router.dispose();
});

test('disposal cancels a pending idle unload rather than terminating twice', async () => {
	const idle: { fire: (() => void) | null } = { fire: null };
	const { router, processes } = harness({
		idleUnloadMs: 90_000,
		setTimeoutImpl: ((callback: () => void, delay: number) => {
			if (delay === 90_000) { idle.fire = callback; return 0 as unknown as ReturnType<typeof setTimeout>; }
			return setTimeout(callback, delay);
		}) as unknown as typeof setTimeout,
	});
	const first = router.run(request());
	await until(() => processes['onnxruntime-node'][0]?.workers.length === 1);
	const process = processes['onnxruntime-node'][0]!;
	process.workers[0]!.resolve('cuts');
	await first;
	await until(() => idle.fire !== null);
	router.dispose();
	await until(() => process.terminations === 1);
	idle.fire!();
	assert.equal(process.terminations, 1);
});

test('graceful shutdown awaits every warm family process without hard-killing it', async () => {
	const { router, processes } = harness();
	const result = router.run(request());
	await until(() => processes['onnxruntime-node'][0]?.workers.length === 1);
	const process = processes['onnxruntime-node'][0]!;
	process.workers[0]!.resolve('cuts');
	await result;
	await router.shutdown();
	assert.equal(process.shutdowns, 1);
	assert.equal(process.terminations, 0);
	assert.equal(router.snapshot('onnxruntime-node').state, 'disposed');
});
