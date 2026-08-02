import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AtomicSaveManager, SaveTargetStore } from '../desktop/save-targets.js';

const OWNER = Object.freeze({ name: 'final-prefix-owner' });
const OTHER_OWNER = Object.freeze({ name: 'other-final-prefix-owner' });
const PREFIX_BYTES = 32;

test('declared final prefixes patch completed exact saves without changing their length', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-final-prefix-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const destination = join(root, 'mix.wav');
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({ targets });
	context.after(() => manager.dispose());
	const target = targets.registerPath(destination, { owner: OWNER, purpose: 'audio-pcm-mix' });
	const session = await manager.begin({
		owner: OWNER,
		targetId: target.id,
		size: 40,
		finalPrefixByteLength: PREFIX_BYTES,
	});
	const body = new Uint8Array(40).fill(9);
	body.fill(0, 0, PREFIX_BYTES);
	await manager.writeChunk({ owner: OWNER, writeId: session.writeId, offset: 0, bytes: body });
	const prefix = Uint8Array.from({ length: PREFIX_BYTES }, (_value, index) => index + 1);

	assert.deepEqual(await manager.patchFinalPrefix({ owner: OWNER, writeId: session.writeId, bytes: prefix }), {
		byteLength: 40,
	});
	assert.deepEqual(await manager.finish(session.writeId, { owner: OWNER }), { byteLength: 40 });
	assert.deepEqual([...await readFile(destination)], [...prefix, ...new Uint8Array(8).fill(9)]);
});

test('final-prefix declarations require an exact save of at least 32 bytes', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-final-prefix-declaration-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({ targets });
	context.after(() => manager.dispose());

	let target = targets.registerPath(join(root, 'bounded.scape'), { owner: OWNER, purpose: 'project' });
	await assert.rejects(
		manager.begin({ owner: OWNER, targetId: target.id, maximumSize: 40, finalPrefixByteLength: PREFIX_BYTES }),
		/exact-size save/u,
	);
	let session = await manager.begin({ owner: OWNER, targetId: target.id, maximumSize: 1 });
	await manager.abort(session.writeId, { owner: OWNER });

	target = targets.registerPath(join(root, 'short.wav'), { owner: OWNER });
	await assert.rejects(
		manager.begin({ owner: OWNER, targetId: target.id, size: 31, finalPrefixByteLength: PREFIX_BYTES }),
		/at least 32 bytes/u,
	);
	session = await manager.begin({ owner: OWNER, targetId: target.id, size: 1 });
	await manager.abort(session.writeId, { owner: OWNER });

	target = targets.registerPath(join(root, 'wrong-prefix.wav'), { owner: OWNER });
	await assert.rejects(
		manager.begin({ owner: OWNER, targetId: target.id, size: 40, finalPrefixByteLength: 31 }),
		/exactly 32 bytes/u,
	);
	session = await manager.begin({ owner: OWNER, targetId: target.id, size: 0 });
	assert.deepEqual(await manager.finish(session.writeId, { owner: OWNER }), { byteLength: 0 });
});

test('a declared prefix is required after sequential bytes and can be patched only once', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-final-prefix-order-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({ targets });
	context.after(() => manager.dispose());
	const target = targets.registerPath(join(root, 'ordered.wav'), { owner: OWNER });
	const { writeId } = await manager.begin({
		owner: OWNER,
		targetId: target.id,
		size: PREFIX_BYTES,
		finalPrefixByteLength: PREFIX_BYTES,
	});
	await assert.rejects(
		manager.patchFinalPrefix({ owner: OWNER, writeId, bytes: new Uint8Array(PREFIX_BYTES) }),
		/after all sequential bytes/u,
	);
	await manager.writeChunk({ owner: OWNER, writeId, offset: 0, bytes: new Uint8Array(PREFIX_BYTES) });
	await assert.rejects(
		manager.patchFinalPrefix({ owner: OWNER, writeId, bytes: new Uint8Array(PREFIX_BYTES - 1) }),
		/exactly 32 bytes/u,
	);
	await assert.rejects(manager.finish(writeId, { owner: OWNER }), /required final prefix is missing/u);
	await manager.patchFinalPrefix({ owner: OWNER, writeId, bytes: new Uint8Array(PREFIX_BYTES) });
	await assert.rejects(
		manager.patchFinalPrefix({ owner: OWNER, writeId, bytes: new Uint8Array(PREFIX_BYTES) }),
		/already attempted/u,
	);
	assert.deepEqual(await manager.finish(writeId, { owner: OWNER }), { byteLength: PREFIX_BYTES });
});

test('prefix patching loops over partial writes at position zero without advancing save length', async () => {
	const writes = [];
	let call = 0;
	const { manager, targets } = fakeManager({
		write: async (buffer, offset, length, position) => {
			writes.push({ length, position, value: buffer[offset] });
			call += 1;
			if (call === 1) return { bytesWritten: length };
			return { bytesWritten: Math.min(length, call === 2 ? 5 : 9) };
		},
	});
	const target = targets.registerPath('/tmp/partial-final-prefix.wav', { owner: OWNER });
	const { writeId } = await manager.begin({
		owner: OWNER,
		targetId: target.id,
		size: 40,
		finalPrefixByteLength: PREFIX_BYTES,
	});
	await manager.writeChunk({ owner: OWNER, writeId, offset: 0, bytes: new Uint8Array(40) });
	assert.deepEqual(
		await manager.patchFinalPrefix({ owner: OWNER, writeId, bytes: new Uint8Array(PREFIX_BYTES).fill(7) }),
		{ byteLength: 40 },
	);
	assert.deepEqual(writes.slice(1).map(({ length, position }) => ({ length, position })), [
		{ length: 32, position: 0 },
		{ length: 27, position: 5 },
		{ length: 18, position: 14 },
		{ length: 9, position: 23 },
	]);
	assert.deepEqual(await manager.finish(writeId, { owner: OWNER }), { byteLength: 40 });
});

test('a failed prefix write is one-shot and prevents publication', async () => {
	let calls = 0;
	const { events, manager, targets } = fakeManager({
		write: async (_buffer, _offset, length) => {
			calls += 1;
			if (calls === 2) throw new Error('simulated prefix failure');
			return { bytesWritten: length };
		},
	});
	const target = targets.registerPath('/tmp/failed-final-prefix.wav', { owner: OWNER });
	const { writeId } = await manager.begin({
		owner: OWNER,
		targetId: target.id,
		size: PREFIX_BYTES,
		finalPrefixByteLength: PREFIX_BYTES,
	});
	await manager.writeChunk({ owner: OWNER, writeId, offset: 0, bytes: new Uint8Array(PREFIX_BYTES) });
	await assert.rejects(
		manager.patchFinalPrefix({ owner: OWNER, writeId, bytes: new Uint8Array(PREFIX_BYTES) }),
		/simulated prefix failure/u,
	);
	await assert.rejects(
		manager.patchFinalPrefix({ owner: OWNER, writeId, bytes: new Uint8Array(PREFIX_BYTES) }),
		/already attempted/u,
	);
	await assert.rejects(manager.finish(writeId, { owner: OWNER }), /final prefix patch failed/u);
	assert.equal(await manager.abort(writeId, { owner: OWNER }), true);
	assert.deepEqual(events.slice(-2), ['close', 'unlink']);
});

test('prefix patch ownership and revocation preserve operation serialization and cleanup', async () => {
	const started = Promise.withResolvers();
	const gate = Promise.withResolvers();
	let calls = 0;
	const { events, manager, targets } = fakeManager({
		write: async (_buffer, _offset, length) => {
			calls += 1;
			if (calls > 1) {
				started.resolve();
				await gate.promise;
			}
			return { bytesWritten: length };
		},
	});
	const target = targets.registerPath('/tmp/revoked-final-prefix.wav', { owner: OWNER });
	const { writeId } = await manager.begin({
		owner: OWNER,
		targetId: target.id,
		size: PREFIX_BYTES,
		finalPrefixByteLength: PREFIX_BYTES,
	});
	await manager.writeChunk({ owner: OWNER, writeId, offset: 0, bytes: new Uint8Array(PREFIX_BYTES) });
	await assert.rejects(
		manager.patchFinalPrefix({ owner: OTHER_OWNER, writeId, bytes: new Uint8Array(PREFIX_BYTES) }),
		/belongs to another renderer owner/u,
	);
	const patching = manager.patchFinalPrefix({ owner: OWNER, writeId, bytes: new Uint8Array(PREFIX_BYTES) });
	await started.promise;
	const revoking = manager.revokeOwner(OWNER);
	await Promise.resolve();
	assert.deepEqual(events, []);
	gate.resolve();
	await Promise.all([patching, revoking]);
	assert.deepEqual(events, ['close', 'unlink']);
});

function fakeManager({ write }) {
	const events = [];
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({
		targets,
		openImpl: async () => ({
			write,
			async sync() {},
			async close() { events.push('close'); },
		}),
		renameImpl: async () => { events.push('rename'); },
		statfsImpl: async () => ({ bavail: 1_000_000n, bsize: 4_096n }),
		unlinkImpl: async () => { events.push('unlink'); },
	});
	return { events, manager, targets };
}
