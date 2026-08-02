/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	MAX_LINKED_VIDEO_PLAYBACK_CAPABILITIES,
	MAX_LINKED_VIDEO_PLAYBACK_CAPABILITY_BYTES,
	MAX_LINKED_VIDEO_PLAYBACK_CAPABILITY_FILE_BYTES,
	MAX_LINKED_VIDEO_PLAYBACK_RANGE_RESPONSE_BYTES,
	MAX_LINKED_VIDEO_PLAYBACK_REQUESTS,
	READ_PROFILE_LINKED_VIDEO_RANGE_V1,
} from '../desktop/constants.js';
import { ReadCapabilityStore } from '../desktop/file-capabilities.js';
import { createProtocolHandler } from '../desktop/protocol.js';

const OWNER = Object.freeze({ renderer: 'linked-video' });
const FOUR_MIB = 4 * 1024 ** 2;

test('linked-video playback admission is explicitly count- and byte-bounded', async (context) => {
	assert.equal(MAX_LINKED_VIDEO_PLAYBACK_CAPABILITIES, 128);
	assert.equal(MAX_LINKED_VIDEO_PLAYBACK_CAPABILITY_BYTES, 64 * 1024 ** 3);
	assert.equal(MAX_LINKED_VIDEO_PLAYBACK_CAPABILITY_FILE_BYTES, 512 * 1024 ** 2);
	assert.equal(MAX_LINKED_VIDEO_PLAYBACK_RANGE_RESPONSE_BYTES, FOUR_MIB);
	assert.equal(MAX_LINKED_VIDEO_PLAYBACK_REQUESTS, 16);
	const handles = [fakeHandle(6), fakeHandle(4), fakeHandle(7)];
	let opened = 0;
	const store = new ReadCapabilityStore({
		maximumLinkedVideoPlaybackCount: 2,
		maximumLinkedVideoPlaybackBytes: 10,
		openImpl: async () => handles[opened++],
	});
	context.after(async () => { await store.dispose().catch(() => undefined); });
	const first = await store.registerLinkedOriginalRangePath('/tmp/first.mp4', playbackOptions(6));
	const boundary = await store.registerLinkedOriginalRangePath('/tmp/second.mp4', playbackOptions(4));
	assert.equal(first.readProfile, READ_PROFILE_LINKED_VIDEO_RANGE_V1);
	assert.equal(boundary.readProfile, READ_PROFILE_LINKED_VIDEO_RANGE_V1);
	await assert.rejects(
		store.registerLinkedOriginalRangePath('/tmp/excess.mp4', playbackOptions(7)),
		/count|limit/iu,
	);
	assert.equal(opened, 2, 'count refusal precedes another file open');
	assert.equal(await store.release(first.id, { owner: OWNER }), true);
	await assert.rejects(
		store.registerLinkedOriginalRangePath('/tmp/excess.mp4', playbackOptions(7)),
		/byte|limit/iu,
	);
	assert.equal(handles[2].closeCalls, 1, 'byte refusal closes its candidate handle');
});

test('linked-video playback leases do not expire while their renderer owner remains active', async (context) => {
	let now = 0;
	const handle = fakeHandle(5);
	const store = new ReadCapabilityStore({ ttlMs: 1, now: () => now, openImpl: async () => handle });
	context.after(async () => { await store.dispose().catch(() => undefined); });
	const descriptor = await store.registerLinkedOriginalRangePath('/tmp/paused.mp4', playbackOptions(5));
	now = Number.MAX_SAFE_INTEGER;
	assert.deepEqual(store.get(descriptor.id), descriptor, 'paused playback remains owner-pinned');
	await store.revokeOwner(OWNER);
	assert.equal(store.get(descriptor.id), null);
	assert.equal(handle.closeCalls, 1);
});

test('playback admission binds the opened handle to the locator file identity', async (context) => {
	const replacement = fakeHandle(5);
	const store = new ReadCapabilityStore({ openImpl: async () => replacement });
	context.after(async () => { await store.dispose().catch(() => undefined); });
	await assert.rejects(
		store.registerLinkedOriginalRangePath('/tmp/raced.mp4', playbackOptions(4)),
		/changed|identity/iu,
	);
	assert.equal(replacement.closeCalls, 1);
});

test('one linked-video playback capability cannot exceed the locator file ceiling', async () => {
	let opened = false;
	const store = new ReadCapabilityStore({ openImpl: async () => { opened = true; } });
	await assert.rejects(
		store.registerLinkedOriginalRangePath('/tmp/oversized.mp4', playbackOptions(
			MAX_LINKED_VIDEO_PLAYBACK_CAPABILITY_FILE_BYTES + 1,
		)),
		/file bytes|limit/iu,
	);
	assert.equal(opened, false);
	await store.dispose();
});

test('seek cancellation drains an admitted file read before releasing its request slot', async (context) => {
	const readStarted = deferred();
	const finishRead = deferred();
	const handle = fakeHandle(5, {
		async read(buffer) {
			readStarted.resolve();
			await finishRead.promise;
			buffer[0] = 0x61;
			return { bytesRead: 1, buffer };
		},
	});
	const store = new ReadCapabilityStore({ openImpl: async () => handle });
	context.after(async () => { await store.dispose().catch(() => undefined); });
	const descriptor = await store.registerLinkedOriginalRangePath('/tmp/deferred.mp4', playbackOptions(5));
	const request = store.acquireRequest(descriptor.id, READ_PROFILE_LINKED_VIDEO_RANGE_V1);
	assert.ok(request);
	const stream = request.createReadStream({ start: 0, end: 0, autoClose: false });
	stream.resume();
	await readStarted.promise;
	const cancelling = request.cancel();
	assert.equal(store.acquireRequest(descriptor.id, READ_PROFILE_LINKED_VIDEO_RANGE_V1), null);
	assert.equal(await remainsPending(cancelling), true);
	finishRead.resolve();
	await cancelling;
	const next = store.acquireRequest(descriptor.id, READ_PROFILE_LINKED_VIDEO_RANGE_V1);
	assert.ok(next);
	await next.close();
});

test('the playback protocol serves bounded sequential ranges from the admitted open handle', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-linked-playback-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const selectedPath = join(root, 'selected.mp4');
	const movedPath = join(root, 'admitted.mp4');
	const original = Buffer.alloc(FOUR_MIB + 3, 0x61);
	original.set(Buffer.from('old'), FOUR_MIB);
	await writeFile(selectedPath, original);
	const store = new ReadCapabilityStore();
	context.after(async () => { await store.dispose().catch(() => undefined); });
	const descriptor = await store.registerLinkedOriginalRangePath(
		selectedPath,
		playbackOptionsFromStat(await stat(selectedPath)),
	);
	await rename(selectedPath, movedPath);
	await writeFile(selectedPath, 'replacement');
	const handler = createProtocolHandler({
		rendererRoot: root,
		runtimeRoot: root,
		readCapabilities: store,
	});

	const rejectedWholeBody = await handler(new Request(descriptor.url));
	assert.equal(rejectedWholeBody.status, 416);
	const first = await handler(new Request(descriptor.url, { headers: { Range: 'bytes=0-' } }));
	assert.equal(first.status, 206);
	assert.equal(first.headers.get('Content-Range'), `bytes 0-${FOUR_MIB - 1}/${original.byteLength}`);
	assert.equal(first.headers.get('Content-Length'), String(FOUR_MIB));
	assert.deepEqual(Buffer.from(await first.arrayBuffer()), original.subarray(0, FOUR_MIB));
	const cancelled = await handler(new Request(descriptor.url, { headers: { Range: 'bytes=0-1' } }));
	assert.equal(cancelled.status, 206);
	await cancelled.body.cancel('seek');
	const afterCancel = await handler(new Request(descriptor.url, {
		headers: { Range: 'bytes=2-2' },
	}));
	assert.equal(afterCancel.status, 206, 'cancelling a seek range releases only its request slot');
	await afterCancel.arrayBuffer();
	const suffix = await handler(new Request(descriptor.url, {
		headers: { Range: `bytes=${FOUR_MIB}-${FOUR_MIB + 2}` },
	}));
	assert.equal(suffix.status, 206);
	assert.equal(Buffer.from(await suffix.arrayBuffer()).toString(), 'old');

	assert.equal(await store.release(descriptor.id, { owner: OWNER }), true);
	assert.equal((await handler(new Request(descriptor.url, {
		headers: { Range: 'bytes=0-0' },
	}))).status, 404, 'release fences every later range request');
});

function playbackOptions(size) {
	return {
		kind: 'video',
		owner: OWNER,
		mimeType: 'video/mp4',
		displayName: 'selected.mp4',
		expectedIdentity: { dev: 1, ino: 2, size, mtimeMs: 1, ctimeMs: 2 },
	};
}

function playbackOptionsFromStat(details) {
	return {
		kind: 'video',
		owner: OWNER,
		mimeType: 'video/mp4',
		displayName: 'selected.mp4',
		expectedIdentity: {
			dev: details.dev,
			ino: details.ino,
			size: details.size,
			mtimeMs: details.mtimeMs,
			ctimeMs: details.ctimeMs,
		},
	};
}

function fakeHandle(size, options = {}) {
	let closeCalls = 0;
	return {
		get closeCalls() { return closeCalls; },
		async stat() {
			return { dev: 1, ino: 2, size, mtimeMs: 1, ctimeMs: 2, isFile: () => true };
		},
		async close() { closeCalls += 1; },
		read: options.read,
		createReadStream() { throw new Error('not used'); },
	};
}

function deferred() {
	let resolve;
	const promise = new Promise((fulfill) => { resolve = fulfill; });
	return { promise, resolve };
}

async function remainsPending(promise) {
	const pending = Symbol('pending');
	return Promise.race([
		Promise.resolve(promise).then(() => false, () => false),
		new Promise((resolve) => setImmediate(resolve, pending)),
	]).then((value) => value === pending);
}
