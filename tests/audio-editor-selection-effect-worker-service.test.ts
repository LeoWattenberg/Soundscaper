/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createSelectionEffectWorkerService,
	type EffectWorkerLike,
	type EffectWorkerState,
} from '../src/common/editor/controller/selection-effect-worker-service.ts';

class FakeWorker implements EffectWorkerLike {
	onmessage: ((event: Readonly<{ data: unknown }>) => void) | null = null;
	onerror: ((event: Readonly<{ error?: unknown; message?: string }>) => void) | null = null;
	onmessageerror: ((event: Readonly<{ data?: unknown }>) => void) | null = null;
	posted: unknown = null;
	transfer: readonly Transferable[] = [];
	terminated = 0;
	postError: Error | null = null;

	postMessage(message: unknown, transfer: readonly Transferable[] = []): void {
		if (this.postError) throw this.postError;
		this.posted = message;
		this.transfer = transfer;
	}

	terminate(): void { this.terminated += 1; }
}

function createHarness(options: Readonly<{
	workers?: boolean;
	selectionFactory?: () => FakeWorker;
}> = { workers: true }) {
	const state: EffectWorkerState = { audacityEffectWorker: null, spectralWorker: null };
	const selectionWorkers: FakeWorker[] = [];
	const spectralWorkers: FakeWorker[] = [];
	let projectId = 'project-a';
	let wasmLoads = 0;
	let fftLoads = 0;
	let fallbackApplications = 0;
	const service = createSelectionEffectWorkerService({
		state,
		copy: { effectProcessingFailed: 'Processing failed' },
		workerAvailable: () => options.workers !== false,
		createSelectionWorker: () => {
			const worker = options.selectionFactory?.() ?? new FakeWorker();
			selectionWorkers.push(worker);
			return worker;
		},
		createSpectralWorker: () => {
			const worker = new FakeWorker();
			spectralWorkers.push(worker);
			return worker;
		},
		captureProject: () => ({ generation: 1, projectId }),
		assertProject: (token) => {
			if (token.projectId !== projectId) throw Object.assign(new Error('Project changed'), {
				name: 'AbortError', code: 'PROJECT_CHANGED',
			});
		},
		loadParametricEqWasmModule: async () => { wasmLoads += 1; return { wasm: true }; },
		initializePffft: async () => { fftLoads += 1; },
		captureNoiseProfile: () => ({ profile: true }),
		applySelectionEffect: async (_type, channels) => {
			fallbackApplications += 1;
			return channels.map((channel) => Float32Array.from(channel, (sample) => sample * 2));
		},
		applySpectralGain: async (channels) => channels.map((channel) => Float32Array.from(channel)),
		timeoutMs: 1_000,
	});
	return {
		get fallbackApplications() { return fallbackApplications; },
		get fftLoads() { return fftLoads; },
		get wasmLoads() { return wasmLoads; },
		selectionWorkers,
		service,
		spectralWorkers,
		state,
		switchProject() { projectId = 'project-b'; },
	};
}

const APPLY_REQUEST = {
	operation: 'apply' as const,
	effectType: 'audacity-amplify',
	channels: [new Float32Array([0.25, -0.5])],
	sampleRate: 48_000,
	params: { gainDb: 2 },
	context: {},
};

test('selection worker transfers clones and settles exactly once', async () => {
	const harness = createHarness();
	const pending = harness.service.runSelectionEffectWorker(APPLY_REQUEST);
	const worker = harness.selectionWorkers[0]!;
	const posted = worker.posted as { channels: Float32Array[] };
	assert.notEqual(posted.channels[0], APPLY_REQUEST.channels[0]);
	assert.equal(APPLY_REQUEST.channels[0]?.byteLength, 8);
	assert.equal(worker.transfer.length, 1);
	worker.onmessage?.({ data: { type: 'result', channels: [new Float32Array([1, 2])] } });
	worker.onerror?.({ message: 'late error' });
	assert.deepEqual((await pending).channels?.[0], new Float32Array([1, 2]));
	assert.equal(worker.terminated, 1);
	assert.equal(harness.state.audacityEffectWorker, null);
});

test('worker message errors, post failures, and supersession always clean up', async () => {
	const harness = createHarness();
	const first = harness.service.runSelectionEffectWorker(APPLY_REQUEST);
	const firstWorker = harness.selectionWorkers[0]!;
	const second = harness.service.runSelectionEffectWorker(APPLY_REQUEST);
	await assert.rejects(first, { name: 'AbortError' });
	assert.equal(firstWorker.terminated, 1);
	const secondWorker = harness.selectionWorkers[1]!;
	secondWorker.onmessageerror?.({ data: null });
	await assert.rejects(second, /Processing failed/u);
	assert.equal(secondWorker.terminated, 1);

	const failureHarness = createHarness({
		selectionFactory: () => {
			const worker = new FakeWorker();
			worker.postError = new Error('post failed');
			return worker;
		},
	});
	await assert.rejects(
		() => failureHarness.service.runSelectionEffectWorker(APPLY_REQUEST),
		/post failed/u,
	);
	assert.equal(failureHarness.selectionWorkers[0]?.terminated, 1);
	assert.equal(failureHarness.state.audacityEffectWorker, null);
});

test('fallback EQ loading and effect completion are project scoped', async () => {
	const harness = createHarness({ workers: false });
	const result = await harness.service.runSelectionEffectWorker({ ...APPLY_REQUEST, effectType: 'eq' });
	assert.equal(harness.wasmLoads, 1);
	assert.equal(harness.fallbackApplications, 1);
	assert.deepEqual(result.channels?.[0], new Float32Array([0.5, -1]));

	const pending = harness.service.runSelectionEffectWorker(APPLY_REQUEST);
	harness.switchProject();
	await assert.rejects(pending, { code: 'PROJECT_CHANGED' });
});

test('fallback noise-profile capture initializes the FFT runtime', async () => {
	const harness = createHarness({ workers: false });
	const result = await harness.service.runSelectionEffectWorker({
		operation: 'capture-noise-profile',
		channels: [new Float32Array([0.25, -0.5])],
		sampleRate: 48_000,
		params: { sensitivity: 2 },
	});
	assert.equal(harness.fftLoads, 1);
	assert.deepEqual(result.profile, { profile: true });
});

test('spectral fallback initializes the FFT runtime and preserves channel shape', async () => {
	const harness = createHarness({ workers: false });
	const channels = await harness.service.runSpectralEditWorker(
		[new Float32Array([0.1, 0.2])],
		{ sampleRate: 48_000, startFrame: 0, endFrame: 2, minimumFrequency: 10, maximumFrequency: 1_000, windowSize: 32, gainDb: -3 },
	);
	assert.equal(harness.fftLoads, 1);
	assert.deepEqual(channels[0], new Float32Array([0.1, 0.2]));
});

test('spectral workers normalize result channels and clean up after reported failures', async () => {
	const harness = createHarness();
	const pending = harness.service.runSpectralEditWorker(
		[new Float32Array([0.1, 0.2])],
		{ sampleRate: 48_000, startFrame: 0, endFrame: 2, minimumFrequency: 10, maximumFrequency: 1_000, windowSize: 32, gainDb: -3 },
	);
	const worker = harness.spectralWorkers[0]!;
	worker.onmessage?.({ data: { type: 'result', channels: [[0.4, 0.5]] } });
	assert.deepEqual((await pending)[0], new Float32Array([0.4, 0.5]));
	assert.equal(worker.terminated, 1);
	assert.equal(harness.state.spectralWorker, null);

	const failing = harness.service.runSelectionEffectWorker(APPLY_REQUEST);
	harness.selectionWorkers.at(-1)?.onmessage?.({
		data: { type: 'error', name: 'RangeError', code: 'BAD_EFFECT', message: 'bad effect' },
	});
	await assert.rejects(failing, { name: 'RangeError', code: 'BAD_EFFECT' });
});

test('selection workers ignore unrelated messages before accepting a noise profile', async () => {
	const harness = createHarness();
	const pending = harness.service.runSelectionEffectWorker({
		operation: 'capture-noise-profile',
		channels: [new Float32Array([0.25, -0.5])],
		sampleRate: 48_000,
		params: {},
	});
	const worker = harness.selectionWorkers[0]!;
	worker.onmessage?.({ data: null });
	worker.onmessage?.({ data: { type: 'progress', ratio: 0.5 } });
	worker.onmessage?.({ data: { type: 'noise-profile', profile: { threshold: -30 } } });
	assert.deepEqual((await pending).profile, { threshold: -30 });
	assert.equal(worker.terminated, 1);
});

test('worker timeouts and abort events cancel in-flight requests', async () => {
	const timeoutHarness = createHarness();
	const timedOut = timeoutHarness.service.runSelectionEffectWorker(APPLY_REQUEST, { timeoutMs: 1 });
	await assert.rejects(timedOut, {
		name: 'TimeoutError', code: 'WORKER_INACTIVITY_TIMEOUT', timeoutMs: 1,
	});
	assert.equal(timeoutHarness.selectionWorkers[0]?.terminated, 1);

	const abortHarness = createHarness();
	const abort = new AbortController();
	const aborted = abortHarness.service.runSelectionEffectWorker(APPLY_REQUEST, { signal: abort.signal });
	abort.abort('cancelled without an Error reason');
	await assert.rejects(aborted, { name: 'AbortError', code: 'WORKER_CANCELLED' });
	assert.equal(abortHarness.selectionWorkers[0]?.terminated, 1);
});

test('native worker errors use message and localized fallback text', async () => {
	const harness = createHarness();
	const messaged = harness.service.runSelectionEffectWorker(APPLY_REQUEST);
	harness.selectionWorkers.at(-1)?.onerror?.({ message: 'native worker failed' });
	await assert.rejects(messaged, /native worker failed/u);

	const localized = harness.service.runSelectionEffectWorker(APPLY_REQUEST);
	harness.selectionWorkers.at(-1)?.onerror?.({});
	await assert.rejects(localized, /Processing failed/u);
});

test('explicit cancellation and native worker errors settle active work once', async () => {
	const harness = createHarness();
	const cancelled = harness.service.runSelectionEffectWorker(APPLY_REQUEST);
	harness.service.cancelWorkers();
	await assert.rejects(cancelled, { name: 'AbortError' });
	assert.equal(harness.selectionWorkers[0]?.terminated, 1);

	const failed = harness.service.runSelectionEffectWorker(APPLY_REQUEST);
	const failure = new Error('worker crashed');
	harness.selectionWorkers.at(-1)?.onerror?.({ error: failure });
	await assert.rejects(failed, failure);
});

test('an already-aborted request does not allocate a worker', async () => {
	const harness = createHarness();
	const abort = new AbortController();
	abort.abort(new DOMException('cancelled', 'AbortError'));
	await assert.rejects(
		() => harness.service.runSelectionEffectWorker(APPLY_REQUEST, { signal: abort.signal }),
		{ name: 'AbortError' },
	);
	assert.equal(harness.selectionWorkers.length, 0);
});
