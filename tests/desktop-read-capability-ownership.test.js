/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	MAX_READ_CAPABILITIES_PER_OWNER,
	MAX_READ_CAPABILITY_BYTES_PER_OWNER,
} from '../desktop/constants.js';
import { ReadCapabilityStore, throwAfterReadCapabilityRollback } from '../desktop/file-capabilities.js';

const OWNER_A = Object.freeze({ name: 'renderer-owner-a' });
const OWNER_B = Object.freeze({ name: 'renderer-owner-b' });

test('read capabilities isolate owner release and revoke only that owner', async (context) => {
	const handleA = fakeHandle({ size: 3 });
	const handleB = fakeHandle({ size: 4 });
	const handles = new Map([
		['/tmp/owner-a.wav', handleA],
		['/tmp/owner-b.wav', handleB],
	]);
	const store = new ReadCapabilityStore({ openImpl: async (filePath) => handles.get(filePath) });
	context.after(async () => { await store.dispose().catch(() => undefined); });
	const descriptorA = await store.registerPath('/tmp/owner-a.wav', { owner: OWNER_A });
	const descriptorB = await store.registerPath('/tmp/owner-b.wav', { owner: OWNER_B });

	assert.equal(await store.release(descriptorA.id, { owner: OWNER_B }), false);
	assert.equal(await store.release('unknown-capability', { owner: OWNER_B }), false,
		'wrong-owner and unknown releases must be indistinguishable');
	assert.equal(handleA.closeCalls, 0);
	assert.ok(store.get(descriptorA.id));
	assert.ok(store.get(descriptorB.id));

	await store.revokeOwner(OWNER_B);
	assert.equal(handleB.closeCalls, 1);
	assert.equal(store.get(descriptorB.id), null);
	assert.equal(handleA.closeCalls, 0, 'revoking owner B must not close owner A');
	assert.ok(store.get(descriptorA.id), 'revoking owner B must not remove owner A');
	await assert.rejects(
		store.registerPath('/tmp/revoked-owner.wav', { owner: OWNER_B }),
		/revoked|owner/iu,
	);

	assert.equal(await store.release(descriptorA.id, { owner: OWNER_A }), true);
	assert.equal(handleA.closeCalls, 1);
	assert.equal(store.get(descriptorA.id), null);
});

test('owner revocation fences and drains a delayed read registration', async () => {
	const statStarted = deferred();
	const continueStat = deferred();
	const handle = fakeHandle({
		size: 8,
		statImpl: async () => {
			statStarted.resolve();
			await continueStat.promise;
			return regularFileDetails(8);
		},
	});
	let openCalls = 0;
	const store = new ReadCapabilityStore({
		openImpl: async () => {
			openCalls += 1;
			return handle;
		},
	});
	const registering = store.registerPath('/tmp/delayed.wav', { owner: OWNER_A });
	await statStarted.promise;
	let revoking;
	try {
		assert.equal(typeof store.revokeOwner, 'function', 'read capabilities need owner revocation');
		revoking = store.revokeOwner(OWNER_A);
		let revokeSettled = false;
		void revoking.then(
			() => { revokeSettled = true; },
			() => { revokeSettled = true; },
		);
		await Promise.resolve();
		assert.equal(revokeSettled, false, 'revocation must wait for an admitted registration');

		continueStat.resolve();
		await assert.rejects(registering, /revoked|owner/iu);
		await revoking;
		assert.equal(handle.closeCalls, 1);
		await assert.rejects(
			store.registerPath('/tmp/late.wav', { owner: OWNER_A }),
			/revoked|owner/iu,
		);
		assert.equal(openCalls, 1, 'a revoked owner is refused before another file is opened');
	} finally {
		continueStat.resolve();
		await Promise.allSettled([registering, ...(revoking ? [revoking] : [])]);
		await store.dispose().catch(() => undefined);
	}
});

test('read capability count admission is independent per owner and refuses excess deterministically', async (context) => {
	const firstHandle = fakeHandle({ size: 2 });
	const otherOwnerHandle = fakeHandle({ size: 1 });
	let openCalls = 0;
	const store = new ReadCapabilityStore({
		maximumCount: 1,
		maximumBytes: 100,
		openImpl: async () => {
			openCalls += 1;
			return openCalls === 1 ? firstHandle : otherOwnerHandle;
		},
	});
	context.after(async () => { await store.dispose().catch(() => undefined); });
	const admitted = await store.registerPath('/tmp/admitted.wav', { owner: OWNER_A });
	const otherOwner = await store.registerPath('/tmp/other-owner.wav', { owner: OWNER_B });

	await assert.rejects(
		store.registerPath('/tmp/excess.wav', { owner: OWNER_A }),
		/capabilit|count|entr|limit/iu,
	);
	assert.ok(store.get(admitted.id));
	assert.ok(store.get(otherOwner.id));
	assert.equal(firstHandle.closeCalls, 0);
	assert.equal(otherOwnerHandle.closeCalls, 0);
	assert.equal(openCalls, 2, 'an over-limit owner is refused before another file is opened');
});

test('read capability count is reserved before the first file-open await', async (context) => {
	const openStarted = deferred();
	const continueOpen = deferred();
	const firstHandle = fakeHandle({ size: 1 });
	let openCalls = 0;
	const store = new ReadCapabilityStore({
		maximumCount: 1,
		maximumBytes: 100,
		openImpl: async () => {
			openCalls += 1;
			openStarted.resolve();
			await continueOpen.promise;
			return firstHandle;
		},
	});
	context.after(async () => { await store.dispose().catch(() => undefined); });
	const first = store.registerPath('/tmp/pending.wav', { owner: OWNER_A });
	await openStarted.promise;

	await assert.rejects(
		store.registerPath('/tmp/refused-before-open.wav', { owner: OWNER_A }),
		/count|limit/iu,
	);
	assert.equal(openCalls, 1);
	continueOpen.resolve();
	assert.ok(store.get((await first).id));
});

test('a capability slot remains reserved until handle close is acknowledged', async (context) => {
	const closeStarted = deferred();
	const continueClose = deferred();
	const firstHandle = fakeHandle({
		size: 1,
		closeImpl: async () => {
			closeStarted.resolve();
			await continueClose.promise;
		},
	});
	const replacementHandle = fakeHandle({ size: 1 });
	const handles = [firstHandle, replacementHandle];
	let openCalls = 0;
	const store = new ReadCapabilityStore({
		maximumCount: 1,
		maximumBytes: 100,
		openImpl: async () => handles[openCalls++],
	});
	context.after(async () => { await store.dispose().catch(() => undefined); });
	const descriptor = await store.registerPath('/tmp/closing.wav', { owner: OWNER_A });
	const releasing = store.release(descriptor.id, { owner: OWNER_A });
	await closeStarted.promise;
	try {
		await assert.rejects(
			store.registerPath('/tmp/replacement-before-close.wav', { owner: OWNER_A }),
			/count|limit/iu,
		);
		assert.equal(openCalls, 1);
	} finally {
		continueClose.resolve();
	}
	assert.equal(await releasing, true);
	assert.ok(store.get((await store.registerPath('/tmp/replacement.wav', { owner: OWNER_A })).id));
});

test('read capability byte admission closes an over-budget candidate', async (context) => {
	const firstHandle = fakeHandle({ size: 6 });
	const boundaryHandle = fakeHandle({ size: 4 });
	const excessHandle = fakeHandle({ size: 1 });
	let openCalls = 0;
	const handles = [firstHandle, boundaryHandle, excessHandle];
	const store = new ReadCapabilityStore({
		maximumCount: 4,
		maximumBytes: 10,
		openImpl: async () => {
			const handle = handles[openCalls];
			openCalls += 1;
			return handle;
		},
	});
	context.after(async () => { await store.dispose().catch(() => undefined); });
	const admitted = await store.registerPath('/tmp/six-bytes.wav', { owner: OWNER_A });
	const boundary = await store.registerPath('/tmp/four-more-bytes.wav', { owner: OWNER_A });

	await assert.rejects(
		store.registerPath('/tmp/one-excess-byte.wav', { owner: OWNER_A }),
		/byte|capabilit|limit/iu,
	);
	assert.equal(openCalls, 3, 'the candidate must be inspected before its size is admitted');
	assert.equal(excessHandle.closeCalls, 1);
	assert.ok(store.get(admitted.id));
	assert.ok(store.get(boundary.id), 'the exact aggregate-byte boundary remains admissible');
	assert.equal(firstHandle.closeCalls, 0);
	assert.equal(boundaryHandle.closeCalls, 0);
});

test('production per-owner read bytes allow exactly 512 MiB and refuse the next byte', async (context) => {
	assert.equal(MAX_READ_CAPABILITY_BYTES_PER_OWNER, 512 * 1024 ** 2);
	const boundaryHandle = fakeHandle({ size: MAX_READ_CAPABILITY_BYTES_PER_OWNER });
	const excessHandle = fakeHandle({ size: 1 });
	const handles = [boundaryHandle, excessHandle];
	let openCalls = 0;
	const store = new ReadCapabilityStore({
		openImpl: async () => handles[openCalls++],
	});
	context.after(async () => { await store.dispose().catch(() => undefined); });
	const boundary = await store.registerPath('/tmp/exact-production-boundary.wav', { owner: OWNER_A });

	await assert.rejects(
		store.registerPath('/tmp/one-byte-over-production-budget.wav', { owner: OWNER_A }),
		/byte|capabilit|limit/iu,
	);
	assert.equal(openCalls, 2, 'declared size is inspected before aggregate-byte admission');
	assert.ok(store.get(boundary.id), 'the exact 512 MiB boundary remains published');
	assert.equal(boundaryHandle.closeCalls, 0);
	assert.equal(excessHandle.closeCalls, 1, 'the unpublished over-budget candidate is closed');
});

test('production read capability ceilings cannot be raised through test seams', () => {
	assert.throws(
		() => new ReadCapabilityStore({ maximumCount: MAX_READ_CAPABILITIES_PER_OWNER + 1 }),
		/count.*no greater|limit/iu,
	);
	assert.throws(
		() => new ReadCapabilityStore({ maximumBytes: MAX_READ_CAPABILITY_BYTES_PER_OWNER + 1 }),
		/byte.*no greater|limit/iu,
	);
});

test('descriptor construction failure rolls back the candidate handle and admission', async (context) => {
	const nativeSetTimeout = globalThis.setTimeout;
	let timerCalls = 0;
	context.mock.method(globalThis, 'setTimeout', (...args) => {
		timerCalls += 1;
		return nativeSetTimeout(...args);
	});
	const rejectedHandle = fakeHandle({ size: 1 });
	const replacementHandle = fakeHandle({ size: 1 });
	const handles = [rejectedHandle, replacementHandle];
	let randomValue = 1;
	let openCalls = 0;
	const store = new ReadCapabilityStore({
		maximumCount: 1,
		maximumBytes: 10,
		openImpl: async () => handles[openCalls++],
		randomBytesImpl: (size) => Buffer.alloc(size, randomValue++),
	});
	context.after(async () => { await store.dispose().catch(() => undefined); });
	await assert.rejects(
		store.registerPath('/tmp/invalid-name.wav', { owner: OWNER_A, displayName: 'bad\ud800name' }),
		/URI|surrogate|malformed/iu,
	);
	assert.equal(rejectedHandle.closeCalls, 1);
	assert.equal(store.get('01'.repeat(32)), null);
	assert.equal(timerCalls, 0, 'an unpublished capability must not retain an expiry timer');

	const replacement = await store.registerPath('/tmp/replacement.wav', { owner: OWNER_A });
	assert.ok(store.get(replacement.id));
	assert.equal(timerCalls, 1);
	assert.equal(openCalls, 2);
});

test('failed candidate cleanup retains its slot and fails later disposal', async () => {
	const cleanupFailure = new Error('injected refused-candidate close failure');
	const candidate = fakeHandle({
		size: 1,
		closeImpl: async () => { throw cleanupFailure; },
	});
	let openCalls = 0;
	const store = new ReadCapabilityStore({
		maximumCount: 1,
		maximumBytes: 0,
		openImpl: async () => {
			openCalls += 1;
			return candidate;
		},
	});
	await assert.rejects(
		store.registerPath('/tmp/over-budget.wav', { owner: OWNER_A }),
		/AggregateError|cleanup|close/iu,
	);
	await assert.rejects(
		store.registerPath('/tmp/must-not-open.wav', { owner: OWNER_A }),
		/count|limit/iu,
	);
	assert.equal(openCalls, 1);
	await assert.rejects(store.dispose(), /cleanup|close/iu);
});

test('multi-file rollback drains every close and preserves every failure', async () => {
	const primaryFailure = new Error('injected later-selection failure');
	const cleanupFailure = new Error('injected first rollback close failure');
	const delayedCloseStarted = Promise.withResolvers();
	const continueDelayedClose = Promise.withResolvers();
	const failing = fakeHandle({
		size: 1,
		closeImpl: async () => { throw cleanupFailure; },
	});
	const delayed = fakeHandle({
		size: 1,
		closeImpl: async () => {
			delayedCloseStarted.resolve();
			await continueDelayedClose.promise;
		},
	});
	const handles = [failing, delayed];
	let openCalls = 0;
	const store = new ReadCapabilityStore({ openImpl: async () => handles[openCalls++] });
	const descriptors = [
		await store.registerPath('/tmp/rollback-failing.wav', { owner: OWNER_A }),
		await store.registerPath('/tmp/rollback-delayed.wav', { owner: OWNER_A }),
	];
	const rollingBack = throwAfterReadCapabilityRollback(store, descriptors, OWNER_A, primaryFailure);
	await delayedCloseStarted.promise;
	let settled = false;
	void rollingBack.then(
		() => { settled = true; },
		() => { settled = true; },
	);
	await Promise.resolve();
	assert.equal(settled, false, 'rollback must await the delayed close after another close fails');
	continueDelayedClose.resolve();

	await assert.rejects(rollingBack, (error) => {
		assert.ok(error instanceof AggregateError);
		assert.equal(error.cause, primaryFailure);
		assert.equal(error.errors[0], primaryFailure);
		assert.equal(error.errors.length, 2);
		assert.equal(error.errors[1].cause, cleanupFailure);
		return true;
	});
	assert.equal(failing.closeCalls, 1);
	assert.equal(delayed.closeCalls, 1);
	await store.dispose().catch(() => undefined);
});

test('successful read rollback rethrows the primary registration failure', async () => {
	const handle = fakeHandle({ size: 1 });
	const store = new ReadCapabilityStore({ openImpl: async () => handle });
	const descriptor = await store.registerPath('/tmp/rollback-success.wav', { owner: OWNER_A });
	const primaryFailure = new Error('injected primary registration failure');

	await assert.rejects(
		throwAfterReadCapabilityRollback(store, [descriptor], OWNER_A, primaryFailure),
		(error) => error === primaryFailure,
	);
	assert.equal(handle.closeCalls, 1);
	await store.dispose();
});

test('read capability disposal fences and drains a delayed registration', async () => {
	const openStarted = deferred();
	const continueOpen = deferred();
	const handle = fakeHandle({ size: 7 });
	const store = new ReadCapabilityStore({
		openImpl: async () => {
			openStarted.resolve();
			await continueOpen.promise;
			return handle;
		},
	});
	const registering = store.registerPath('/tmp/dispose-race.wav', { owner: OWNER_A });
	await openStarted.promise;
	const disposing = store.dispose();
	let disposeSettled = false;
	void disposing.then(
		() => { disposeSettled = true; },
		() => { disposeSettled = true; },
	);
	try {
		await Promise.resolve();
		assert.equal(disposeSettled, false, 'disposal must wait for an admitted registration');
		continueOpen.resolve();
		await assert.rejects(registering, /disposed|shutting down|closed/iu);
		await disposing;
		assert.equal(handle.closeCalls, 1);
		await assert.rejects(
			store.registerPath('/tmp/after-dispose.wav', { owner: OWNER_B }),
			/disposed|shutting down|closed/iu,
		);
	} finally {
		continueOpen.resolve();
		const lateDescriptor = await registering.catch(() => null);
		if (lateDescriptor) {
			await store.release(lateDescriptor.id, { owner: OWNER_A }).catch(() => undefined);
		}
		await disposing.catch(() => undefined);
	}
});

test('read capability disposal reports an unacknowledged handle close', async () => {
	const closeFailure = new Error('injected read handle close failure');
	const handle = fakeHandle({
		size: 1,
		closeImpl: async () => { throw closeFailure; },
	});
	const store = new ReadCapabilityStore({ openImpl: async () => handle });
	await store.registerPath('/tmp/close-failure.wav', { owner: OWNER_A });

	await assert.rejects(store.dispose(), (error) => {
		assert.match(String(error?.message || error), /close|cleanup/iu);
		return true;
	});
	assert.equal(handle.closeCalls, 1);
});

test('owner revocation attempts every handle close before reporting cleanup failure', async () => {
	const closeFailure = new Error('injected owner read close failure');
	const failing = fakeHandle({ size: 1, closeImpl: async () => { throw closeFailure; } });
	const successful = fakeHandle({ size: 1 });
	const handles = [failing, successful];
	let openCalls = 0;
	const store = new ReadCapabilityStore({ openImpl: async () => handles[openCalls++] });
	await store.registerPath('/tmp/failing-close.wav', { owner: OWNER_A });
	await store.registerPath('/tmp/successful-close.wav', { owner: OWNER_A });

	await assert.rejects(store.revokeOwner(OWNER_A), /cleanup|close/iu);
	assert.equal(failing.closeCalls, 1);
	assert.equal(successful.closeCalls, 1);
	await store.dispose().catch(() => undefined);
});

function fakeHandle({ size, statImpl = null, closeImpl = null }) {
	let closeCalls = 0;
	return {
		get closeCalls() { return closeCalls; },
		async stat() {
			return statImpl ? statImpl() : regularFileDetails(size);
		},
		async close() {
			closeCalls += 1;
			if (closeImpl) await closeImpl();
		},
	};
}

function regularFileDetails(size) {
	return { size, mtimeMs: 123, isFile: () => true };
}

function deferred() {
	let resolve;
	const promise = new Promise((complete) => { resolve = complete; });
	return { promise, resolve };
}
