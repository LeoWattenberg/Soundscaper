/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	AssistanceRuntimeFamilyProcess,
	AssistanceRuntimeFamilyRouterOptions,
} from '../desktop/assistance-runtime-family-host.ts';
import type {
	AssistancePowerEtiquettePort,
	AssistancePowerObservation,
} from '../desktop/assistance-power-etiquette-v1.ts';
import {
	FakeProcess, available, request, routerHarness,
	typedRuntimeFailure, untilRuntime,
} from './helpers/assistance-runtime-family-router-double.ts';

test('concurrent graceful shutdown calls share one unresolved exit barrier', async () => {
	const { router, processes } = routerHarness();
	const result = router.run(request());
	await untilRuntime(() => processes['onnxruntime-node'][0]?.workers.length === 1);
	const process = processes['onnxruntime-node'][0]!;
	process.workers[0]!.resolve('cuts');
	await result;
	let release!: () => void;
	process.shutdownImpl = () => new Promise((resolve) => { release = resolve; });
	const first = router.shutdown();
	const second = router.shutdown();
	assert.equal(first, second);
	await untilRuntime(() => process.shutdowns === 1);
	assert.equal(process.shutdowns, 1);
	release();
	await first;
});

test('graceful shutdown owns an in-flight spawn and propagates a failed flush', async () => {
	let release!: (process: AssistanceRuntimeFamilyProcess) => void;
	const process = new FakeProcess('onnxruntime-node');
	process.shutdownImpl = () => Promise.reject(new Error('coverage flush failed'));
	const pending = new Promise<AssistanceRuntimeFamilyProcess>((resolve) => { release = resolve; });
	const { router } = routerHarness({ spawns: familySpawns(() => pending) });
	const running = router.run(request());
	const runFailure = running.then(() => null, (error: unknown) => error);
	await untilRuntime(() => router.snapshot('onnxruntime-node').state === 'starting');
	const stopping = router.shutdown();
	release(process);
	assert.ok(typedRuntimeFailure('worker-error')(await runFailure));
	await assert.rejects(stopping, (error: unknown) => aggregateIncludes(error, /coverage flush failed/u));
	assert.equal(process.shutdowns, 1);
	assert.equal(process.terminations, 0);
});

test('shutdown fences a deferred availability result before process spawn', async () => {
	let release!: () => void;
	let spawns = 0;
	const availability = new Promise<ReturnType<typeof available>>((resolve) => {
		release = () => resolve(available('onnxruntime-node'));
	});
	const { router } = routerHarness({
		availability: (familyId) => familyId === 'onnxruntime-node'
			? availability : Promise.resolve(available(familyId)),
		spawns: familySpawns(async () => { spawns += 1; return new FakeProcess('onnxruntime-node'); }),
	});
	const running = router.run(request());
	const runFailure = running.then(() => null, (error: unknown) => error);
	await untilRuntime(() => router.snapshot('onnxruntime-node').state === 'starting');
	const stopping = router.shutdown();
	release();
	assert.ok(typedRuntimeFailure('disposed')(await runFailure));
	await stopping;
	assert.equal(spawns, 0, 'shutdown must fence an availability result before it gains spawn authority');
});

test('shutdown aborts and awaits a power-held reservation without spawning', async () => {
	const power = new FakeEtiquettePort({ onBatteryPower: true, thermalState: 'nominal' });
	const { router, processes } = routerHarness({ powerEtiquette: power });
	const running = router.run(request());
	const runFailure = running.then(() => null, (error: unknown) => error);
	await untilRuntime(() => power.subscriptions === 1);
	const stopping = router.shutdown();
	assert.ok(typedRuntimeFailure('disposed')(await runFailure));
	await stopping;
	assert.equal(processes['onnxruntime-node'].length, 0);
});

test('shutdown awaits an in-flight idle retirement and retains its failure', async () => {
	const idle = idleTimer();
	const { router, processes } = routerHarness({
		idleUnloadMs: 90_000, setTimeoutImpl: idle.setTimeoutImpl,
	});
	const running = router.run(request());
	await untilRuntime(() => processes['onnxruntime-node'][0]?.workers.length === 1);
	const process = processes['onnxruntime-node'][0]!;
	process.workers[0]!.resolve('cuts');
	await running;
	let fail!: (error: Error) => void;
	process.shutdownImpl = () => new Promise((_resolve, reject) => { fail = reject; });
	await untilRuntime(() => idle.fire !== null);
	idle.fire!();
	await untilRuntime(() => process.shutdowns === 1);
	const stopping = router.shutdown();
	let settled = false;
	void stopping.finally(() => { settled = true; }).catch(() => undefined);
	await Promise.resolve();
	assert.equal(settled, false, 'the parent cannot exit while idle retirement is flushing coverage');
	fail(new Error('idle coverage flush failed'));
	await assert.rejects(stopping, (error: unknown) => aggregateIncludes(error, /idle coverage flush failed/u));
	assert.equal(process.terminations, 0);
});

test('shutdown all-settles every warm family before reporting graceful failures', async () => {
	const { router, processes } = routerHarness();
	const onnx = router.run(request());
	const whisper = router.run(request('whisper-cpp', 'speech-recognition', 'cd'.repeat(20)));
	await untilRuntime(() => processes['onnxruntime-node'][0]?.workers.length === 1
		&& processes['whisper-cpp'][0]?.workers.length === 1);
	const first = processes['onnxruntime-node'][0]!;
	const second = processes['whisper-cpp'][0]!;
	first.workers[0]!.resolve('cuts');
	second.workers[0]!.resolve('words');
	await Promise.all([onnx, whisper]);
	first.shutdownImpl = () => Promise.reject(new Error('first flush failed'));
	let release!: () => void;
	second.shutdownImpl = () => new Promise((resolve) => { release = resolve; });
	const stopping = router.shutdown();
	let settled = false;
	void stopping.finally(() => { settled = true; }).catch(() => undefined);
	await Promise.resolve();
	assert.equal(settled, false, 'one failure cannot release the parent before every helper exits');
	release();
	await assert.rejects(stopping, (error: unknown) => aggregateIncludes(error, /first flush failed/u));
	assert.equal(second.shutdowns, 1);
});

function familySpawns(
	spawn: () => AssistanceRuntimeFamilyProcess | Promise<AssistanceRuntimeFamilyProcess>,
): AssistanceRuntimeFamilyRouterOptions['spawns'] {
	return Object.freeze({
		'onnxruntime-node': spawn,
		'whisper-cpp': async () => new FakeProcess('whisper-cpp'),
		'llama-cpp': async () => new FakeProcess('llama-cpp'),
	});
}

class FakeEtiquettePort implements AssistancePowerEtiquettePort {
	observation: AssistancePowerObservation;
	subscriptions = 0;
	readonly #listeners = new Set<() => void>();

	constructor(observation: AssistancePowerObservation) { this.observation = observation; }
	observe(): AssistancePowerObservation { return this.observation; }
	subscribe(listener: () => void): () => void {
		this.subscriptions += 1;
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}
}

function idleTimer() {
	const idle: { fire: (() => void) | null; setTimeoutImpl: typeof setTimeout } = {
		fire: null,
		setTimeoutImpl: ((callback: () => void, delay: number) => {
			if (delay === 90_000) { idle.fire = callback; return 0 as unknown as ReturnType<typeof setTimeout>; }
			return setTimeout(callback, delay);
		}) as typeof setTimeout,
	};
	return idle;
}

function aggregateIncludes(error: unknown, pattern: RegExp): boolean {
	return error instanceof AggregateError && error.errors.some((entry) => pattern.test(String(entry)));
}
