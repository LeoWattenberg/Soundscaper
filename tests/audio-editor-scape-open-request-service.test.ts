/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EditorControllerLifetime } from '../src/common/editor/controller/lifecycle.ts';
import {
	SCAPE_OPEN_REQUEST_TASK,
	createScapeOpenRequestService,
} from '../src/common/editor/controller/scape-open-request-service.ts';

function deferred<Value>() {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}

test('a non-colliding request releases continuation ownership before native open', async () => {
	const lifetime = new EditorControllerLifetime();
	const file = new Blob(['project']);
	const expected = Object.freeze({ opened: true });
	const capture: { signal: AbortSignal | null } = { signal: null };
	let chooserCalls = 0;
	const service = createScapeOpenRequestService({
		lifetime,
		inspectScape: async (input, options) => {
			assert.equal(input, file);
			capture.signal = options.signal;
			return { exists: false, title: 'New project' };
		},
		openScape: (input, options) => {
			assert.equal(input, file);
			assert.deepEqual(options, { collision: 'copy' });
			lifetime.cancelTask(SCAPE_OPEN_REQUEST_TASK);
			assert.equal(capture.signal?.aborted, false, 'native open begins after request ownership is released');
			return expected;
		},
	});

	const result = await service.openScapeFile(file, () => {
		chooserCalls += 1;
		return 'cancel';
	});

	assert.equal(result, expected);
	assert.equal(chooserCalls, 0);
});

test('an incompatible non-colliding request requires an explicit decision before read-only open', async () => {
	const lifetime = new EditorControllerLifetime();
	const file = new Blob(['incompatible']);
	const inspected = Object.freeze({
		exists: false,
		title: 'Incompatible project',
		featureRequirementsCompatibility: Object.freeze({ compatible: false }),
	});
	const opens: unknown[][] = [];
	const requests: unknown[] = [];
	const service = createScapeOpenRequestService({
		lifetime,
		inspectScape: () => inspected,
		openScape: (...args) => { opens.push(args); return 'opened'; },
	});

	assert.deepEqual(await service.openScapeFile(file, (request) => {
		requests.push(request);
		assert.equal(request.kind, 'compatibility');
		return 'cancel';
	}), { cancelled: true });
	assert.deepEqual(opens, []);
	assert.equal(requests.length, 1);
	assert.equal((requests[0] as Readonly<{ inspected?: unknown }>).inspected, inspected);

	assert.equal(await service.openScapeFile(file, (request) => {
		requests.push(request);
		assert.equal(request.kind, 'compatibility');
		return 'open-read-only';
	}), 'opened');
	assert.deepEqual(opens, [[file, { collision: 'copy' }]]);
	assert.equal(requests.length, 2);
	assert.equal(Object.isFrozen(requests[1]), true);
	await assert.rejects(service.openScapeFile(file, () => 'replace'), /open read-only.*cancel/iu);
	assert.equal(opens.length, 1);
});

test('an incompatible collision asks once and only permits a read-only copy', async () => {
	const file = new Blob(['combined']);
	const inspected = Object.freeze({
		exists: true,
		title: 'Combined decision',
		featureRequirementsCompatibility: Object.freeze({ compatible: false }),
	});
	const requests: unknown[] = [];
	const opens: unknown[][] = [];
	const service = createScapeOpenRequestService({
		lifetime: new EditorControllerLifetime(),
		inspectScape: () => inspected,
		openScape: (...args) => { opens.push(args); return 'opened'; },
	});

	assert.equal(await service.openScapeFile(file, (request) => {
		requests.push(request);
		assert.equal(request.kind, 'compatibility-collision');
		assert.equal(request.inspected, inspected);
		return 'copy-read-only';
	}), 'opened');
	assert.equal(requests.length, 1);
	assert.deepEqual(opens, [[file, { collision: 'copy' }]]);

	assert.deepEqual(await service.openScapeFile(file, (request) => {
		requests.push(request);
		assert.equal(request.kind, 'compatibility-collision');
		return 'cancel';
	}), { cancelled: true });
	assert.equal(requests.length, 2);
	assert.equal(opens.length, 1);
	await assert.rejects(service.openScapeFile(file, () => 'replace'), /read-only copy.*cancel/iu);
	assert.equal(opens.length, 1);
});

test('compatible and future-schema null reports do not create a feature decision', async () => {
	const compatible = new Blob(['compatible']);
	const future = new Blob(['future']);
	const opens: unknown[][] = [];
	let chooserCalls = 0;
	const service = createScapeOpenRequestService({
		lifetime: new EditorControllerLifetime(),
		inspectScape: (file) => ({
			exists: false,
			featureRequirementsCompatibility: file === compatible ? { compatible: true } : null,
		}),
		openScape: (...args) => { opens.push(args); return 'opened'; },
	});
	const choose = () => { chooserCalls += 1; return 'cancel' as const; };

	assert.equal(await service.openScapeFile(compatible, choose), 'opened');
	assert.equal(await service.openScapeFile(future, choose), 'opened');
	assert.equal(chooserCalls, 0);
	assert.deepEqual(opens, [
		[compatible, { collision: 'copy' }],
		[future, { collision: 'copy' }],
	]);
});

test('a collision choice uses its owned file once and explicit cancel opens nothing', async () => {
	const lifetime = new EditorControllerLifetime();
	const file = new Blob(['collision']);
	const inspected = Object.freeze({ exists: true, title: 'Existing project' });
	const opens: unknown[][] = [];
	const service = createScapeOpenRequestService({
		lifetime,
		inspectScape: () => inspected,
		openScape: (...args) => { opens.push(args); return 'opened'; },
	});
	const requests: unknown[] = [];

	assert.equal(await service.openScapeFile(file, (request) => {
		requests.push(request);
		assert.equal(request.kind, 'collision');
		assert.equal(request.file, file);
		assert.equal(request.inspected, inspected);
		assert.ok(request.signal instanceof AbortSignal);
		return 'replace';
	}), 'opened');
	assert.deepEqual(opens, [[file, { collision: 'replace' }]]);
	assert.equal(Object.isFrozen(requests[0]), true);

	assert.deepEqual(
		await service.openScapeFile(file, () => 'cancel'),
		{ cancelled: true },
	);
	assert.equal(opens.length, 1);
});

test('a replacement promptly rejects an abort-ignoring stale chooser with the exact reason', async () => {
	const lifetime = new EditorControllerLifetime();
	const late = deferred<'copy'>();
	const started = deferred<void>();
	const capture: { signal: AbortSignal | null } = { signal: null };
	let chooserCalls = 0;
	let openCalls = 0;
	const service = createScapeOpenRequestService({
		lifetime,
		inspectScape: () => ({ exists: true }),
		openScape: () => { openCalls += 1; return 'opened'; },
	});
	const first = service.openScapeFile(new Blob(['first']), (request) => {
		chooserCalls += 1;
		capture.signal = request.signal;
		started.resolve();
		return late.promise;
	});
	await started.promise;
	const firstRejected = assert.rejects(first, (error) => error === capture.signal?.reason);

	assert.deepEqual(
		await service.openScapeFile(new Blob(['second']), () => {
			chooserCalls += 1;
			return 'cancel';
		}),
		{ cancelled: true },
	);
	await firstRejected;
	assert.equal(capture.signal?.aborted, true);
	late.resolve('copy');
	await Promise.resolve();
	assert.equal(openCalls, 0);
	assert.equal(chooserCalls, 2);
});

test('a replacement promptly rejects an abort-ignoring stale inspection', async () => {
	const lifetime = new EditorControllerLifetime();
	const firstFile = new Blob(['first']);
	const lateInspection = deferred<{ exists: boolean }>();
	const inspectionStarted = deferred<void>();
	const capture: { signal: AbortSignal | null } = { signal: null };
	let openCalls = 0;
	const service = createScapeOpenRequestService({
		lifetime,
		inspectScape: (file, options) => {
			if (file !== firstFile) return { exists: true };
			capture.signal = options.signal;
			inspectionStarted.resolve();
			return lateInspection.promise;
		},
		openScape: () => { openCalls += 1; return 'opened'; },
	});
	const first = service.openScapeFile(firstFile, () => 'copy');
	await inspectionStarted.promise;
	const firstRejected = assert.rejects(first, (error) => error === capture.signal?.reason);

	assert.deepEqual(
		await service.openScapeFile(new Blob(['second']), () => 'cancel'),
		{ cancelled: true },
	);
	await firstRejected;
	lateInspection.resolve({ exists: false });
	await Promise.resolve();
	assert.equal(openCalls, 0);
});

test('caller cancellation and terminal disposal preserve their exact reasons', async () => {
	const callerLifetime = new EditorControllerLifetime();
	const caller = new AbortController();
	const callerStarted = deferred<void>();
	const callerCapture: { signal: AbortSignal | null } = { signal: null };
	const callerLate = deferred<'copy'>();
	const callerService = createScapeOpenRequestService({
		lifetime: callerLifetime,
		inspectScape: () => ({ exists: true }),
		openScape: () => 'unreachable',
	});
	const callerPending = callerService.openScapeFile(new Blob(['caller']), (request) => {
		callerCapture.signal = request.signal;
		callerStarted.resolve();
		return callerLate.promise;
	}, { signal: caller.signal });
	await callerStarted.promise;
	const callerReason = new DOMException('Caller cancelled.', 'AbortError');
	caller.abort(callerReason);
	await assert.rejects(callerPending, (error) => error === callerReason);
	assert.equal(callerCapture.signal?.reason, callerReason);
	callerLate.resolve('copy');

	const disposalLifetime = new EditorControllerLifetime();
	const disposalStarted = deferred<void>();
	const disposalCapture: { signal: AbortSignal | null } = { signal: null };
	const disposalLate = deferred<'replace'>();
	const disposalService = createScapeOpenRequestService({
		lifetime: disposalLifetime,
		inspectScape: () => ({ exists: true }),
		openScape: () => 'unreachable',
	});
	const disposalPending = disposalService.openScapeFile(new Blob(['dispose']), (request) => {
		disposalCapture.signal = request.signal;
		disposalStarted.resolve();
		return disposalLate.promise;
	});
	await disposalStarted.promise;
	disposalLifetime.beginDisposal();
	const disposalReason = disposalCapture.signal?.reason;
	await assert.rejects(disposalPending, (error) => error === disposalReason);
	assert.equal((disposalReason as Readonly<{ code?: string }>)?.code, 'DISPOSED');
	disposalLate.resolve('replace');
});
