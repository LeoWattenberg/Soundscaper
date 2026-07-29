/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EditorControllerLifetime } from '../src/common/editor/controller/lifecycle.ts';
import {
	SCAPE_INSPECTION_TASK,
	createScapeInspectionService,
} from '../src/common/editor/controller/scape-inspection-service.ts';

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}

test('inspection owns its signal and snapshots caller options before async work', async () => {
	const lifetime = new EditorControllerLifetime();
	const caller = new AbortController();
	const file = new Blob(['scape']);
	const store = { loadProject: async () => null };
	const capture: { received: Readonly<Record<string, unknown>> | null } = { received: null };
	const expected = Object.freeze({ id: 'inspected' });
	const service = createScapeInspectionService({
		lifetime,
		store,
		inspectScapeProject: async (input, receivedStore, options) => {
			assert.equal(input, file);
			assert.equal(receivedStore, store);
			capture.received = options;
			return expected;
		},
	});
	const options = { marker: 'snapshot', signal: caller.signal };
	const result = await service.inspect(file, options);

	assert.equal(result, expected);
	assert.ok(capture.received);
	assert.equal(capture.received.marker, 'snapshot');
	assert.ok(capture.received.signal instanceof AbortSignal);
	assert.notEqual(capture.received.signal, caller.signal, 'caller options cannot replace the owned task signal');
	options.marker = 'mutated';
	assert.equal(capture.received.marker, 'snapshot');
	lifetime.cancelTask(SCAPE_INSPECTION_TASK);
	assert.equal(capture.received.signal.aborted, false, 'completed inspection releases its task');
});

test('inspection composes caller cancellation and preserves its exact reason', async () => {
	const lifetime = new EditorControllerLifetime();
	const caller = new AbortController();
	const capture: { signal: AbortSignal | null } = { signal: null };
	const service = createScapeInspectionService({
		lifetime,
		store: null,
		inspectScapeProject: async (_input, _store, options) => {
			capture.signal = options.signal;
			return new Promise((_resolve, reject) => {
				options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
			});
		},
	});
	const reason = new DOMException('Caller cancelled inspection.', 'AbortError');
	const pending = service.inspect(new Blob(['caller']), { signal: caller.signal });

	caller.abort(reason);

	await assert.rejects(pending, (error) => error === reason);
	assert.equal(capture.signal?.reason, reason);
});

test('inspection releases its task when caller option snapshotting throws', async () => {
	const taskController = new AbortController();
	let finishCalls = 0;
	const service = createScapeInspectionService({
		lifetime: {
			startTask: (name) => ({
				name,
				generation: 1,
				signal: taskController.signal,
				assertCurrent() {},
				finish() { finishCalls += 1; },
			}),
		},
		store: null,
		inspectScapeProject: () => 'unreachable',
	});
	const reason = new Error('Option snapshot failed.');
	const options: Record<string, unknown> = {};
	Object.defineProperty(options, 'archiveLimits', {
		enumerable: true,
		get() { throw reason; },
	});

	await assert.rejects(service.inspect(new Blob(['options']), options), (error) => error === reason);
	assert.equal(finishCalls, 1);
});

test('a replacement inspection aborts its predecessor with the exact task reason', async () => {
	const lifetime = new EditorControllerLifetime();
	let calls = 0;
	const capture: { signal: AbortSignal | null } = { signal: null };
	const service = createScapeInspectionService({
		lifetime,
		store: null,
		inspectScapeProject: async (_input, _store, options) => {
			calls += 1;
			if (calls !== 1) return 'replacement';
			capture.signal = options.signal;
			return new Promise<string>((_resolve, reject) => {
				options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
			});
		},
	});

	const first = service.inspect(new Blob(['first']));
	const firstRejected = assert.rejects(first, (error) => error === capture.signal?.reason);
	const second = service.inspect(new Blob(['second']));
	const expectedReason = capture.signal?.reason;

	assert.equal(await second, 'replacement');
	await firstRejected;
	assert.ok(expectedReason instanceof DOMException);
	assert.equal(expectedReason.name, 'AbortError');
});

test('a replacement rejects a late predecessor result even when its inspector ignores abort', async () => {
	const lifetime = new EditorControllerLifetime();
	const late = deferred<string>();
	let calls = 0;
	const capture: { signal: AbortSignal | null } = { signal: null };
	const service = createScapeInspectionService({
		lifetime,
		store: null,
		inspectScapeProject: (_input, _store, options) => {
			calls += 1;
			if (calls !== 1) return 'replacement';
			capture.signal = options.signal;
			return late.promise;
		},
	});
	const first = service.inspect(new Blob(['first']));
	const firstRejected = assert.rejects(first, (error) => error === capture.signal?.reason);

	assert.equal(await service.inspect(new Blob(['second'])), 'replacement');
	late.resolve('stale result');

	await firstRejected;
	assert.equal(capture.signal?.aborted, true);
});

test('terminal disposal aborts inspection exactly and rejects a late stale result', async () => {
	const lifetime = new EditorControllerLifetime();
	const capture: { signal: AbortSignal | null } = { signal: null };
	const service = createScapeInspectionService({
		lifetime,
		store: null,
		inspectScapeProject: async (_input, _store, options) => {
			capture.signal = options.signal;
			return new Promise((_resolve, reject) => {
				options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
			});
		},
	});

	const pending = service.inspect(new Blob(['dispose']));
	const rejected = assert.rejects(pending, (error) => error === capture.signal?.reason);
	assert.equal(lifetime.beginDisposal(), true);
	const expectedReason = capture.signal?.reason;
	await rejected;
	assert.equal((expectedReason as Readonly<{ code?: string }>)?.code, 'DISPOSED');

	const late = deferred<string>();
	const secondLifetime = new EditorControllerLifetime();
	const lateCapture: { signal: AbortSignal | null } = { signal: null };
	const stale = createScapeInspectionService({
		lifetime: secondLifetime,
		store: null,
		inspectScapeProject: (_input, _store, options) => {
			lateCapture.signal = options.signal;
			return late.promise;
		},
	}).inspect(new Blob(['late']));
	secondLifetime.beginDisposal();
	const lateReason = lateCapture.signal?.reason;
	late.resolve('stale result');
	await assert.rejects(stale, (error) => error === lateReason);
});
