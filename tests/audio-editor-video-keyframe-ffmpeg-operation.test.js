/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

const ffmpegModuleUrl = `data:text/javascript,${encodeURIComponent(`
	export class FFmpeg {
		constructor() { return new globalThis.__videoKeyframeOperationRuntime(); }
	}
`)}`;
register(`data:text/javascript,${encodeURIComponent(`
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/ffmpeg') {
			return { url: ${JSON.stringify(ffmpegModuleUrl)}, shortCircuit: true };
		}
		return nextResolve(specifier, context);
	}
`)}`, import.meta.url);

const { createEditorFfmpeg } = await import('../src/common/editor/ffmpeg.js');
const { runVideoKeyframeEncoderOperation } = await import(
	'../src/common/editor/video-keyframe-ffmpeg-operation.ts'
);
const originalRuntime = globalThis.__videoKeyframeOperationRuntime;

test.beforeEach(() => {
	MockRuntime.instances = [];
	globalThis.__videoKeyframeOperationRuntime = MockRuntime;
});

test.afterEach(() => {
	if (originalRuntime === undefined) delete globalThis.__videoKeyframeOperationRuntime;
	else globalThis.__videoKeyframeOperationRuntime = originalRuntime;
});

test('video keyframe operations hold one queued runtime lease through cleanup and idle scheduling', async () => {
	const timers = manualTimers();
	const editor = createEditorFfmpeg({
		coreBaseURL: 'https://assets.invalid/ffmpeg',
		idleTimeoutMs: 250,
		setTimeout: timers.setTimeout,
		clearTimeout: timers.clearTimeout,
	});
	const events = [];
	let releaseFirst;
	const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
	let retainedLease;
	const first = editor.runVideoKeyframeEncoderOperation(async (lease) => {
		retainedLease = lease;
		events.push('first-start');
		assert.deepEqual(Object.keys(lease).sort(), [
			'createInputStream', 'deleteFile', 'exec', 'isExecutionTerminated',
			'readFileRange', 'statFile', 'terminateExecution',
		]);
		await firstGate;
		await lease.deleteFile('/first.mp4');
		events.push('first-end');
		return 'first';
	});
	const second = editor.runVideoKeyframeEncoderOperation(async (lease) => {
		events.push('second-start');
		await lease.statFile('/second.webm');
		events.push('second-end');
		return 'second';
	});
	await waitFor(() => events.includes('first-start'));
	assert.deepEqual(events, ['first-start']);
	assert.equal(timers.active().length, 0);
	releaseFirst();
	assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
	assert.deepEqual(events, ['first-start', 'first-end', 'second-start', 'second-end']);
	assert.equal(MockRuntime.instances.length, 1);
	assert.equal(MockRuntime.instances[0].loadCalls, 1);
	assert.deepEqual(timers.active().map(({ delay }) => delay), [250]);
	assert.throws(() => retainedLease.statFile('/late'), /lease is no longer active/u);
	assert.throws(() => retainedLease.terminateExecution(), /lease is no longer active/u);
	timers.fire(timers.active()[0].id);
	assert.equal(MockRuntime.instances[0].terminateCalls, 1);
});

test('queued abort never invokes its callback and scoped termination cannot target a later generation', async () => {
	const editor = createEditorFfmpeg({
		coreBaseURL: 'https://assets.invalid/ffmpeg',
		idleTimeoutMs: false,
	});
	let releaseFirst;
	const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
	let firstLease;
	const first = editor.runVideoKeyframeEncoderOperation(async (lease) => {
		firstLease = lease;
		await firstGate;
		lease.terminateExecution(new Error('stop generation one'));
	});
	await waitFor(() => firstLease !== undefined);
	let queuedCalls = 0;
	const controller = new AbortController();
	const queued = editor.runVideoKeyframeEncoderOperation(() => {
		queuedCalls += 1;
	}, { signal: controller.signal });
	const reason = new DOMException('queued cancelled', 'AbortError');
	controller.abort(reason);
	releaseFirst();
	await assert.rejects(first, /runtime was terminated/u);
	await assert.rejects(queued, (error) => error === reason);
	assert.equal(queuedCalls, 0);
	assert.equal(MockRuntime.instances.length, 1);
	assert.equal(MockRuntime.instances[0].terminateCalls, 1);

	await editor.runVideoKeyframeEncoderOperation(async (lease) => {
		assert.equal(lease.isExecutionTerminated(), false);
		await lease.statFile('/fresh.mp4');
	});
	assert.equal(MockRuntime.instances.length, 2);
	assert.throws(() => firstLease.terminateExecution(), /lease is no longer active/u);
	assert.equal(MockRuntime.instances[1].terminateCalls, 0);
	editor.dispose();
});

test('editor disposal and lease termination fence a late callback result', async () => {
	const editor = createEditorFfmpeg({
		coreBaseURL: 'https://assets.invalid/ffmpeg',
		idleTimeoutMs: false,
	});
	let release;
	let notifyStarted;
	const gate = new Promise((resolve) => { release = resolve; });
	const started = new Promise((resolve) => { notifyStarted = resolve; });
	const operation = editor.runVideoKeyframeEncoderOperation(async () => {
		notifyStarted();
		await gate;
		return 'must not publish';
	});
	await started;
	editor.dispose();
	release();
	await assert.rejects(operation, /runtime has been disposed/u);

	const fresh = createEditorFfmpeg({
		coreBaseURL: 'https://assets.invalid/ffmpeg',
		idleTimeoutMs: false,
	});
	await assert.rejects(
		fresh.runVideoKeyframeEncoderOperation((lease) => {
			lease.terminateExecution(new Error('retire this generation'));
			return 'must not publish';
		}),
		/runtime was terminated/u,
	);
	fresh.dispose();
});

test('queued operation readiness is an immutable detached snapshot', async () => {
	const editor = createEditorFfmpeg({
		coreBaseURL: 'https://assets.invalid/ffmpeg',
		idleTimeoutMs: false,
	});
	let release;
	let notifyStarted;
	const gate = new Promise((resolve) => { release = resolve; });
	const started = new Promise((resolve) => { notifyStarted = resolve; });
	const first = editor.runVideoKeyframeEncoderOperation(async () => {
		notifyStarted();
		await gate;
	});
	await started;
	const original = new AbortController();
	const replacement = new AbortController();
	const options = { signal: original.signal };
	let getterCalls = 0;
	let callbackCalls = 0;
	const queued = editor.runVideoKeyframeEncoderOperation(() => {
		callbackCalls += 1;
	}, options);
	Object.defineProperty(options, 'signal', {
		configurable: true,
		enumerable: true,
		get() { getterCalls += 1; return replacement.signal; },
	});
	const cancelled = new Error('original queued operation cancelled');
	original.abort(cancelled);
	release();
	await first;
	await assert.rejects(queued, (error) => error === cancelled);
	assert.equal(callbackCalls, 0);
	assert.equal(getterCalls, 0);
	editor.dispose();
});

test('direct operation host and runtime method accessors are never invoked', async () => {
	let hostGetterCalls = 0;
	const hostileHost = {};
	Object.defineProperty(hostileHost, 'run', {
		enumerable: true,
		get() { hostGetterCalls += 1; return async () => undefined; },
	});
	Object.defineProperty(hostileHost, 'terminateRuntime', {
		enumerable: true,
		value() {},
	});
	Object.defineProperty(hostileHost, 'isRuntimeTerminated', {
		enumerable: true,
		value() { return false; },
	});
	assert.throws(
		() => runVideoKeyframeEncoderOperation(hostileHost, () => undefined),
		/host\.run.*data property/u,
	);
	assert.equal(hostGetterCalls, 0);

	let runtimeGetterCalls = 0;
	let callbackCalls = 0;
	const runtime = {};
	for (const key of ['createInputStream', 'exec', 'statFile', 'readFileRange', 'deleteFile']) {
		Object.defineProperty(runtime, key, {
			enumerable: true,
			get() { runtimeGetterCalls += 1; return () => undefined; },
		});
	}
	const host = {
		run: async (task, beforeLoad) => { beforeLoad?.(); return task(runtime); },
		terminateRuntime() {},
		isRuntimeTerminated() { return false; },
	};
	await assert.rejects(
		runVideoKeyframeEncoderOperation(host, () => { callbackCalls += 1; }),
		/runtime\.createInputStream.*data property/u,
	);
	assert.equal(runtimeGetterCalls, 0);
	assert.equal(callbackCalls, 0);
});

test('operation scope rejects escaped calls and input streams before advancing the queue', async () => {
	for (const escape of ['call', 'stream']) {
		let terminated = false;
		let release;
		const pending = new Promise((resolve) => { release = resolve; });
		const rawStream = Object.freeze({
			path: '/escaped.rgba',
			capacityBytes: 1024,
			write() { return pending; },
			async close() {},
			abort() {},
			async dispose() {},
		});
		const runtime = Object.freeze({
			async createInputStream() { return rawStream; },
			exec() { return pending; },
			async statFile() { return { size: 1 }; },
			async readFileRange() { return Uint8Array.of(1); },
			async deleteFile() {},
		});
		const host = Object.freeze({
			run: async (operation, beforeLoad) => { beforeLoad?.(); return operation(runtime); },
			terminateRuntime() { terminated = true; },
			isRuntimeTerminated() { return terminated; },
		});
		let retainedStream;
		await assert.rejects(
			runVideoKeyframeEncoderOperation(host, async (lease) => {
				if (escape === 'call') void lease.exec(['-version']);
				else retainedStream = await lease.createInputStream('/escaped.rgba', 1024);
				return 'must not publish';
			}),
			/outstanding calls or undisposed input streams/u,
		);
		assert.equal(terminated, true);
		if (retainedStream) {
			assert.throws(() => retainedStream.abort(), /lease is no longer active/u);
		}
		release(0);
		await pending;
	}
});

test('video keyframe operation validates callback and readiness without loading FFmpeg', async () => {
	const editor = createEditorFfmpeg({
		coreBaseURL: 'https://assets.invalid/ffmpeg',
		idleTimeoutMs: false,
	});
	assert.throws(
		() => editor.runVideoKeyframeEncoderOperation(null),
		/callback must be a function/u,
	);
	const controller = new AbortController();
	const reason = new DOMException('already cancelled', 'AbortError');
	controller.abort(reason);
	await assert.rejects(
		editor.runVideoKeyframeEncoderOperation(() => undefined, { signal: controller.signal }),
		(error) => error === reason,
	);
	await assert.rejects(
		editor.runVideoKeyframeEncoderOperation(() => undefined, {
			assertCurrent() { throw new Error('stale callback'); },
		}),
		/stale callback/u,
	);
	assert.equal(MockRuntime.instances.length, 0);
	editor.dispose();
});

class MockRuntime {
	static instances = [];

	constructor() {
		this.loaded = false;
		this.loadCalls = 0;
		this.terminateCalls = 0;
		MockRuntime.instances.push(this);
	}

	on() {}
	off() {}
	async load() { this.loaded = true; this.loadCalls += 1; }
	terminate() { this.loaded = false; this.terminateCalls += 1; }
	async createInputStream() { throw new Error('unused input stream'); }
	async exec() { return 0; }
	async statFile() { return { size: 1 }; }
	async readFileRange() { return Uint8Array.of(1); }
	async deleteFile() { return true; }
}

function manualTimers() {
	let nextId = 1;
	const entries = new Map();
	return {
		setTimeout(callback, delay) {
			const id = nextId;
			nextId += 1;
			entries.set(id, { callback, delay, cleared: false });
			return { id, unref() {} };
		},
		clearTimeout(handle) { const item = entries.get(handle.id); if (item) item.cleared = true; },
		active() {
			return [...entries.entries()]
				.filter(([, item]) => !item.cleared)
				.map(([id, item]) => ({ id, delay: item.delay }));
		},
		fire(id) {
			const item = entries.get(id);
			if (!item || item.cleared) throw new Error('Timer is unavailable.');
			entries.delete(id);
			item.callback();
		},
	};
}

async function waitFor(predicate) {
	for (let count = 0; count < 100; count += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setImmediate(resolve));
	}
	throw new Error('Condition was not reached.');
}

test('tearing down a stream after the runtime is gone is a no-op, not a refusal', async () => {
	// The engine aborts the rings and terminates the runtime on any failure, and
	// the layer above it then aborts and disposes the same streams. Refusing
	// those turned every failure the engine had already unwound — a user's own
	// cancel included — into cleanup failures the caller aggregated, so the
	// AbortError it started from was no longer recognizable as one and a
	// cancellation was reported to the operator as a failed export.
	let terminated = false;
	const events = [];
	const rawStream = Object.freeze({
		path: '/late.rgba',
		capacityBytes: 1_024,
		async write() { events.push('write'); },
		async close() { events.push('close'); },
		abort() { events.push('abort'); },
		async dispose() { events.push('dispose'); },
	});
	const runtime = Object.freeze({
		async createInputStream() { return rawStream; },
		async exec() { return 0; },
		async statFile() { return { size: 1 }; },
		async readFileRange() { return Uint8Array.of(1); },
		async deleteFile() {},
	});
	const host = Object.freeze({
		run: async (operation, beforeLoad) => { beforeLoad?.(); return operation(runtime); },
		terminateRuntime() { terminated = true; },
		isRuntimeTerminated() { return terminated; },
	});
	const cancelled = Object.assign(new Error('The video export was cancelled.'), { name: 'AbortError' });

	await assert.rejects(
		runVideoKeyframeEncoderOperation(host, async (lease) => {
			const stream = await lease.createInputStream('/late.rgba', 1_024);
			// What the engine does on failure.
			stream.abort(cancelled);
			lease.terminateExecution(cancelled);
			// What the layer above it then does with the same stream.
			stream.abort(cancelled);
			await stream.dispose();
			assert.throws(() => stream.write(Uint8Array.of(1)), /runtime was terminated/u);
			throw cancelled;
		}),
		(error) => error === cancelled && error.name === 'AbortError',
	);

	assert.deepEqual(events, ['abort'], 'the ring is aborted once and never torn down twice');
	assert.equal(terminated, true);
});
