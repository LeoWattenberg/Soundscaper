/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	APP_ORIGIN,
	MAX_READ_CAPABILITY_BYTES_PER_OWNER,
	MAX_SCAPE_RANGE_READ_CAPABILITIES,
	MAX_SCAPE_RANGE_READ_CAPABILITY_BYTES,
	READ_CAPABILITY_PREFIX,
	READ_PROFILE_MATERIALIZED_V1,
	READ_PROFILE_SCAPE_RANGE_V1,
	SCAPE_PROJECT_MIME_TYPE,
} from '../desktop/constants.js';
import { ReadCapabilityStore } from '../desktop/file-capabilities.js';

const OWNER_A = Object.freeze({ name: 'renderer-owner-a' });
const OWNER_B = Object.freeze({ name: 'renderer-owner-b' });

test('read descriptors, lookups, leases, and URLs carry their main-assigned profile', async (context) => {
	const handles = [fakeHandle({ size: 3 }), fakeHandle({ size: 8 * 1024 ** 3 })];
	const store = new ReadCapabilityStore({ openImpl: async () => handles.shift() });
	context.after(async () => { await store.dispose().catch(() => undefined); });

	const materialized = await store.registerPath('/tmp/clip.wav', {
		owner: OWNER_A,
		readProfile: READ_PROFILE_SCAPE_RANGE_V1,
	});
	const ranged = await store.registerScapeRangePath('/tmp/session.scape', {
		owner: OWNER_A,
		displayName: 'forged.wav',
		mimeType: 'audio/wav',
	});

	assert.equal(materialized.readProfile, READ_PROFILE_MATERIALIZED_V1);
	assert.equal(ranged.readProfile, READ_PROFILE_SCAPE_RANGE_V1);
	assert.equal(ranged.name, 'session.scape', 'range identity is derived from the actual selected path');
	assert.equal(ranged.mimeType, SCAPE_PROJECT_MIME_TYPE);
	assert.equal(
		ranged.url,
		`${APP_ORIGIN}${READ_CAPABILITY_PREFIX}${READ_PROFILE_SCAPE_RANGE_V1}/${ranged.id}/session.scape`,
	);
	assert.equal(store.get(materialized.id)?.readProfile, READ_PROFILE_MATERIALIZED_V1);
	assert.equal(store.get(ranged.id)?.readProfile, READ_PROFILE_SCAPE_RANGE_V1);

	const materializedLease = store.acquireRequest(materialized.id, READ_PROFILE_MATERIALIZED_V1);
	assert.equal(materializedLease?.readProfile, READ_PROFILE_MATERIALIZED_V1);
	await materializedLease?.close();
	const rangeLease = store.acquireRequest(ranged.id, READ_PROFILE_SCAPE_RANGE_V1);
	assert.equal(rangeLease?.readProfile, READ_PROFILE_SCAPE_RANGE_V1);
	await rangeLease?.close();
});

test('Scape range registration derives canonical identity from a terminal .scape path', async (context) => {
	let openCalls = 0;
	const store = new ReadCapabilityStore({
		openImpl: async () => {
			openCalls += 1;
			return fakeHandle({ size: 1 });
		},
	});
	context.after(async () => { await store.dispose().catch(() => undefined); });

	for (const path of ['/tmp/disguised.scape.zip', '/tmp/audacity.aup3', '/tmp/no-extension']) {
		await assert.rejects(store.registerScapeRangePath(path, { owner: OWNER_A }), /\.scape|project/iu);
	}
	assert.equal(openCalls, 0, 'invalid range paths are rejected before opening a filesystem handle');

	const descriptor = await store.registerScapeRangePath('/tmp/UPPER.SCAPE', { owner: OWNER_A });
	assert.equal(descriptor.name, 'UPPER.SCAPE');
	assert.equal(descriptor.mimeType, SCAPE_PROJECT_MIME_TYPE);
	assert.equal(openCalls, 1);
});

test('read descriptors normalize pre-epoch filesystem timestamps before publication', async (context) => {
	const store = new ReadCapabilityStore({
		openImpl: async () => fakeHandle({ size: 1, mtimeMs: -1_234.5 }),
	});
	context.after(async () => { await store.dispose().catch(() => undefined); });

	const descriptor = await store.registerScapeRangePath('/tmp/archive.scape', { owner: OWNER_A });
	assert.equal(descriptor.lastModified, 0);
	assert.equal(store.get(descriptor.id)?.lastModified, 0);
});

test('large Scape ranges have an independent 65 GiB boundary and materialized reads remain at 512 MiB', async (context) => {
	const boundaryHandle = fakeHandle({ size: MAX_SCAPE_RANGE_READ_CAPABILITY_BYTES });
	const rangeExcessHandle = fakeHandle({ size: MAX_SCAPE_RANGE_READ_CAPABILITY_BYTES + 1 });
	const materializedExcessHandle = fakeHandle({ size: MAX_READ_CAPABILITY_BYTES_PER_OWNER + 1 });
	const handles = [boundaryHandle, rangeExcessHandle, materializedExcessHandle];
	const store = new ReadCapabilityStore({ openImpl: async () => handles.shift() });
	context.after(async () => { await store.dispose().catch(() => undefined); });

	const boundary = await store.registerScapeRangePath('/tmp/boundary.scape', { owner: OWNER_A });
	assert.equal(boundary.size, MAX_SCAPE_RANGE_READ_CAPABILITY_BYTES);
	await assert.rejects(
		store.registerScapeRangePath('/tmp/excess.scape', { owner: OWNER_B }),
		/range|bytes|limit/iu,
	);
	await assert.rejects(
		store.registerMaterializedPath('/tmp/excess.wav', { owner: OWNER_B }),
		/bytes|limit/iu,
	);
	assert.equal(rangeExcessHandle.closeCalls, 1);
	assert.equal(materializedExcessHandle.closeCalls, 1, 'rejected materialized candidates are closed');
});

test('Scape range count is reserved before open and enforced globally across owners', async (context) => {
	const opened = deferred();
	const continueOpen = deferred();
	let openCalls = 0;
	const store = new ReadCapabilityStore({
		maximumScapeRangeCount: 2,
		openImpl: async () => {
			openCalls += 1;
			if (openCalls === 2) opened.resolve();
			await continueOpen.promise;
			return fakeHandle({ size: 1 });
		},
	});
	context.after(async () => {
		continueOpen.resolve();
		await store.dispose().catch(() => undefined);
	});

	const first = store.registerScapeRangePath('/tmp/first.scape', { owner: OWNER_A });
	const second = store.registerScapeRangePath('/tmp/second.scape', { owner: OWNER_B });
	await opened.promise;
	await assert.rejects(
		store.registerScapeRangePath('/tmp/third.scape', { owner: Object.freeze({ name: 'owner-c' }) }),
		/range|count|limit/iu,
	);
	assert.equal(openCalls, 2, 'the global pending-capability limit is enforced before another open');
	continueOpen.resolve();
	const [firstDescriptor] = await Promise.all([first, second]);
	await store.release(firstDescriptor.id, { owner: OWNER_A });
	await store.registerScapeRangePath('/tmp/replacement.scape', { owner: OWNER_A });
	assert.equal(openCalls, 3, 'successful retirement returns the range count reservation');
});

test('Scape range bytes are enforced both per owner and globally, separately from materialized bytes', async (context) => {
	const handles = [
		fakeHandle({ size: 6 }),
		fakeHandle({ size: 5 }),
		fakeHandle({ size: 4 }),
		fakeHandle({ size: 1 }),
		fakeHandle({ size: 10 }),
	];
	const store = new ReadCapabilityStore({
		maximumBytes: 10,
		maximumScapeRangeBytes: 10,
		openImpl: async () => handles.shift(),
	});
	context.after(async () => { await store.dispose().catch(() => undefined); });

	await store.registerScapeRangePath('/tmp/six.scape', { owner: OWNER_A });
	await assert.rejects(
		store.registerScapeRangePath('/tmp/per-owner-excess.scape', { owner: OWNER_A }),
		/range|bytes|limit/iu,
	);
	await store.registerScapeRangePath('/tmp/four.scape', { owner: OWNER_B });
	await assert.rejects(
		store.registerScapeRangePath('/tmp/global-excess.scape', {
			owner: Object.freeze({ name: 'renderer-owner-c' }),
		}),
		/range|bytes|limit/iu,
	);
	const materialized = await store.registerMaterializedPath('/tmp/ten.wav', { owner: OWNER_A });
	assert.equal(materialized.size, 10, 'range bytes do not consume the materialization ledger');
});

test('the shared per-owner capability count includes both read profiles', async (context) => {
	let openCalls = 0;
	const store = new ReadCapabilityStore({
		maximumCount: 1,
		openImpl: async () => {
			openCalls += 1;
			return fakeHandle({ size: 1 });
		},
	});
	context.after(async () => { await store.dispose().catch(() => undefined); });

	await store.registerScapeRangePath('/tmp/project.scape', { owner: OWNER_A });
	await assert.rejects(
		store.registerMaterializedPath('/tmp/clip.wav', { owner: OWNER_A }),
		/count|limit/iu,
	);
	assert.equal(openCalls, 1);
});

test('failed Scape candidate cleanup retains its charge and fences further range admission', async (context) => {
	const closeFailure = new Error('injected candidate close failure');
	const failing = fakeHandle({ size: 8, closeImpl: async () => { throw closeFailure; } });
	const materialized = fakeHandle({ size: 1 });
	let openCalls = 0;
	let randomCalls = 0;
	const store = new ReadCapabilityStore({
		maximumScapeRangeBytes: 8,
		openImpl: async () => (++openCalls === 1 ? failing : materialized),
		randomBytesImpl: (size) => {
			randomCalls += 1;
			if (randomCalls === 1) throw new Error('injected capability id failure');
			return Buffer.alloc(size, 1);
		},
	});
	context.after(async () => { await store.dispose().catch(() => undefined); });

	await assert.rejects(
		store.registerScapeRangePath('/tmp/failing.scape', { owner: OWNER_A }),
		(error) => error instanceof AggregateError && error.cause?.cause === closeFailure,
	);
	await assert.rejects(
		store.registerScapeRangePath('/tmp/refused.scape', { owner: OWNER_B }),
		/fenced|cleanup/iu,
	);
	assert.equal(openCalls, 1, 'a fenced range admission never opens another candidate');
	const ordinary = await store.registerMaterializedPath('/tmp/ordinary.wav', { owner: OWNER_B });
	assert.equal(ordinary.readProfile, READ_PROFILE_MATERIALIZED_V1);
});

test('failed retirement cleanup fences range admission until store replacement', async (context) => {
	const closeFailure = new Error('injected retirement close failure');
	const failing = fakeHandle({ size: 2, closeImpl: async () => { throw closeFailure; } });
	let openCalls = 0;
	const store = new ReadCapabilityStore({
		openImpl: async () => {
			openCalls += 1;
			return failing;
		},
	});
	context.after(async () => { await store.dispose().catch(() => undefined); });
	const descriptor = await store.registerScapeRangePath('/tmp/failing.scape', { owner: OWNER_A });

	await assert.rejects(store.release(descriptor.id, { owner: OWNER_A }), (error) => error.cause === closeFailure);
	await assert.rejects(
		store.registerScapeRangePath('/tmp/refused.scape', { owner: OWNER_B }),
		/fenced|cleanup/iu,
	);
	assert.equal(openCalls, 1);
});

test('profile mismatch and global range concurrency refusal happen before expiry renewal', async (context) => {
	let now = 0;
	const handles = [fakeHandle({ size: 1 }), fakeHandle({ size: 1 }), fakeHandle({ size: 1 })];
	const store = new ReadCapabilityStore({
		ttlMs: 10_000,
		now: () => now,
		openImpl: async () => handles.shift(),
	});
	context.after(async () => { await store.dispose().catch(() => undefined); });
	const first = await store.registerScapeRangePath('/tmp/first.scape', { owner: OWNER_A });
	const second = await store.registerScapeRangePath('/tmp/second.scape', { owner: OWNER_B });
	const ordinary = await store.registerMaterializedPath('/tmp/ordinary.wav', { owner: OWNER_B });

	now = 9_000;
	assert.equal(store.acquireRequest(first.id, READ_PROFILE_MATERIALIZED_V1), null);
	const active = store.acquireRequest(second.id, READ_PROFILE_SCAPE_RANGE_V1);
	assert.ok(active);
	assert.equal(store.acquireRequest(first.id, READ_PROFILE_SCAPE_RANGE_V1), null);
	const ordinaryLease = store.acquireRequest(ordinary.id, READ_PROFILE_MATERIALIZED_V1);
	assert.ok(ordinaryLease, 'a materialized request does not consume the range request slot');
	await ordinaryLease.close();
	now = 10_001;
	assert.equal(store.get(first.id), null, 'neither refusal renewed the first range capability');

	await active.close();
	const next = store.acquireRequest(second.id, READ_PROFILE_SCAPE_RANGE_V1);
	assert.ok(next, 'settling the active range request releases the global slot');
	assert.equal(next.readProfile, READ_PROFILE_SCAPE_RANGE_V1);
	await next.close();
});

test('range stream-construction failure releases the global request slot', async (context) => {
	const handles = [fakeHandle({ size: 1 }), fakeHandle({ size: 1 })];
	const store = new ReadCapabilityStore({ openImpl: async () => handles.shift() });
	context.after(async () => { await store.dispose().catch(() => undefined); });
	const first = await store.registerScapeRangePath('/tmp/first.scape', { owner: OWNER_A });
	const second = await store.registerScapeRangePath('/tmp/second.scape', { owner: OWNER_B });
	const failedLease = store.acquireRequest(first.id, READ_PROFILE_SCAPE_RANGE_V1);
	assert.ok(failedLease);
	assert.throws(
		() => failedLease.createReadStream({ start: 0, end: 0, autoClose: false }),
		/unexpected stream/iu,
	);
	await failedLease.close();
	const nextLease = store.acquireRequest(second.id, READ_PROFILE_SCAPE_RANGE_V1);
	assert.ok(nextLease);
	await nextLease.close();
});

test('production Scape range limits are fixed at four capabilities and 65 GiB', () => {
	assert.equal(MAX_SCAPE_RANGE_READ_CAPABILITIES, 4);
	assert.equal(MAX_SCAPE_RANGE_READ_CAPABILITY_BYTES, 65 * 1024 ** 3);
	assert.throws(
		() => new ReadCapabilityStore({ maximumScapeRangeCount: MAX_SCAPE_RANGE_READ_CAPABILITIES + 1 }),
		/positive|no greater/iu,
	);
	assert.throws(
		() => new ReadCapabilityStore({ maximumScapeRangeBytes: MAX_SCAPE_RANGE_READ_CAPABILITY_BYTES + 1 }),
		/non-negative|no greater/iu,
	);
});

function fakeHandle({ size, mtimeMs = 1_700_000_000_000, closeImpl = async () => undefined } = {}) {
	let closeCalls = 0;
	return {
		get closeCalls() { return closeCalls; },
		async stat() {
			return { isFile: () => true, size, mtimeMs };
		},
		async close() {
			closeCalls += 1;
			return closeImpl();
		},
		createReadStream() {
			throw new Error('unexpected stream request');
		},
	};
}

function deferred() {
	return Promise.withResolvers();
}
