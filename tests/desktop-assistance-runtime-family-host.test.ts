/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION,
	AssistanceRuntimeFamilyError,
	createAssistanceRuntimeFamilyRouter,
	type AssistanceRuntimeFamilyAdmittedJob,
	type AssistanceRuntimeFamilyProcess,
	type AssistanceRuntimeFamilyProcessWorker,
} from '../desktop/assistance-runtime-family-host.ts';
import type {
	AssistanceRuntimeFamilyAvailability,
	AssistanceRuntimeFamilyDescriptor,
	AssistanceRuntimeFamilyId,
} from '../desktop/assistance-runtime-family-manifest.ts';
import type {
	AssistancePowerEtiquettePort,
	AssistancePowerObservation,
} from '../desktop/assistance-power-etiquette-v1.ts';

const GIB = 1024 ** 3;
const JOB_ID = 'ab'.repeat(20);

function descriptor(familyId: AssistanceRuntimeFamilyId): AssistanceRuntimeFamilyDescriptor {
	return Object.freeze({
		familyId,
		runtimeVersion: familyId === 'onnxruntime-node' ? '1.29.0'
			: familyId === 'whisper-cpp' ? 'v1.9.3' : 'b10509',
		target: 'linux-x64', executionProvider: 'cpu',
		entrypoint: `/runtime/${familyId}`,
		files: Object.freeze([Object.freeze({
			path: `/runtime/${familyId}`, relativePath: 'runtime', byteLength: 10,
			sha256: '1'.repeat(64), executable: familyId !== 'onnxruntime-node',
		})]),
	});
}

function available(familyId: AssistanceRuntimeFamilyId): AssistanceRuntimeFamilyAvailability {
	return Object.freeze({ status: 'available' as const, descriptor: descriptor(familyId) });
}

class FakeWorker implements AssistanceRuntimeFamilyProcessWorker {
	readonly completion: Promise<unknown>;
	terminations = 0;
	#resolve!: (value: unknown) => void;
	#reject!: (error: Error) => void;
	terminateImpl: () => Promise<void> = () => {
		this.terminations += 1;
		this.#reject(new DOMException('worker terminated', 'AbortError'));
		return Promise.resolve();
	};

	constructor() {
		this.completion = new Promise((resolve, reject) => {
			this.#resolve = resolve;
			this.#reject = reject;
		});
	}

	resolve(value: unknown): void { this.#resolve(value); }
	reject(error: Error): void { this.#reject(error); }
	terminate(): Promise<void> { return this.terminateImpl(); }
}

class FakeProcess implements AssistanceRuntimeFamilyProcess {
	readonly familyId: AssistanceRuntimeFamilyId;
	readonly runtimeVersion: string;
	readonly jobs: AssistanceRuntimeFamilyAdmittedJob[] = [];
	readonly workers: FakeWorker[] = [];
	terminations = 0;
	rss = 0;
	terminateImpl: () => Promise<void> = () => Promise.resolve();
	#exit: ((code: number | null) => void) | null = null;
	constructor(familyId: AssistanceRuntimeFamilyId) {
		this.familyId = familyId;
		this.runtimeVersion = descriptor(familyId).runtimeVersion;
	}

	startWorker(job: AssistanceRuntimeFamilyAdmittedJob): FakeWorker {
		this.jobs.push(job);
		const worker = new FakeWorker();
		this.workers.push(worker);
		return worker;
	}
	onExit(listener: (code: number | null) => void): void { this.#exit = listener; }
	sampleRss(): number | null { return this.rss; }
	terminate(): Promise<void> { this.terminations += 1; return this.terminateImpl(); }
	exit(code: number | null): void { this.#exit?.(code); }
}

function request(
	familyId: AssistanceRuntimeFamilyId = 'onnxruntime-node',
	task = 'shot-detection',
	jobId = JOB_ID,
) {
	const grant = Object.freeze({
		grantVersion: 1 as const, jobId, familyId, task,
		settingsJson: '{}',
		inputs: Object.freeze([Object.freeze({
			claimId: '1'.repeat(40), role: 'video', mediaType: 'video/mp4',
			path: '/private/input', byteLength: 1, sha256: '1'.repeat(64),
			identity: Object.freeze({ dev: 1, ino: 1 }),
		})]),
		models: Object.freeze([Object.freeze({
			modelId: 'model', version: '1.0.0', artifactRole: 'network',
			path: '/private/model', byteLength: 1, sha256: '2'.repeat(64),
			identity: Object.freeze({ dev: 1, ino: 2 }),
		})]),
		outputs: Object.freeze([Object.freeze({
			claimId: '3'.repeat(40), role: 'shot-boundaries',
			mediaType: 'application/vnd.soundscaper.shot-boundaries+json',
			path: '/private/output', maximumByteLength: 1,
			initialByteLength: 0 as const,
			initialSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
			identity: Object.freeze({ dev: 1, ino: 3 }),
		})]),
	});
	return Object.freeze({
		protocolVersion: ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION,
		jobId,
		familyId,
		task,
		maximumRssBytes: 2 * GIB,
		maximumDurationMs: 60_000,
		grant,
	});
}

function harness(overrides: Partial<Parameters<typeof createAssistanceRuntimeFamilyRouter>[0]> = {}) {
	const processes: Record<AssistanceRuntimeFamilyId, FakeProcess[]> = {
		'onnxruntime-node': [], 'whisper-cpp': [], 'llama-cpp': [],
	};
	const spawn = (familyId: AssistanceRuntimeFamilyId) => async () => {
			const process = new FakeProcess(familyId);
			processes[familyId].push(process);
			return process;
		};
	const spawns: Parameters<typeof createAssistanceRuntimeFamilyRouter>[0]['spawns'] = {
		'onnxruntime-node': spawn('onnxruntime-node'),
		'whisper-cpp': spawn('whisper-cpp'),
		'llama-cpp': spawn('llama-cpp'),
	};
	const router = createAssistanceRuntimeFamilyRouter({
		availability: async (familyId) => available(familyId),
		spawns,
		totalMemoryBytes: () => 32 * GIB,
		availableMemoryBytes: () => 24 * GIB,
		...overrides,
	});
	return { router, processes };
}

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
			reason: 'payload-pending-external' as const,
			detail: 'No reviewed digest closure has been supplied.',
		}),
	});
	await assert.rejects(router.run(request()), typed('payload-pending-external'));
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

function typed(code: AssistanceRuntimeFamilyError['code']) {
	return (error: unknown): boolean => error instanceof AssistanceRuntimeFamilyError && error.code === code;
}

async function until(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => { setTimeout(resolve, 1); });
	}
	assert.fail('The runtime-family test condition was not reached.');
}

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
	await until(() => process.terminations === 1);
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
