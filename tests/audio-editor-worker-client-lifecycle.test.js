import test from 'node:test';
import assert from 'node:assert/strict';

import { Aup4WorkerClient } from '../src/common/editor/aup4-client.js';
import { StaffPadRenderClient } from '../src/common/editor/staffpad/client.js';
import { WavPackCodecClient } from '../src/common/editor/wavpack/client.js';
import { WorkerRequestBroker } from '../src/common/editor/worker-request-broker.ts';

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
