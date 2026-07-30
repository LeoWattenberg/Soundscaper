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

async function assertRejectsPromptly(
	promise: Promise<unknown>,
	validate: (error: unknown) => boolean,
): Promise<void> {
	let timeout: ReturnType<typeof setTimeout> | null = null;
	const deadline = new Promise<never>((_resolve, reject) => {
		timeout = setTimeout(() => reject(new Error('Expected prompt cancellation rejection.')), 1_000);
	});
	try {
		await Promise.race([assert.rejects(promise, validate), deadline]);
	} finally {
		if (timeout !== null) clearTimeout(timeout);
	}
}

test('a non-colliding request carries its owned signal through native open', async () => {
	const lifetime = new EditorControllerLifetime();
	const file = new Blob(['project']);
	const expected = Object.freeze({ opened: true });
	const opened = deferred<typeof expected>();
	const openStarted = deferred<void>();
	const capture: { inspectionSignal: AbortSignal | null; openSignal: AbortSignal | null } = {
		inspectionSignal: null,
		openSignal: null,
	};
	let chooserCalls = 0;
	const service = createScapeOpenRequestService({
		lifetime,
		inspectScape: async (input, options) => {
			assert.equal(input, file);
			capture.inspectionSignal = options.signal;
			return { exists: false, title: 'New project' };
		},
		openScape: (input, options) => {
			assert.equal(input, file);
			assert.equal(options.collision, 'copy');
			capture.openSignal = options.signal;
			openStarted.resolve();
			return opened.promise;
		},
	});

	const opening = service.openScapeFile(file, () => {
		chooserCalls += 1;
		return 'cancel';
	});
	await openStarted.promise;
	assert.ok(capture.openSignal instanceof AbortSignal);
	assert.equal(capture.openSignal, capture.inspectionSignal);
	assert.equal(capture.openSignal.aborted, false);
	opened.resolve(expected);
	const result = await opening;
	lifetime.cancelTask(SCAPE_OPEN_REQUEST_TASK);

	assert.equal(result, expected);
	assert.equal(capture.openSignal.aborted, false, 'settled open releases its request ownership');
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
		openScape: (input, options) => {
			assert.ok(options.signal instanceof AbortSignal);
			opens.push([input, { collision: options.collision }]);
			return 'opened';
		},
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
		openScape: (input, options) => {
			assert.ok(options.signal instanceof AbortSignal);
			opens.push([input, { collision: options.collision }]);
			return 'opened';
		},
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
		openScape: (input, options) => {
			assert.ok(options.signal instanceof AbortSignal);
			opens.push([input, { collision: options.collision }]);
			return 'opened';
		},
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
		openScape: (input, options) => {
			assert.ok(options.signal instanceof AbortSignal);
			opens.push([input, { collision: options.collision }]);
			return 'opened';
		},
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

test('a replacement promptly rejects an abort-ignoring stale native open', async () => {
	const lifetime = new EditorControllerLifetime();
	const firstFile = new Blob(['first']);
	const lateOpen = deferred<'opened'>();
	const openStarted = deferred<void>();
	const capture: { signal: AbortSignal | null } = { signal: null };
	let openCalls = 0;
	const service = createScapeOpenRequestService({
		lifetime,
		inspectScape: (file) => ({ exists: file !== firstFile }),
		openScape: (_file, options) => {
			openCalls += 1;
			capture.signal = options.signal;
			openStarted.resolve();
			return lateOpen.promise;
		},
	});
	const first = service.openScapeFile(firstFile, () => 'cancel');
	let fulfilledResults = 0;
	void first.then(
		() => { fulfilledResults += 1; },
		() => undefined,
	);
	await openStarted.promise;
	assert.ok(capture.signal instanceof AbortSignal);

	assert.deepEqual(
		await service.openScapeFile(new Blob(['second']), () => 'cancel'),
		{ cancelled: true },
	);
	await assertRejectsPromptly(first, (error) => error === capture.signal?.reason);
	assert.equal(capture.signal.aborted, true);
	assert.equal(openCalls, 1);
	lateOpen.resolve('opened');
	await Promise.resolve();
	assert.equal(openCalls, 1);
	assert.equal(fulfilledResults, 0);
});

test('caller cancellation and terminal disposal reject abort-ignoring opens with their exact reasons', async () => {
	const callerLifetime = new EditorControllerLifetime();
	const caller = new AbortController();
	const callerStarted = deferred<void>();
	const callerCapture: { signal: AbortSignal | null } = { signal: null };
	const callerLate = deferred<'opened'>();
	const callerService = createScapeOpenRequestService({
		lifetime: callerLifetime,
		inspectScape: () => ({ exists: false }),
		openScape: (_file, options) => {
			callerCapture.signal = options.signal;
			callerStarted.resolve();
			return callerLate.promise;
		},
	});
	const callerPending = callerService.openScapeFile(
		new Blob(['caller']),
		() => 'cancel',
		{ signal: caller.signal },
	);
	await callerStarted.promise;
	const callerReason = 'primitive caller cancellation';
	caller.abort(callerReason);
	await assertRejectsPromptly(callerPending, (error) => error === callerReason);
	assert.equal(callerCapture.signal?.reason, callerReason);
	callerLate.resolve('opened');

	const disposalLifetime = new EditorControllerLifetime();
	const disposalStarted = deferred<void>();
	const disposalCapture: { signal: AbortSignal | null } = { signal: null };
	const disposalLate = deferred<'opened'>();
	const disposalService = createScapeOpenRequestService({
		lifetime: disposalLifetime,
		inspectScape: () => ({ exists: false }),
		openScape: (_file, options) => {
			disposalCapture.signal = options.signal;
			disposalStarted.resolve();
			return disposalLate.promise;
		},
	});
	const disposalPending = disposalService.openScapeFile(new Blob(['dispose']), () => 'cancel');
	await disposalStarted.promise;
	disposalLifetime.beginDisposal();
	const disposalReason = disposalCapture.signal?.reason;
	await assertRejectsPromptly(disposalPending, (error) => error === disposalReason);
	assert.equal((disposalReason as Readonly<{ code?: string }>)?.code, 'DISPOSED');
	disposalLate.resolve('opened');
});
