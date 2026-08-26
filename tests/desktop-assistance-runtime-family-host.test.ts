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
	terminate(): Promise<void> { this.terminations += 1; return Promise.resolve(); }
	exit(code: number | null): void { this.#exit?.(code); }
}

function request(
	familyId: AssistanceRuntimeFamilyId = 'onnxruntime-node',
	task = 'shot-detection',
) {
	return Object.freeze({
		protocolVersion: ASSISTANCE_RUNTIME_FAMILY_PROTOCOL_VERSION,
		jobId: JOB_ID,
		familyId,
		task,
		maximumRssBytes: 2 * GIB,
		maximumDurationMs: 60_000,
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

	const second = router.run({ ...request(), jobId: 'cd'.repeat(20) });
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
		const result = router.run({ ...request(), jobId: String(index + 1).repeat(40) });
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
