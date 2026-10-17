/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectMotionscaperOpaqueArchive, saveMotionscaperOpaqueCopy } from '../src/motionscaper/editor-opaque-archive.ts';
import { openMotionscaperDesktopProject } from '../src/motionscaper/editor-document-desktop.ts';
import { createMotionscaperFileAuthority } from '../desktop/motionscaper-file-authority.ts';
import { createScapeArchiveByteSource } from '../src/common/editor/scape-archive-byte-source.ts';
import { MotionscaperDocumentSession } from '../src/motionscaper/editor-document-session.ts';
import { createMotionscaperProjectStore } from '../src/motionscaper/editor-project-store.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createMotionscaperOpaqueArchive as archive } from './helpers/motionscaper-opaque-archive.ts';

for (const [family, version] of [['motionscaper', 2], ['framescaper', 2], ['soundscaper', 1]] as const) {
	test(`M02 Motion retains ${family}/${String(version)} as exact read-only custody without interpreting its asset body`, async () => {
		const original = await archive(family, version);
		const retained = await inspectMotionscaperOpaqueArchive(original, 'Opaque original.mscape'); assert.ok(retained);
		assert.deepEqual(retained.identity, { schemaFamily: family, schemaVersion: version });
		assert.equal(retained.browserBlob(), original);
		const chunks: ArrayBuffer[] = []; await retained.copy(bytes => { chunks.push(new Uint8Array(bytes).buffer); });
		assert.deepEqual(new Blob(chunks).size, original.size);
		assert.deepEqual(await new Blob(chunks).arrayBuffer(), await original.arrayBuffer());
		await retained.close(); await retained.close();
		assert.throws(() => retained.browserBlob(), /closed/iu);
		await assert.rejects(retained.copy(() => undefined), /closed/iu);
	});
}

test('M02 current Motion archives retain their strict asset admission and normal import route', async () => {
	await assert.rejects(inspectMotionscaperOpaqueArchive(await archive('motionscaper', 1), 'current.mscape'), /kind/iu);
	assert.equal(await inspectMotionscaperOpaqueArchive(await archive('motionscaper', 1, 'current', 'motion-font'), 'current.mscape'), null);
});

test('M02 native opaque reads stay bounded, cancellation never publishes, and failed release can be retried', async () => {
	const original = await archive('motionscaper', 2); const requests: number[] = []; let releases = 0;
	const input = createScapeArchiveByteSource({ size: original.size, maximumReadBytes: 128,
		read: async ({ offset, length }) => { requests.push(length); return new Uint8Array(await original.slice(offset, offset + length).arrayBuffer()); } });
	const retained = await inspectMotionscaperOpaqueArchive(input, 'future.mscape', { release: async () => { if (++releases === 1) throw new Error('release failed'); } }); assert.ok(retained);
	assert.equal(retained.browserBlob(), null);
	const controller = new AbortController(); controller.abort(); let writes = 0;
	await assert.rejects(retained.copy(() => { writes++; }, controller.signal), { name: 'AbortError' }); assert.equal(writes, 0);
	const chunks: ArrayBuffer[] = []; await retained.copy(bytes => { chunks.push(new Uint8Array(bytes).buffer); });
	assert.deepEqual(await new Blob(chunks).arrayBuffer(), await original.arrayBuffer()); assert.ok(requests.every(length => length <= 128));
	await assert.rejects(retained.close(), /release failed/u); await retained.close(); await retained.close(); assert.equal(releases, 2);
});

test('M02 native future File Open keeps the authored document and database unchanged, with an independent exact Save Copy', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-opaque-')); const originalPath = join(root, 'future.mscape'); const copyPath = join(root, 'copy.mscape');
	const original = await archive('motionscaper', 2); await writeFile(originalPath, new Uint8Array(await original.arrayBuffer()));
	let destination = originalPath; let binds = 0;
	const authority = createMotionscaperFileAuthority({ chooseOpen: async () => originalPath, chooseSave: async () => destination });
	const files = { ...authority, bindOpened: async (...args: Parameters<typeof authority.bindOpened>) => { binds++; await authority.bindOpened(...args); } };
	const factory = createInstrumentedIndexedDB(); const store = createMotionscaperProjectStore({ indexedDB: factory as unknown as IDBFactory });
	const session = new MotionscaperDocumentSession(store); const retained: { archive: Awaited<ReturnType<typeof inspectMotionscaperOpaqueArchive>> } = { archive: null };
	try {
		await session.create({ title: 'Retained authoring', width: 32, height: 32, frameRate: { num: 30, den: 1 }, durationFrames: 30 });
		const before = session.getSnapshot(); const projects = await store.list();
		assert.equal(await openMotionscaperDesktopProject(session, files, value => { retained.archive = value; }), 'opaque'); assert.ok(retained.archive);
		assert.equal(binds, 0); assert.equal(session.getSnapshot(), before); assert.deepEqual(await store.list(), projects);
		await assert.rejects(saveMotionscaperOpaqueCopy(retained.archive, files), /independent/iu);
		destination = copyPath; assert.equal(await saveMotionscaperOpaqueCopy(retained.archive, files), true);
		assert.deepEqual(await readFile(copyPath), await readFile(originalPath)); assert.deepEqual(await readdir(root), ['copy.mscape', 'future.mscape']);
		assert.equal(binds, 0); assert.equal(session.getSnapshot(), before); assert.deepEqual(await store.list(), projects);
	} finally { await retained.archive?.close(); await session.dispose(); await store.close(); await authority.dispose(); await rm(root, { recursive: true, force: true }); }
});
