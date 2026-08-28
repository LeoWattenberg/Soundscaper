/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { ReadCapabilityStore } from '../desktop/file-capabilities.js';

const OWNER = Object.freeze({ name: 'renderer-owner' });
const OTHER_OWNER = Object.freeze({ name: 'other-renderer-owner' });

test('read capability release fences and drains its one active request before handle close', async () => {
	const stream = controlledStream();
	const handle = fakeHandle({ size: 4, stream });
	const store = new ReadCapabilityStore({ openImpl: async () => handle });
	const descriptor = await store.registerPath('/tmp/leased.scape', { owner: OWNER });
	assert.equal(Object.hasOwn(store.get(descriptor.id), 'handle'), false, 'lookup never exposes the raw handle');
	const lease = store.acquireRequest(descriptor.id);
	assert.ok(lease);
	assert.equal(lease.size, 4);
	assert.equal(store.acquireRequest(descriptor.id), null, 'one capability admits only one active request');
	assert.equal(lease.createReadStream({ start: 0, end: 3, autoClose: false }), stream);

	const releasing = store.release(descriptor.id, { owner: OWNER });
	const joinedRelease = store.release(descriptor.id, { owner: OWNER });
	const wrongOwnerRelease = store.release(descriptor.id, { owner: OTHER_OWNER });
	assert.equal(store.get(descriptor.id), null, 'retirement fences lookup synchronously');
	assert.equal(stream.destroyCalls, 1);
	assert.equal(handle.closeCalls, 0, 'the handle remains open until the request stream settles');
	assert.equal(await wrongOwnerRelease, false, 'retirement remains opaque to another owner');
	assert.equal(await remainsPending(releasing), true);
	assert.equal(await remainsPending(joinedRelease), true);

	stream.finish();
	assert.equal(await releasing, true);
	assert.equal(await joinedRelease, true, 'a correct repeated release joins in-progress retirement');
	assert.equal(handle.closeCalls, 1);
	assert.equal(stream.destroyCalls, 1);
	await store.dispose();
});

test('stream construction failure and idempotent lease close release the request slot', async () => {
	const stream = controlledStream();
	let createCalls = 0;
	const handle = fakeHandle({
		size: 1,
		createReadStreamImpl() {
			createCalls += 1;
			if (createCalls === 1) throw new Error('injected stream construction failure');
			return stream;
		},
	});
	const store = new ReadCapabilityStore({ openImpl: async () => handle });
	const descriptor = await store.registerPath('/tmp/retry.scape', { owner: OWNER });
	const failed = store.acquireRequest(descriptor.id);
	assert.ok(failed);
	assert.throws(
		() => failed.createReadStream({ start: 0, end: 0, autoClose: false }),
		/stream construction failure/iu,
	);
	const firstClose = failed.close();
	assert.equal(failed.close(), firstClose);
	await firstClose;

	const retry = store.acquireRequest(descriptor.id);
	assert.ok(retry, 'failed stream construction does not leave the capability busy');
	retry.createReadStream({ start: 0, end: 0, autoClose: false });
	stream.emit('end');
	await retry.close();
	await store.dispose();
});

test('an invalid stream candidate retires its lease and permits a serialized retry', async () => {
	const handle = fakeHandle({
		size: 1,
		createReadStreamImpl: () => ({
			once() {},
			removeListener() {},
		}),
	});
	const store = new ReadCapabilityStore({ openImpl: async () => handle });
	const descriptor = await store.registerPath('/tmp/invalid-stream.scape', { owner: OWNER });
	const failed = store.acquireRequest(descriptor.id);
	assert.ok(failed);
	assert.throws(
		() => failed.createReadStream({ start: 0, end: 0, autoClose: false }),
		/invalid stream/iu,
	);

	const retry = store.acquireRequest(descriptor.id);
	assert.ok(retry, 'invalid stream construction must release the per-capability request slot');
	await retry.close();
	await store.dispose();
});

test('stream error keeps retirement pending until stream close is acknowledged', async () => {
	const stream = controlledStream();
	const handle = fakeHandle({ size: 1, stream });
	const store = new ReadCapabilityStore({ openImpl: async () => handle });
	const descriptor = await store.registerPath('/tmp/error-close.scape', { owner: OWNER });
	const lease = store.acquireRequest(descriptor.id);
	assert.ok(lease);
	lease.createReadStream({ start: 0, end: 0, autoClose: false });
	stream.emit('error', new Error('injected stream failure'));

	const releasing = store.release(descriptor.id, { owner: OWNER });
	assert.equal(handle.closeCalls, 0);
	assert.equal(await remainsPending(releasing), true, 'error alone is not the stream teardown barrier');
	stream.finish();
	assert.equal(await releasing, true);
	assert.equal(handle.closeCalls, 1);
	await store.dispose();
});

test('new capability ids cannot alias an in-progress retirement tombstone', async () => {
	const firstStream = controlledStream();
	const firstHandle = fakeHandle({ size: 1, stream: firstStream });
	const secondHandle = fakeHandle({ size: 1 });
	const handles = [firstHandle, secondHandle];
	let openCalls = 0;
	let randomCalls = 0;
	const store = new ReadCapabilityStore({
		openImpl: async () => handles[openCalls++],
		randomBytesImpl: (size) => Buffer.alloc(size, randomCalls++ < 2 ? 1 : 2),
	});
	const firstDescriptor = await store.registerPath('/tmp/first.scape', { owner: OWNER });
	const lease = store.acquireRequest(firstDescriptor.id);
	assert.ok(lease);
	lease.createReadStream({ start: 0, end: 0, autoClose: false });
	const retiring = store.release(firstDescriptor.id, { owner: OWNER });

	const secondDescriptor = await store.registerPath('/tmp/second.scape', { owner: OWNER });
	assert.notEqual(secondDescriptor.id, firstDescriptor.id);
	assert.equal(randomCalls, 3, 'the retiring token collision is retried');
	firstStream.finish();
	await retiring;
	await store.dispose();
});

test('normal request completion permits the next serialized capability request', async () => {
	const firstStream = controlledStream();
	const secondStream = controlledStream();
	const handle = fakeHandle({ size: 2, streams: [firstStream, secondStream] });
	const store = new ReadCapabilityStore({ openImpl: async () => handle });
	const descriptor = await store.registerPath('/tmp/serialized.scape', { owner: OWNER });
	const first = store.acquireRequest(descriptor.id);
	assert.ok(first);
	first.createReadStream({ start: 0, end: 0, autoClose: false });
	firstStream.emit('end');
	await first.close();

	const second = store.acquireRequest(descriptor.id);
	assert.ok(second, 'a settled request releases the per-capability request slot');
	second.createReadStream({ start: 1, end: 1, autoClose: false });
	secondStream.emit('end');
	await second.close();
	assert.equal(handle.createReadStreamCalls, 2);
	await store.dispose();
});

for (const [name, retire] of [
	['owner revocation', (store) => store.revokeOwner(OWNER)],
	['store disposal', (store) => store.dispose()],
]) {
	test(`${name} destroys and drains an active read request`, async () => {
		const stream = controlledStream();
		const handle = fakeHandle({ size: 1, stream });
		const store = new ReadCapabilityStore({ openImpl: async () => handle });
		const descriptor = await store.registerPath(`/tmp/${name}.scape`, { owner: OWNER });
		const lease = store.acquireRequest(descriptor.id);
		assert.ok(lease);
		lease.createReadStream({ start: 0, end: 0, autoClose: false });

		const retiring = retire(store);
		assert.equal(store.get(descriptor.id), null);
		assert.equal(stream.destroyCalls, 1);
		assert.equal(handle.closeCalls, 0);
		assert.equal(await remainsPending(retiring), true);

		stream.finish();
		await retiring;
		assert.equal(handle.closeCalls, 1);
	});
}

test('request admission renews inactivity expiry and explicit release joins failed expiry cleanup', async () => {
	let now = 0;
	let openCalls = 0;
	let randomCalls = 0;
	const closeFailure = new Error('injected expiry close failure');
	const stream = controlledStream();
	const failingHandle = fakeHandle({
		size: 1,
		stream,
		closeImpl: async () => { throw closeFailure; },
	});
	const replacementHandle = fakeHandle({ size: 1 });
	const handles = [failingHandle, replacementHandle];
	const store = new ReadCapabilityStore({
		ttlMs: 10_000,
		now: () => now,
		openImpl: async () => handles[openCalls++],
		randomBytesImpl: (size) => Buffer.alloc(size, ++randomCalls <= 2 ? 1 : 2),
	});
	const descriptor = await store.registerPath('/tmp/expiring.scape', { owner: OWNER });
	now = 9_000;
	const renewal = store.acquireRequest(descriptor.id);
	assert.ok(renewal);
	await renewal.close();
	now = 10_001;
	assert.ok(store.get(descriptor.id), 'the original expiry no longer retires a recently used capability');

	const active = store.acquireRequest(descriptor.id);
	assert.ok(active);
	active.createReadStream({ start: 0, end: 0, autoClose: false });
	now = 20_002;
	assert.equal(store.get(descriptor.id), null, 'the renewed inactivity deadline still retires a stalled request');
	const joinedRelease = store.release(descriptor.id, { owner: OWNER });
	assert.equal(stream.destroyCalls, 1);
	assert.equal(await remainsPending(joinedRelease), true);
	stream.finish();

	await assert.rejects(joinedRelease, (error) => error.cause === closeFailure);
	await assert.rejects(
		store.release(descriptor.id, { owner: OWNER }),
		(error) => error.cause === closeFailure,
		'a settled failed expiry remains observable to the correct owner',
	);
	assert.equal(failingHandle.closeCalls, 1);
	await assert.rejects(store.revokeOwner(OWNER), /cleanup|close/iu);

	const replacement = await store.registerPath('/tmp/replacement.scape', { owner: OTHER_OWNER });
	assert.equal(replacement.id, descriptor.id, 'owner revocation clears its settled retirement tombstones');
	assert.equal(randomCalls, 2, 'a cleared tombstone does not force an id collision retry');
	assert.equal(await store.release(replacement.id, { owner: OTHER_OWNER }), true);
	assert.equal(replacementHandle.closeCalls, 1);
	await assert.rejects(store.dispose(), /cleanup|close/iu);
});

function controlledStream() {
	const stream = new EventEmitter();
	let destroyCalls = 0;
	Object.defineProperties(stream, {
		destroyCalls: { get: () => destroyCalls },
		destroyed: { get: () => destroyCalls > 0 },
	});
	stream.destroy = () => {
		destroyCalls += 1;
		return stream;
	};
	stream.finish = () => stream.emit('close');
	return stream;
}

function fakeHandle({
	size,
	stream = null,
	streams = null,
	closeImpl = null,
	createReadStreamImpl = null,
}) {
	let closeCalls = 0;
	let createReadStreamCalls = 0;
	return {
		get closeCalls() { return closeCalls; },
		get createReadStreamCalls() { return createReadStreamCalls; },
		async stat() {
			return { size, mtimeMs: 123, isFile: () => true };
		},
		createReadStream(options) {
			const result = createReadStreamImpl
				? createReadStreamImpl(options)
				: streams?.[createReadStreamCalls] ?? stream;
			createReadStreamCalls += 1;
			return result;
		},
		async close() {
			closeCalls += 1;
			if (closeImpl) await closeImpl();
		},
	};
}

async function remainsPending(promise) {
	const marker = Symbol('pending');
	return Promise.race([
		Promise.resolve(promise).then(() => false, () => false),
		new Promise((resolve) => setImmediate(resolve, marker)),
	]).then((result) => result === marker);
}
