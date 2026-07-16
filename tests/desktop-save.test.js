import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ReadCapabilityStore } from '../desktop/file-capabilities.js';
import { MAX_SAVE_CHUNK_BYTES } from '../desktop/constants.js';
import { AtomicSaveManager, SaveTargetStore } from '../desktop/save-targets.js';

test('read capabilities expose opaque same-origin descriptors and expire cleanly', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-read-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const input = join(root, 'private project.aup4');
	await writeFile(input, 'project data');
	let now = 100;
	const store = new ReadCapabilityStore({ ttlMs: 1000, now: () => now });
	context.after(() => store.dispose());
	const descriptor = await store.registerPath(input);
	assert.equal(descriptor.name, 'private project.aup4');
	assert.equal(descriptor.size, 12);
	assert.match(descriptor.url, /^soundscaper-app:\/\/bundle\/_desktop\/read\/[a-f0-9]{64}\//u);
	assert.equal(String(descriptor).includes(input), false);
	assert.ok(store.get(descriptor.id));
	now = 1100;
	assert.equal(store.get(descriptor.id), null);
});

test('chunked saves use sequential backpressure and atomically replace the destination', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-save-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const destination = join(root, 'copy.aup4');
	await writeFile(destination, 'original');
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({ targets });
	context.after(() => manager.dispose());
	const target = targets.registerPath(destination);
	const { writeId, chunkSize } = await manager.begin({ targetId: target.id, size: 6 });
	assert.equal(chunkSize, MAX_SAVE_CHUNK_BYTES);
	assert.deepEqual(await manager.writeChunk({ writeId, offset: 0, bytes: new Uint8Array([1, 2, 3]) }), { nextOffset: 3 });
	await assert.rejects(() => manager.writeChunk({ writeId, offset: 2, bytes: new Uint8Array([4]) }), /out of sequence/u);
	assert.deepEqual(await manager.writeChunk({ writeId, offset: 3, bytes: new Uint8Array([4, 5, 6]) }), { nextOffset: 6 });
	assert.deepEqual(await manager.finish(writeId), { byteLength: 6 });
	assert.deepEqual([...await readFile(destination)], [1, 2, 3, 4, 5, 6]);
	assert.equal((await readdir(root)).some((name) => name.endsWith('.soundscaper-part')), false);
});

test('aborting and failed completion preserve an existing destination', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-abort-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const destination = join(root, 'copy.aup4');
	await writeFile(destination, 'original');
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({ targets });
	context.after(() => manager.dispose());

	let target = targets.registerPath(destination);
	let session = await manager.begin({ targetId: target.id, size: 5 });
	await manager.writeChunk({ writeId: session.writeId, offset: 0, bytes: new TextEncoder().encode('new') });
	await assert.rejects(() => manager.finish(session.writeId), /declared size/u);
	await manager.abort(session.writeId);
	assert.equal(await readFile(destination, 'utf8'), 'original');

	target = targets.registerPath(destination);
	session = await manager.begin({ targetId: target.id, size: 3 });
	await manager.writeChunk({ writeId: session.writeId, offset: 0, bytes: new TextEncoder().encode('new') });
	await manager.abort(session.writeId);
	assert.equal(await readFile(destination, 'utf8'), 'original');
	assert.equal((await readdir(root)).some((name) => name.endsWith('.soundscaper-part')), false);
});

test('save chunks enforce the one MiB boundary', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-limit-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({ targets });
	context.after(() => manager.dispose());
	const target = targets.registerPath(join(root, 'large.wav'));
	const session = await manager.begin({ targetId: target.id, size: MAX_SAVE_CHUNK_BYTES + 1 });
	await assert.rejects(
		() => manager.writeChunk({ writeId: session.writeId, offset: 0, bytes: new Uint8Array(MAX_SAVE_CHUNK_BYTES + 1) }),
		/chunk is too large/u,
	);
});
