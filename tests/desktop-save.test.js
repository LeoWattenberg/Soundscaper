import assert from 'node:assert/strict';
import { mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ReadCapabilityStore } from '../desktop/file-capabilities.js';
import { MAX_SAVE_CHUNK_BYTES, READ_PROFILE_MATERIALIZED_V1 } from '../desktop/constants.js';
import { AtomicSaveManager, SaveTargetStore } from '../desktop/save-targets.js';

const TEST_OWNER = Object.freeze({ name: 'renderer-test-owner' });
const REPLACEMENT_TEST_OWNER = Object.freeze({ name: 'replacement-renderer-test-owner' });

test('read capabilities expose opaque same-origin descriptors and expire cleanly', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-read-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const input = join(root, 'private project.aup4');
	await writeFile(input, 'project data');
	let now = 100;
	let closeCalls = 0;
	const closed = Promise.withResolvers();
	const store = new ReadCapabilityStore({
		ttlMs: 1000,
		now: () => now,
		openImpl: async (...args) => {
			const handle = await open(...args);
			return {
				stat: (...statArgs) => handle.stat(...statArgs),
				async close() {
					closeCalls += 1;
					try {
						await handle.close();
					} finally {
						closed.resolve();
					}
				},
			};
		},
	});
	context.after(() => store.dispose());
	const descriptor = await store.registerPath(input, { owner: TEST_OWNER });
	assert.equal(descriptor.name, 'private project.aup4');
	assert.equal(descriptor.size, 12);
	assert.equal(descriptor.readProfile, READ_PROFILE_MATERIALIZED_V1);
	assert.match(descriptor.url, /^soundscaper-app:\/\/bundle\/_desktop\/read\/materialized-v1\/[a-f0-9]{64}\//u);
	assert.equal(String(descriptor).includes(input), false);
	assert.ok(store.get(descriptor.id));
	now = 1100;
	assert.equal(store.get(descriptor.id), null);
	await closed.promise;
	assert.equal(closeCalls, 1);
});

test('chunked saves use sequential backpressure and atomically replace the destination', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-save-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const destination = join(root, 'copy.aup4');
	await writeFile(destination, 'original');
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({ targets });
	context.after(() => manager.dispose());
	const target = targets.registerPath(destination, { owner: TEST_OWNER });
	const { writeId, chunkSize } = await manager.begin({ owner: TEST_OWNER, targetId: target.id, size: 6 });
	assert.equal(chunkSize, MAX_SAVE_CHUNK_BYTES);
	assert.deepEqual(await manager.writeChunk({ owner: TEST_OWNER, writeId, offset: 0, bytes: new Uint8Array([1, 2, 3]) }), { nextOffset: 3 });
	await assert.rejects(() => manager.writeChunk({ owner: TEST_OWNER, writeId, offset: 2, bytes: new Uint8Array([4]) }), /out of sequence/u);
	assert.deepEqual(await manager.writeChunk({ owner: TEST_OWNER, writeId, offset: 3, bytes: new Uint8Array([4, 5, 6]) }), { nextOffset: 6 });
	assert.deepEqual(await manager.finish(writeId, { owner: TEST_OWNER }), { byteLength: 6 });
	assert.deepEqual([...await readFile(destination)], [1, 2, 3, 4, 5, 6]);
	assert.equal((await readdir(root)).some((name) => name.endsWith('.soundscaper-part')), false);
});

test('bounded streaming saves publish their actual length below the admitted maximum', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-bounded-save-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const destination = join(root, 'project.scape');
	await writeFile(destination, 'original');
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({ targets });
	context.after(() => manager.dispose());
	const target = targets.registerPath(destination, { owner: TEST_OWNER, purpose: 'project' });
	const { writeId } = await manager.begin({ owner: TEST_OWNER, targetId: target.id, maximumSize: 10 });
	await manager.writeChunk({ owner: TEST_OWNER, writeId, offset: 0, bytes: new TextEncoder().encode('scape') });

	assert.deepEqual(await manager.finish(writeId, { owner: TEST_OWNER }), { byteLength: 5 });
	assert.equal(await readFile(destination, 'utf8'), 'scape');
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

	let target = targets.registerPath(destination, { owner: TEST_OWNER });
	let session = await manager.begin({ owner: TEST_OWNER, targetId: target.id, size: 5 });
	await manager.writeChunk({ owner: TEST_OWNER, writeId: session.writeId, offset: 0, bytes: new TextEncoder().encode('new') });
	await assert.rejects(() => manager.finish(session.writeId, { owner: TEST_OWNER }), /declared size/u);
	await manager.abort(session.writeId, { owner: TEST_OWNER });
	assert.equal(await readFile(destination, 'utf8'), 'original');

	target = targets.registerPath(destination, { owner: TEST_OWNER });
	session = await manager.begin({ owner: TEST_OWNER, targetId: target.id, size: 3 });
	await manager.writeChunk({ owner: TEST_OWNER, writeId: session.writeId, offset: 0, bytes: new TextEncoder().encode('new') });
	await manager.abort(session.writeId, { owner: TEST_OWNER });
	assert.equal(await readFile(destination, 'utf8'), 'original');
	assert.equal((await readdir(root)).some((name) => name.endsWith('.soundscaper-part')), false);
});

test('save chunks enforce the one MiB boundary', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-limit-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({ targets });
	context.after(() => manager.dispose());
	const target = targets.registerPath(join(root, 'large.wav'), { owner: TEST_OWNER });
	const session = await manager.begin({ owner: TEST_OWNER, targetId: target.id, size: MAX_SAVE_CHUNK_BYTES + 1 });
	await assert.rejects(
		() => manager.writeChunk({ owner: TEST_OWNER, writeId: session.writeId, offset: 0, bytes: new Uint8Array(MAX_SAVE_CHUNK_BYTES + 1) }),
		/chunk is too large/u,
	);
});

test('save chunks cannot exceed their declared byte length', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-declared-limit-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({ targets });
	context.after(() => manager.dispose());
	const target = targets.registerPath(join(root, 'bounded.wav'), { owner: TEST_OWNER });
	const session = await manager.begin({ owner: TEST_OWNER, targetId: target.id, size: 1 });
	await assert.rejects(
		() => manager.writeChunk({ owner: TEST_OWNER, writeId: session.writeId, offset: 0, bytes: Uint8Array.of(1, 2) }),
		/exceeds its declared size/u,
	);
});

test('bounded streaming saves cannot exceed their admitted maximum', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-bounded-limit-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({ targets });
	context.after(() => manager.dispose());
	const target = targets.registerPath(join(root, 'bounded.scape'), { owner: TEST_OWNER, purpose: 'project' });
	const session = await manager.begin({ owner: TEST_OWNER, targetId: target.id, maximumSize: 1 });
	await assert.rejects(
		() => manager.writeChunk({ owner: TEST_OWNER, writeId: session.writeId, offset: 0, bytes: Uint8Array.of(1, 2) }),
		/exceeds its admitted maximum/u,
	);
	await manager.abort(session.writeId, { owner: TEST_OWNER });
});

test('bounded streaming mode rejects non-project save capabilities', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-bounded-purpose-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({ targets });
	context.after(() => manager.dispose());
	const target = targets.registerPath(join(root, 'audio.wav'), { owner: TEST_OWNER, purpose: 'audio' });
	await assert.rejects(
		manager.begin({ owner: TEST_OWNER, targetId: target.id, maximumSize: 10 }),
		/restricted to project save targets/u,
	);
});

test('save-session abort waits for an acknowledged write before closing staging', async () => {
	let releaseWrite;
	let markWriteStarted;
	const writeStarted = new Promise((resolve) => { markWriteStarted = resolve; });
	const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
	const events = [];
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({
		targets,
		openImpl: async () => ({
			async write(_buffer, _offset, length) {
				events.push('write');
				markWriteStarted();
				await writeGate;
				return { bytesWritten: length };
			},
			async close() { events.push('close'); },
		}),
		unlinkImpl: async () => { events.push('unlink'); },
	});
	const target = targets.registerPath('/tmp/stream-race.scape', { owner: TEST_OWNER, purpose: 'project' });
	const session = await manager.begin({ owner: TEST_OWNER, targetId: target.id, maximumSize: 1 });
	const writing = manager.writeChunk({ owner: TEST_OWNER, writeId: session.writeId, offset: 0, bytes: Uint8Array.of(1) });
	await writeStarted;
	const aborting = manager.abort(session.writeId, { owner: TEST_OWNER });
	await Promise.resolve();
	assert.deepEqual(events, ['write']);
	releaseWrite();
	await Promise.all([writing, aborting]);
	assert.deepEqual(events, ['write', 'close', 'unlink']);
});

test('save-session disposal drains a begin still opening staging before rejecting new work', async () => {
	let markOpenStarted;
	let releaseOpen;
	const openStarted = new Promise((resolve) => { markOpenStarted = resolve; });
	const openGate = new Promise((resolve) => { releaseOpen = resolve; });
	const events = [];
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({
		targets,
		openImpl: async () => {
			events.push('open');
			markOpenStarted();
			await openGate;
			return {
				async close() { events.push('close'); },
			};
		},
		unlinkImpl: async () => { events.push('unlink'); },
	});
	const target = targets.registerPath('/tmp/begin-shutdown-race.scape', { owner: TEST_OWNER, purpose: 'project' });
	const beginning = manager.begin({ owner: TEST_OWNER, targetId: target.id, maximumSize: 1 });
	await openStarted;

	let disposalSettled = false;
	const disposing = manager.dispose();
	void disposing.then(() => { disposalSettled = true; });
	assert.equal(manager.dispose(), disposing, 'disposal is one shared shutdown barrier');
	assert.throws(
		() => targets.registerPath('/tmp/late-save.scape', { owner: TEST_OWNER, purpose: 'project' }),
		/shutting down|disposed/u,
		'target admission closes synchronously with save-session admission',
	);
	await assert.rejects(
		manager.begin({ owner: TEST_OWNER, targetId: target.id, maximumSize: 1 }),
		/shutting down|disposed/u,
	);
	await assert.rejects(
		manager.writeChunk({ owner: TEST_OWNER, writeId: 'late', offset: 0, bytes: Uint8Array.of(1) }),
		/shutting down|disposed/u,
	);
	await assert.rejects(manager.finish('late', { owner: TEST_OWNER }), /shutting down|disposed/u);
	await assert.rejects(manager.abort('late', { owner: TEST_OWNER }), /shutting down|disposed/u);
	await new Promise((resolve) => { setImmediate(resolve); });
	assert.equal(disposalSettled, false, 'shutdown waits for an admitted begin');
	releaseOpen();
	await Promise.all([beginning, disposing]);

	assert.deepEqual(events, ['open', 'close', 'unlink']);
	assert.equal(manager.dispose(), disposing, 'the settled shutdown barrier remains idempotent');
});

test('save-session disposal drains a rejected write and aborts every remaining stage', async () => {
	let markWriteStarted;
	let releaseWrite;
	const writeStarted = new Promise((resolve) => { markWriteStarted = resolve; });
	const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
	const events = [];
	let handleId = 0;
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({
		targets,
		openImpl: async () => {
			const id = handleId++;
			return {
				async write() {
					events.push(`write-${id}`);
					markWriteStarted();
					await writeGate;
					throw new Error('injected write failure');
				},
				async close() { events.push(`close-${id}`); },
			};
		},
		unlinkImpl: async (path) => { events.push(`unlink-${path.includes('first') ? 0 : 1}`); },
	});
	const firstTarget = targets.registerPath('/tmp/first.scape', { owner: TEST_OWNER, purpose: 'project' });
	const secondTarget = targets.registerPath('/tmp/second.scape', { owner: TEST_OWNER, purpose: 'project' });
	const first = await manager.begin({ owner: TEST_OWNER, targetId: firstTarget.id, maximumSize: 1 });
	await manager.begin({ owner: TEST_OWNER, targetId: secondTarget.id, maximumSize: 1 });
	const writing = manager.writeChunk({ owner: TEST_OWNER, writeId: first.writeId, offset: 0, bytes: Uint8Array.of(1) });
	await writeStarted;

	let disposalSettled = false;
	const disposing = manager.dispose();
	void disposing.then(() => { disposalSettled = true; });
	await new Promise((resolve) => { setImmediate(resolve); });
	assert.equal(disposalSettled, false, 'shutdown waits for the failing admitted write');
	releaseWrite();
	await assert.rejects(writing, /injected write failure/u);
	await disposing;

	assert.deepEqual(events.slice(0, 1), ['write-0']);
	assert.deepEqual(new Set(events.slice(1)), new Set(['close-0', 'close-1', 'unlink-0', 'unlink-1']));
});

test('save-session disposal reports every unacknowledged close and unlink', async () => {
	let handleId = 0;
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({
		targets,
		openImpl: async () => {
			const id = handleId++;
			return {
				async close() {
					if (id === 0) throw new Error('injected close failure');
				},
			};
		},
		unlinkImpl: async (path) => {
			if (path.includes('unlink-failure')) throw new Error('injected unlink failure');
		},
	});
	let target = targets.registerPath('/tmp/close-failure.scape', { owner: TEST_OWNER, purpose: 'project' });
	await manager.begin({ owner: TEST_OWNER, targetId: target.id, maximumSize: 1 });
	target = targets.registerPath('/tmp/unlink-failure.scape', { owner: TEST_OWNER, purpose: 'project' });
	await manager.begin({ owner: TEST_OWNER, targetId: target.id, maximumSize: 1 });

	await assert.rejects(manager.dispose(), (error) => {
		assert.ok(error instanceof AggregateError);
		assert.match(error.message, /save staging cleanup failed/u);
		assert.deepEqual(
			new Set(error.errors.map((failure) => failure.message)),
			new Set(['Could not close the temporary save file', 'Could not remove the temporary save file']),
		);
		return true;
	});
	assert.throws(
		() => targets.registerPath('/tmp/after-cleanup-failure.scape', { owner: TEST_OWNER, purpose: 'project' }),
		/disposed/u,
	);
});

test('save-session disposal reports cleanup failure from an admitted failed finish', async () => {
	let markSyncStarted;
	let releaseSync;
	const syncStarted = new Promise((resolve) => { markSyncStarted = resolve; });
	const syncGate = new Promise((resolve) => { releaseSync = resolve; });
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({
		targets,
		openImpl: async () => ({
			async sync() {
				markSyncStarted();
				await syncGate;
				throw new Error('injected sync failure');
			},
			async close() { throw new Error('injected close failure'); },
		}),
		unlinkImpl: async () => { throw new Error('injected unlink failure'); },
	});
	const target = targets.registerPath('/tmp/finish-cleanup-failure.scape', { owner: TEST_OWNER, purpose: 'project' });
	const session = await manager.begin({ owner: TEST_OWNER, targetId: target.id, maximumSize: 1 });
	const finishing = manager.finish(session.writeId, { owner: TEST_OWNER });
	await syncStarted;
	const disposing = manager.dispose();
	releaseSync();

	await assert.rejects(finishing, /Could not commit the saved file/u);
	await assert.rejects(disposing, (error) => (
		error instanceof AggregateError
		&& error.errors.length === 2
		&& /save staging cleanup failed/u.test(error.message)
	));
});

test('save-session disposal waits for an admitted finish to cross its commit boundary', async () => {
	let markSyncStarted;
	let releaseSync;
	const syncStarted = new Promise((resolve) => { markSyncStarted = resolve; });
	const syncGate = new Promise((resolve) => { releaseSync = resolve; });
	const events = [];
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({
		targets,
		openImpl: async () => ({
			async sync() {
				events.push('sync');
				markSyncStarted();
				await syncGate;
			},
			async close() { events.push('close'); },
		}),
		renameImpl: async () => { events.push('rename'); },
		unlinkImpl: async () => { events.push('unlink'); },
	});
	const target = targets.registerPath('/tmp/finish-shutdown-race.scape', { owner: TEST_OWNER, purpose: 'project' });
	const session = await manager.begin({ owner: TEST_OWNER, targetId: target.id, maximumSize: 1 });
	const finishing = manager.finish(session.writeId, { owner: TEST_OWNER });
	await syncStarted;

	let disposalSettled = false;
	const disposing = manager.dispose();
	void disposing.then(() => { disposalSettled = true; });
	await new Promise((resolve) => { setImmediate(resolve); });
	assert.equal(disposalSettled, false, 'shutdown waits for an admitted finish');
	releaseSync();
	assert.deepEqual(await finishing, { byteLength: 0 });
	await disposing;

	assert.deepEqual(events, ['sync', 'close', 'rename']);
	await assert.rejects(manager.finish(session.writeId, { owner: TEST_OWNER }), /shutting down|disposed/u);
});

test('save-session disposal cannot overtake an admitted atomic rename', async () => {
	let markRenameStarted;
	let releaseRename;
	const renameStarted = new Promise((resolve) => { markRenameStarted = resolve; });
	const renameGate = new Promise((resolve) => { releaseRename = resolve; });
	const events = [];
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({
		targets,
		openImpl: async () => ({
			async sync() { events.push('sync'); },
			async close() { events.push('close'); },
		}),
		renameImpl: async () => {
			events.push('rename');
			markRenameStarted();
			await renameGate;
		},
		unlinkImpl: async () => { events.push('unlink'); },
	});
	const target = targets.registerPath('/tmp/rename-shutdown-race.scape', { owner: TEST_OWNER, purpose: 'project' });
	const session = await manager.begin({ owner: TEST_OWNER, targetId: target.id, maximumSize: 1 });
	const finishing = manager.finish(session.writeId, { owner: TEST_OWNER });
	await renameStarted;

	let disposalSettled = false;
	const disposing = manager.dispose();
	void disposing.then(() => { disposalSettled = true; });
	await new Promise((resolve) => { setImmediate(resolve); });
	assert.equal(disposalSettled, false, 'shutdown waits for the atomic rename');
	releaseRename();
	await Promise.all([finishing, disposing]);

	assert.deepEqual(events, ['sync', 'close', 'rename']);
});

test('renderer-owner revocation permits a replacement document to save', async () => {
	const events = [];
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({
		targets,
		openImpl: async () => ({
			async close() { events.push('close'); },
		}),
		unlinkImpl: async () => { events.push('unlink'); },
	});
	let target = targets.registerPath('/tmp/navigation-before.scape', { owner: TEST_OWNER, purpose: 'project' });
	await manager.begin({ owner: TEST_OWNER, targetId: target.id, maximumSize: 1 });
	await manager.revokeOwner(TEST_OWNER);

	target = targets.registerPath('/tmp/navigation-after.scape', { owner: REPLACEMENT_TEST_OWNER, purpose: 'project' });
	const replacement = await manager.begin({ owner: REPLACEMENT_TEST_OWNER, targetId: target.id, maximumSize: 1 });
	await manager.abort(replacement.writeId, { owner: REPLACEMENT_TEST_OWNER });
	assert.deepEqual(events, ['close', 'unlink', 'close', 'unlink']);
	await manager.dispose();
});
