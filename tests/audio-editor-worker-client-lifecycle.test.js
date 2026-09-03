import test from 'node:test';
import assert from 'node:assert/strict';

import { Aup4WorkerClient } from '../src/common/editor/aup4-client.js';
import { StaffPadRenderClient } from '../src/common/editor/staffpad/client.js';
import { WavPackCodecClient } from '../src/common/editor/wavpack/client.js';
import { NyquistEvaluationClient } from '../src/common/editor/nyquist/client.js';
import { WorkerRequestBroker } from '../src/common/editor/worker-request-broker.ts';
import {
	createWorkerAbortError,
	deserializeWorkerError,
	serializeWorkerError,
} from '../src/common/editor/worker-error-transport.ts';

test('the shared worker error transport carries declared fields and drops absent ones', () => {
	const thrown = Object.assign(new Error('decode failed'), { code: 'WAVPACK_TRAP', output: 'noise' });
	const wire = serializeWorkerError(thrown, ['code']);
	assert.deepEqual(Object.keys(wire).sort(), ['code', 'message', 'name', 'stack']);
	assert.equal(wire.code, 'WAVPACK_TRAP');
	assert.equal(wire.message, 'decode failed');
	assert.equal(typeof wire.stack, 'string');

	const restored = deserializeWorkerError(wire, 'fallback', ['code']);
	assert.equal(restored.message, 'decode failed');
	assert.equal(restored.code, 'WAVPACK_TRAP');
	assert.equal(restored.stack, wire.stack);
	assert.ok(!('output' in restored), 'undeclared fields must not cross the boundary');

	// An absent extra field serializes as '' and must not land as an empty
	// property on the rebuilt error, which is what the hand-rolled copies did.
	const bare = serializeWorkerError(new Error('plain'), ['code']);
	assert.equal(bare.code, '');
	assert.ok(!('code' in deserializeWorkerError(bare, 'fallback', ['code'])));

	// Non-Error rejections still produce a usable message rather than "undefined".
	assert.equal(serializeWorkerError('exploded').message, 'exploded');
	assert.equal(serializeWorkerError(null).name, 'Error');
	assert.equal(deserializeWorkerError(null, 'worker failed.').message, 'worker failed.');
	assert.equal(createWorkerAbortError('cancelled.').name, 'AbortError');
});

test('worker request broker rolls back failed posts and settles abort exactly once', async () => {
	const broker = new WorkerRequestBroker({ timeoutMs: 120_000 });
	const failedPost = broker.request({
		id: 'post-failure',
		post() { throw new Error('clone failed'); },
	});
	await assert.rejects(failedPost, /clone failed/);
	assert.equal(broker.size, 0);

	const controller = new AbortController();
	let abortCalls = 0;
	const aborted = broker.request({
		id: 'abort',
		signal: controller.signal,
		abortError: () => Object.assign(new Error('cancelled'), { name: 'AbortError' }),
		onAbort() {
			abortCalls += 1;
			throw new Error('cancel post failed');
		},
		post() {},
	});
	controller.abort();
	controller.abort();
	await assert.rejects(aborted, { name: 'AbortError' });
	assert.equal(abortCalls, 1);
	assert.equal(broker.size, 0);
	broker.dispose(new Error('disposed'));
});

test('worker request broker inactivity timeout is reset by progress', async () => {
	const timers = createManualTimers();
	const broker = new WorkerRequestBroker({
		timeoutMs: 120_000,
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
	});
	const pending = broker.request({ id: 'slow', post() {} });
	const first = timers.active()[0];
	assert.equal(first.delay, 120_000);
	assert.equal(broker.touch('slow'), true);
	assert.equal(timers.active().length, 1);
	assert.notEqual(timers.active()[0].id, first.id);
	timers.fire(timers.active()[0].id);
	await assert.rejects(pending, (error) => error.name === 'TimeoutError' && error.code === 'WORKER_INACTIVITY_TIMEOUT');
	assert.equal(broker.size, 0);
});

test('AUP4 client cleans failed posts, isolates callback failures, and handles message errors', async () => {
	const throwingWorker = new FakeWorker({ throwPost: true });
	const throwingClient = new Aup4WorkerClient({ worker: throwingWorker });
	await assert.rejects(throwingClient.initialize(), /clone failed/);
	assert.equal(throwingClient.pending.size, 0);
	throwingClient.dispose();

	const worker = new FakeWorker();
	const client = new Aup4WorkerClient({ worker });
	const progressFailure = client.initialize({ onProgress() { throw new Error('progress failed'); } });
	const id = worker.messages.at(-1).id;
	worker.emit({ id, progress: { value: 0.5 } });
	await assert.rejects(progressFailure, /progress failed/);
	assert.equal(client.pending.size, 0);

	const unreadable = client.initialize();
	worker.failMessage();
	await assert.rejects(unreadable, /unreadable message/);
	client.dispose();
});

test('AUP4 abort and inactivity timeout settle even when cancellation cannot be posted', async () => {
	const worker = new FakeWorker();
	const timers = createManualTimers();
	const client = new Aup4WorkerClient({
		worker,
		timeoutMs: 5,
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
	});
	const controller = new AbortController();
	const aborted = client.initialize({ signal: controller.signal });
	worker.throwPost = true;
	controller.abort();
	await assert.rejects(aborted, (error) => error.code === 'ABORTED');
	assert.equal(client.pending.size, 0);

	worker.throwPost = false;
	const timedOut = client.initialize();
	assert.equal(timers.active().length, 1);
	timers.fire(timers.active()[0].id);
	await assert.rejects(timedOut, (error) => error.name === 'TimeoutError' && error.code === 'TIMEOUT');
	assert.equal(client.pending.size, 0);
	client.dispose();
});

test('StaffPad client rolls back failed posts and times out inactive jobs', async () => {
	const worker = new FakeWorker({ throwPost: true });
	const timers = createManualTimers();
	const client = new StaffPadRenderClient({
		workerFactory: () => worker,
		timeoutMs: 5,
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
	});
	await assert.rejects(client.render(staffPadRequest()), /clone failed/);
	assert.equal(client.jobs.size, 0);
	worker.throwPost = false;
	const timedOut = client.render(staffPadRequest());
	assert.equal(timers.active().length, 1);
	timers.fire(timers.active()[0].id);
	await assert.rejects(timedOut, (error) => (
		error.name === 'TimeoutError' && error.code === 'WORKER_INACTIVITY_TIMEOUT'
	));
	assert.equal(client.jobs.size, 0);
	client.dispose();
});

test('StaffPad callback failures settle jobs and stale worker failures cannot kill a replacement', async () => {
	const workers = [];
	const client = new StaffPadRenderClient({
		workerFactory() {
			const worker = new FakeWorker();
			workers.push(worker);
			return worker;
		},
	});
	const progressFailure = client.render(staffPadRequest(), {
		onProgress() { throw new Error('progress failed'); },
	});
	workers[0].emit({ type: 'progress', id: workers[0].messages.at(-1).id, progress: 0.5 });
	await assert.rejects(progressFailure, /progress failed/);

	const crashed = client.render(staffPadRequest());
	workers[0].fail(new Error('worker crashed'));
	await assert.rejects(crashed, /worker crashed/);
	const replacement = client.render(staffPadRequest());
	assert.equal(workers.length, 2);
	workers[0].fail(new Error('late old-worker failure'));
	assert.equal(workers[1].terminated, false);
	resolveStaffPad(workers[1]);
	await replacement;
	client.dispose();
});

test('WavPack active abort and inactivity timeout terminate the worker and allow queued recovery', async () => {
	const workers = [];
	const timers = createManualTimers();
	const client = new WavPackCodecClient({
		timeoutMs: 5,
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
		workerFactory() {
			const worker = new FakeWorker();
			workers.push(worker);
			return worker;
		},
	});
	const controller = new AbortController();
	const active = client.encode(new ArrayBuffer(4), codecOptions({ signal: controller.signal }));
	const queued = client.encode(new ArrayBuffer(4), codecOptions());
	controller.abort();
	await assert.rejects(active, { name: 'AbortError' });
	assert.equal(workers[0].terminated, true);
	assert.equal(workers.length, 2);
	const queuedMessage = workers[1].messages.at(-1).message;
	workers[1].emit({ type: 'result', id: queuedMessage.id, result: { payload: Uint8Array.of(1) } });
	await queued;

	const timedOut = client.encode(new ArrayBuffer(4), codecOptions());
	assert.equal(timers.active().length, 1);
	timers.fire(timers.active()[0].id);
	await assert.rejects(
		timedOut,
		(error) => error.name === 'TimeoutError' && error.code === 'WORKER_INACTIVITY_TIMEOUT',
	);
	assert.equal(workers[1].terminated, true);
	client.close();
});

test('Nyquist restarts the interpreter on a deadline and fails its collateral evaluations', async () => {
	const workers = [];
	const timers = createManualTimers();
	const client = new NyquistEvaluationClient({
		timeoutMs: 5,
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
		workerFactory() {
			const worker = new FakeWorker();
			workers.push(worker);
			return worker;
		},
	});
	try {
		const stuck = client.evaluate(nyquistRequest());
		const collateral = client.evaluate(nyquistRequest());
		assert.equal(timers.active().length, 2);
		timers.fire(timers.active()[0].id);
		await assert.rejects(
			stuck,
			(error) => error.name === 'TimeoutError' && error.code === 'NYQUIST_TIMEOUT',
		);
		// Nyquist cannot interrupt a running form, so the whole interpreter goes
		// and every evaluation sharing it has to be reported as collateral.
		await assert.rejects(collateral, /restarted after another evaluation timed out/);
		assert.equal(workers[0].terminated, true);
		assert.equal(timers.active().length, 0);

		const afterRestart = client.evaluate(nyquistRequest());
		assert.equal(workers.length, 2);
		const id = workers[1].messages.at(-1).message.id;
		workers[1].emit({
			type: 'result',
			id,
			result: { type: 'number', value: 7, numericType: 'integer', output: '' },
		});
		assert.equal((await afterRestart).value, 7);
	} finally {
		client.dispose();
	}
});

test('WavPack does not spend a queued request its inactivity deadline, and drains foreground first', async () => {
	const workers = [];
	const timers = createManualTimers();
	const client = new WavPackCodecClient({
		timeoutMs: 5,
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
		workerFactory() {
			const worker = new FakeWorker();
			workers.push(worker);
			return worker;
		},
	});
	try {
		const active = client.encode(new ArrayBuffer(4), codecOptions());
		const migration = client.encode(new ArrayBuffer(4), codecOptions({ priority: 'migration' }));
		const foreground = client.encode(new ArrayBuffer(4), codecOptions());
		// Three requests are outstanding but only the running one is on the
		// clock: a deadline measures worker inactivity, not queue depth.
		assert.equal(timers.active().length, 1);
		assert.equal(workers.length, 1);

		const first = workers[0].messages.at(-1).message.id;
		workers[0].emit({ type: 'result', id: first, result: { payload: Uint8Array.of(1) } });
		const second = workers[0].messages.at(-1).message.id;
		assert.notEqual(second, first);
		assert.equal(timers.active().length, 1);
		workers[0].emit({ type: 'result', id: second, result: { payload: Uint8Array.of(2) } });
		const third = workers[0].messages.at(-1).message.id;
		workers[0].emit({ type: 'result', id: third, result: { payload: Uint8Array.of(3) } });

		assert.deepEqual(Array.from((await active).payload), [1]);
		// The migration request was enqueued first and still waits: once a lane
		// has to be chosen, foreground work goes ahead of it.
		assert.deepEqual(Array.from((await foreground).payload), [2]);
		assert.deepEqual(Array.from((await migration).payload), [3]);
		assert.equal(timers.active().length, 0);
	} finally {
		client.close();
	}
});

test('WavPack ignores late failures from a replaced worker', async () => {
	const workers = [];
	const client = new WavPackCodecClient({
		workerFactory() {
			const worker = new FakeWorker();
			workers.push(worker);
			return worker;
		},
	});
	const first = client.encode(new ArrayBuffer(4), codecOptions());
	workers[0].fail(new Error('first crashed'));
	await assert.rejects(first, /first crashed/);
	const second = client.encode(new ArrayBuffer(4), codecOptions());
	workers[0].fail(new Error('late failure'));
	assert.equal(workers[1].terminated, false);
	const message = workers[1].messages.at(-1).message;
	workers[1].emit({ type: 'result', id: message.id, result: { payload: Uint8Array.of(2) } });
	await second;
	client.close();
});

class FakeWorker {
	constructor(options = {}) {
		this.listeners = new Map();
		this.messages = [];
		this.terminated = false;
		this.throwPost = options.throwPost === true;
	}

	addEventListener(type, listener) {
		let listeners = this.listeners.get(type);
		if (!listeners) this.listeners.set(type, listeners = new Set());
		listeners.add(listener);
	}

	removeEventListener(type, listener) {
		this.listeners.get(type)?.delete(listener);
	}

	postMessage(message, transfer = []) {
		if (this.throwPost) throw new Error('clone failed');
		this.messages.push({ ...message, message, transfer });
	}

	emit(data) {
		for (const listener of this.listeners.get('message') || []) listener({ data });
	}

	fail(error) {
		for (const listener of this.listeners.get('error') || []) listener({ error });
	}

	failMessage() {
		for (const listener of this.listeners.get('messageerror') || []) listener({});
	}

	terminate() { this.terminated = true; }
}

function staffPadRequest() {
	return {
		channels: [Float32Array.of(0.25, -0.25)],
		sampleRate: 8_000,
		transform: {},
	};
}

function resolveStaffPad(worker) {
	const id = worker.messages.at(-1).id;
	worker.emit({ type: 'chunk', id, frameOffset: 0, channels: [Float32Array.of(0.25, -0.25)] });
	worker.emit({
		type: 'result',
		id,
		metadata: { frameCount: 2, sampleRate: 8_000, channelCount: 1 },
	});
}

function codecOptions(extra = {}) {
	return { frames: 1, channelCount: 1, sampleRate: 48_000, ...extra };
}

function nyquistRequest() {
	return { source: '(do () (nil))', sampleRate: 8_000, channels: [] };
}

function createManualTimers() {
	let nextId = 1;
	const scheduled = new Map();
	return {
		setTimeout(callback, delay) {
			const timer = { id: nextId++, callback, delay };
			scheduled.set(timer.id, timer);
			return timer.id;
		},
		clearTimeout(id) { scheduled.delete(id); },
		active() { return [...scheduled.values()]; },
		fire(id) {
			const timer = scheduled.get(id);
			if (!timer) throw new Error(`Unknown timer ${id}.`);
			scheduled.delete(id);
			timer.callback();
		},
	};
}
