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
	READ_PROFILE_LINKED_AUDIO_RANGE_V1,
	READ_PROFILE_LINKED_VIDEO_RANGE_V1,
} from '../desktop/constants.js';
import { ReadCapabilityStore } from '../desktop/file-capabilities.js';
import { createProtocolHandler } from '../desktop/protocol.js';

const OWNER = Object.freeze({ renderer: 'linked-audio-range' });
const OTHER_OWNER = Object.freeze({ renderer: 'other' });
const FOUR_MIB = 4 * 1024 ** 2;

test('linked audio and video range capabilities share the hard admission pool', async (context) => {
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
	const video = await store.registerLinkedOriginalRangePath('/tmp/first.mp4', rangeOptions('video', 6));
	const audio = await store.registerLinkedOriginalRangePath('/tmp/second.wav', rangeOptions('audio', 4));
	assert.equal(video.readProfile, READ_PROFILE_LINKED_VIDEO_RANGE_V1);
	assert.equal(audio.readProfile, READ_PROFILE_LINKED_AUDIO_RANGE_V1);
	await assert.rejects(
		store.registerLinkedOriginalRangePath('/tmp/excess.wav', rangeOptions('audio', 7)),
		/count|limit/iu,
	);
	assert.equal(opened, 2, 'shared count refusal precedes another file open');
	assert.equal(await store.release(video.id, { owner: OWNER }), true);
	await assert.rejects(
		store.registerLinkedOriginalRangePath('/tmp/excess.wav', rangeOptions('audio', 7)),
		/byte|limit/iu,
	);
	assert.equal(handles[2].closeCalls, 1);
	for (const options of [
		{ ...rangeOptions('audio', 4), kind: 'image' },
		{ ...rangeOptions('audio', 4), mimeType: 'audio/mpeg' },
		{ ...rangeOptions('audio', 4), displayName: 'second.mp3' },
		{ ...rangeOptions('video', 4), mimeType: 'audio/wav' },
	]) await assert.rejects(
		store.registerLinkedOriginalRangePath('/tmp/rejected.wav', options),
		/audio|video|kind|MIME|name/iu,
	);
	await assert.rejects(
		store.registerLinkedOriginalRangePath('/tmp/oversized.wav', rangeOptions(
			'audio', MAX_LINKED_VIDEO_PLAYBACK_CAPABILITY_FILE_BYTES + 1,
		)),
		/file bytes|limit/iu,
	);
	assert.equal(opened, 3, 'per-file and metadata refusal do not open another handle');
});

test('linked audio range capabilities admit exact classic AIFF name and MIME pairs', async (context) => {
	let opened = 0;
	const store = new ReadCapabilityStore({
		openImpl: async () => {
			opened += 1;
			return fakeHandle(4);
		},
	});
	context.after(async () => { await store.dispose().catch(() => undefined); });
	for (const name of ['selected.aif', 'selected.aiff']) {
		const descriptor = await store.registerLinkedOriginalRangePath(`/tmp/${name}`, rangeOptions(
			'audio', 4, { displayName: name, mimeType: 'audio/aiff' },
		));
		assert.equal(descriptor.readProfile, READ_PROFILE_LINKED_AUDIO_RANGE_V1);
		assert.equal(descriptor.mimeType, 'audio/aiff');
	}
	for (const options of [
		rangeOptions('audio', 4, { displayName: 'selected.aiff', mimeType: 'audio/wav' }),
		rangeOptions('audio', 4, { displayName: 'selected.wav', mimeType: 'audio/aiff' }),
	]) await assert.rejects(
		store.registerLinkedOriginalRangePath('/tmp/rejected-audio', options),
		/AIFF|audio|MIME|name/iu,
	);
	assert.equal(opened, 2, 'metadata refusal precedes file open');
});

test('the shared range pool enforces sixteen active audio/video requests', async (context) => {
	const store = new ReadCapabilityStore({
		maximumLinkedVideoPlaybackCount: 17,
		maximumLinkedVideoPlaybackBytes: 17,
		openImpl: async () => fakeHandle(1),
	});
	context.after(async () => { await store.dispose().catch(() => undefined); });
	const descriptors = [];
	for (let index = 0; index < 17; index += 1) {
		const kind = index % 2 ? 'audio' : 'video';
		descriptors.push(await store.registerLinkedOriginalRangePath(
			kind === 'audio' ? `/tmp/${index}.wav` : `/tmp/${index}.mp4`,
			rangeOptions(kind, 1),
		));
	}
	const requests = descriptors.slice(0, 16).map(({ id, readProfile }) => {
		const request = store.acquireRequest(id, readProfile);
		assert.ok(request);
		return request;
	});
	assert.equal(store.acquireRequest(descriptors[16].id, descriptors[16].readProfile), null);
	await requests[0].close();
	const admitted = store.acquireRequest(descriptors[16].id, descriptors[16].readProfile);
	assert.ok(admitted);
	await Promise.all([...requests.slice(1).map((request) => request.close()), admitted.close()]);
});

test('linked-audio protocol serves exact stable-handle ranges and releases once by owner', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-linked-audio-range-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const selectedPath = join(root, 'selected.wav');
	const admittedPath = join(root, 'admitted.wav');
	const original = Buffer.alloc(FOUR_MIB + 3, 0x61);
	original.set(Buffer.from('old'), FOUR_MIB);
	await writeFile(selectedPath, original);
	const details = await stat(selectedPath);
	const store = new ReadCapabilityStore();
	context.after(async () => { await store.dispose().catch(() => undefined); });
	const descriptor = await store.registerLinkedOriginalRangePath(selectedPath, {
		...rangeOptions('audio', details.size),
		expectedIdentity: fileIdentity(details),
	});
	assert.equal(descriptor.readProfile, READ_PROFILE_LINKED_AUDIO_RANGE_V1);
	assert.equal('path' in descriptor, false);
	await rename(selectedPath, admittedPath);
	await writeFile(selectedPath, 'replacement');
	const handler = createProtocolHandler({ rendererRoot: root, runtimeRoot: root, readCapabilities: store });

	const head = await handler(new Request(descriptor.url, { method: 'HEAD' }));
	assert.equal(head.status, 200);
	assert.equal(head.headers.get('Content-Length'), String(original.byteLength));
	assert.equal(head.headers.get('Content-Type'), 'audio/wav');
	assert.equal(head.headers.get('Accept-Ranges'), 'bytes');
	assert.equal((await head.arrayBuffer()).byteLength, 0);
	assert.equal((await handler(new Request(descriptor.url))).status, 416);
	const first = await handler(new Request(descriptor.url, { headers: { Range: 'bytes=0-' } }));
	assert.equal(first.status, 206);
	assert.equal(first.headers.get('Content-Range'), `bytes 0-${FOUR_MIB - 1}/${original.byteLength}`);
	assert.equal(first.headers.get('Content-Length'), String(FOUR_MIB));
	assert.equal(first.headers.get('Content-Type'), 'audio/wav');
	assert.deepEqual(Buffer.from(await first.arrayBuffer()), original.subarray(0, FOUR_MIB));
	assert.equal((await handler(new Request(descriptor.url, {
		headers: { Range: `bytes=0-${FOUR_MIB}` },
	}))).status, 416);
	const suffix = await handler(new Request(descriptor.url, {
		headers: { Range: `bytes=${FOUR_MIB}-${FOUR_MIB + 2}` },
	}));
	assert.equal(suffix.status, 206);
	assert.equal(await suffix.text(), 'old');

	assert.equal(await store.release(descriptor.id, { owner: OTHER_OWNER }), false);
	assert.equal(await store.release(descriptor.id, { owner: OWNER }), true);
	assert.equal(await store.release(descriptor.id, { owner: OWNER }), false);
	assert.equal((await handler(new Request(descriptor.url, {
		headers: { Range: 'bytes=0-0' },
	}))).status, 404);
});

function rangeOptions(kind, size, overrides = {}) {
	return {
		kind,
		owner: OWNER,
		mimeType: kind === 'audio' ? 'audio/wav' : 'video/mp4',
		displayName: kind === 'audio' ? 'selected.wav' : 'selected.mp4',
		...overrides,
		expectedIdentity: { dev: 1, ino: 2, size, mtimeMs: 1, ctimeMs: 2 },
	};
}

function fileIdentity(details) {
	return {
		dev: details.dev, ino: details.ino, size: details.size,
		mtimeMs: details.mtimeMs, ctimeMs: details.ctimeMs,
	};
}

function fakeHandle(size) {
	let closeCalls = 0;
	return {
		get closeCalls() { return closeCalls; },
		async stat() { return { dev: 1, ino: 2, size, mtimeMs: 1, ctimeMs: 2, isFile: () => true }; },
		async close() { closeCalls += 1; },
		createReadStream() { throw new Error('not used'); },
	};
}
