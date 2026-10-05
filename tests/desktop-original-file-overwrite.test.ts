/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { ReadCapabilityStore } from '../desktop/file-capabilities.js';
import { IPC, MAX_READ_CAPABILITIES_PER_OWNER } from '../desktop/constants.js';
import { registerFileCapabilityIpc } from '../desktop/main-file-capability-ipc.mjs';
import { OriginalFileOverwriteStore } from '../desktop/original-file-overwrite.ts';
import { registerSelectedReadCapability } from '../desktop/read-selection-service.js';
import { cleanReadCapabilityDisplayName } from '../desktop/read-capability-support.js';
import { AtomicSaveManager, SaveTargetStore } from '../desktop/save-targets.js';
import { acceptsFile } from '../desktop/validation.js';

const OWNER = Object.freeze({ renderer: 'current' });
const OTHER_OWNER = Object.freeze({ renderer: 'other' });

async function fixture(context: TestContext, extension = 'wav', saveOptions: { renameImpl?: typeof rename } = {}) {
	const root = await mkdtemp(join(tmpdir(), 'scape-original-overwrite-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, `original.${extension}`);
	await writeFile(path, 'original bytes');
	const reads = new ReadCapabilityStore();
	const targets = new SaveTargetStore();
	const originals = new OriginalFileOverwriteStore({ reads, targets, acceptsFile, cleanDisplayName: cleanReadCapabilityDisplayName, maximumCount: MAX_READ_CAPABILITIES_PER_OWNER });
	const saves = new AtomicSaveManager({ targets, ...saveOptions } as never);
	context.after(async () => { originals.dispose(); await reads.dispose(); await saves.dispose(); });
	const descriptor = await registerSelectedReadCapability(reads, path, { owner: OWNER, purpose: 'project', originalFiles: originals });
	async function stage(bytes = 'replacement bytes') {
		assert.ok(descriptor.originalFile);
		const target = await originals.prepare(descriptor.originalFile.id, { owner: OWNER });
		assert.deepEqual(Object.keys(target).sort(), ['id', 'name']);
		const session = await saves.begin({ owner: OWNER, targetId: target.id, size: Buffer.byteLength(bytes) });
		await saves.writeChunk({ owner: OWNER, writeId: session.writeId, offset: 0, bytes: new TextEncoder().encode(bytes) });
		return session;
	}
	return { root, path, reads, targets, originals, descriptor, saves, stage };
}

test('the original media capability survives read release and repeated atomic overwrites', async (context) => {
	for (const extension of ['wav', 'mp3', 'mp4', 'webm']) {
		const entry = await fixture(context, extension);
		assert.ok(entry.descriptor.originalFile);
		assert.match(entry.descriptor.originalFile.id, /^[a-f0-9]{48}$/u);
		assert.equal(JSON.stringify(entry.descriptor).includes(entry.root), false);
		await entry.reads.release(entry.descriptor.id, { owner: OWNER });
		for (const bytes of ['first export', 'second export']) {
			const session = await entry.stage(bytes);
			assert.notEqual(await readFile(entry.path, 'utf8'), bytes, 'staging leaves the imported file intact');
			await entry.saves.finish(session.writeId, { owner: OWNER });
			assert.equal(await readFile(entry.path, 'utf8'), bytes);
		}
		assert.deepEqual(await readdir(entry.root), [`original.${extension}`]);
	}
});

test('project, label, read-only and symbolic-link imports do not grant original overwrite', async (context) => {
	for (const extension of ['sscape', 'aup4', 'srt']) {
		assert.equal((await fixture(context, extension)).descriptor.originalFile, undefined);
	}
	const entry = await fixture(context);
	await chmod(entry.path, 0o444);
	const readOnly = await registerSelectedReadCapability(entry.reads, entry.path, { owner: OWNER, purpose: 'audio', originalFiles: entry.originals });
	assert.equal(readOnly.originalFile, undefined);
	const alias = join(entry.root, 'alias.wav');
	await symlink(entry.path, alias);
	const linked = await registerSelectedReadCapability(entry.reads, alias, { owner: OWNER, purpose: 'audio', originalFiles: entry.originals });
	assert.equal(linked.originalFile, undefined);
});

test('owner mismatch, retired originals and replaced originals refuse overwrite', async (context) => {
	const entry = await fixture(context);
	assert.ok(entry.descriptor.originalFile);
	const id = entry.descriptor.originalFile.id;
	await assert.rejects(entry.originals.prepare(id, { owner: OTHER_OWNER }), /owner/iu);
	assert.throws(() => entry.originals.release(id, { owner: OTHER_OWNER }), /owner/iu);
	await rename(entry.path, join(entry.root, 'old.wav'));
	await writeFile(entry.path, 'foreign bytes');
	await assert.rejects(entry.originals.prepare(id, { owner: OWNER }), /changed/iu);
	assert.equal(await readFile(entry.path, 'utf8'), 'foreign bytes');
	assert.equal(entry.originals.release(id, { owner: OWNER }), true);
	await assert.rejects(entry.originals.prepare(id, { owner: OWNER }), /unavailable/iu);
});

test('changes during encoding and aborted writes preserve the current original', async (context) => {
	const entry = await fixture(context);
	let session = await entry.stage();
	await entry.saves.abort(session.writeId, { owner: OWNER });
	assert.equal(await readFile(entry.path, 'utf8'), 'original bytes');
	session = await entry.stage();
	await writeFile(entry.path, 'changed elsewhere');
	await assert.rejects(entry.saves.finish(session.writeId, { owner: OWNER }), /commit/iu);
	assert.equal(await readFile(entry.path, 'utf8'), 'changed elsewhere');
	assert.deepEqual(await readdir(entry.root), ['original.wav']);
});

test('revocation blocks a staged overwrite and removes its temporary output', async (context) => {
	const entry = await fixture(context);
	const session = await entry.stage();
	entry.originals.revokeOwner(OWNER);
	await assert.rejects(entry.saves.finish(session.writeId, { owner: OWNER }), /commit/iu);
	assert.equal(await readFile(entry.path, 'utf8'), 'original bytes');
	assert.deepEqual(await readdir(entry.root), ['original.wav']);
});

test('a failed atomic replacement preserves the imported file and permits retry', async (context) => {
	const entry = await fixture(context, 'wav', { renameImpl: async () => { throw new Error('Destination denied rename'); } });
	const session = await entry.stage();
	await assert.rejects(entry.saves.finish(session.writeId, { owner: OWNER }), /commit/iu);
	assert.equal(await readFile(entry.path, 'utf8'), 'original bytes');
	assert.deepEqual(await readdir(entry.root), ['original.wav']);
	assert.ok(entry.descriptor.originalFile);
	assert.ok(await entry.originals.prepare(entry.descriptor.originalFile.id, { owner: OWNER }));
});

test('a missing original refuses overwrite without exposing its filesystem path', async (context) => {
	const entry = await fixture(context);
	await rm(entry.path);
	assert.ok(entry.descriptor.originalFile);
	await assert.rejects(entry.originals.prepare(entry.descriptor.originalFile.id, { owner: OWNER }), (error: unknown) => {
		assert.ok(error instanceof Error);
		assert.match(error.message, /original file.*unavailable/iu);
		assert.equal(error.message.includes(entry.root), false);
		return true;
	});
});

test('a same-size external edit immediately after publication retires repeat overwrite permission', async (context) => {
	const entry = await fixture(context, 'wav', { renameImpl: async (from, to) => {
		await rename(from, to);
		await writeFile(to, 'changed elsewhere');
		await utimes(to, new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));
	} });
	const session = await entry.stage('replacement bytes');
	await entry.saves.finish(session.writeId, { owner: OWNER });
	assert.equal(await readFile(entry.path, 'utf8'), 'changed elsewhere');
	assert.ok(entry.descriptor.originalFile);
	await assert.rejects(entry.originals.prepare(entry.descriptor.originalFile.id, { owner: OWNER }), /unavailable/iu);
});

test('native import IPC grants original authority and releases it through owner-scoped endpoints', async (context) => {
	const entry = await fixture(context);
	const handlers = new Map<string, (event: unknown, value: unknown) => unknown>();
	registerFileCapabilityIpc({
		channels: IPC, readCapabilities: entry.reads, originalFiles: entry.originals,
		saveTargets: entry.targets, saves: entry.saves,
		desktopSmokeProbe: { resolveOpenPaths: () => null, resolveSavePath: () => null },
		dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [entry.path] }) },
		handle: (channel: string, listener: (event: unknown, value: unknown) => unknown) => { handlers.set(channel, listener); },
		opaqueId: (id: unknown, size: number) => { if (typeof id !== 'string' || !new RegExp(`^[a-f0-9]{${String(size)}}$`, 'u').test(id)) throw new TypeError('Invalid opaque identifier'); return id; },
		ownerFor: () => OWNER, pendingOpenProjects: {}, windowFor: () => null,
	});
	const selected = await handlers.get(IPC.chooseFiles)!({}, { purpose: 'audio' }) as Array<{ originalFile: { id: string; name: string } }>;
	assert.equal(selected[0]!.originalFile.name, 'original.wav');
	assert.ok(await handlers.get(IPC.prepareOriginalOverwrite)!({}, selected[0]!.originalFile.id));
	assert.equal(await handlers.get(IPC.releaseOriginalFile)!({}, selected[0]!.originalFile.id), true);
	await assert.rejects(async () => handlers.get(IPC.prepareOriginalOverwrite)!({}, '/tmp/foreign.wav'), /opaque/iu);
});
