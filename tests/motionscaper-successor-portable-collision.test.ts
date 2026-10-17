/* SPDX-License-Identifier: AGPL-3.0-only */
import { smallMotionscaperArchiveBytes } from './helpers/motionscaper-small-archive-bytes.ts';
import { readFramescaperArchiveCustody } from '../src/framescaper/editor-project-successor-archive-custody.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { createFramescaperSuccessorEnvironment } from '../src/framescaper/editor-project-successor-environment.ts';
import { createFramescaperSuccessorRuntime } from '../src/framescaper/editor-project-successor-runtime.ts';
import { exportFramescaperSuccessorPortableArchive } from '../src/framescaper/editor-project-successor-portable-export.ts';
import { importFramescaperSuccessorPortableArchive, loadFramescaperSuccessorPortableCustody } from '../src/framescaper/editor-project-successor-portable-import.ts';
import type { FramescaperSuccessorEnvironment } from '../src/framescaper/editor-project-successor-environment.ts';
import { request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { openFramescaperSuccessorDatabase } from '../src/framescaper/editor-project-successor-database.ts';
import { framescaperSuccessorBaselineProject } from '../src/framescaper/editor-project-successor-commands.ts';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js/index-native.js';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';

async function fixture(originalText = 'first original') {
	const image = createFramescaperBaselineImageFixture({ originalText });
	const runtime = createFramescaperSuccessorRuntime({ line: 'successor' });
	const base = runtime.createProject({ id: 'collision-frame', title: originalText });
	const project = runtime.applyCommand(base, { type: 'image-source/set', sourceId: image.source.id, expectedSource: null, source: image.source });
	const output = await exportFramescaperSuccessorPortableArchive(project, {
		getMediaAssetMetadata: async () => ({ sourceId: image.source.storageKey, size: image.bytes.length, sha256: image.source.contentSha256 }),
		loadMediaAsset: async () => new Blob([image.bytes.slice()]), async *readSourceChunks() {},
	}, { readAsset: async () => null }); assert.ok(output.blob);
	return { ...image, project, blob: output.blob, manifest: output.manifest };
}
async function environment() {
	const factory = createInstrumentedIndexedDB(); const indexedDB = factory as unknown as IDBFactory;
	return { factory, indexedDB, value: await createFramescaperSuccessorEnvironment({ line: 'successor', storeOptions: { indexedDB, preferOpfs: false } }) };
}
function replaceAuthority(env: FramescaperSuccessorEnvironment) {
	return async (id: string) => ({ writeFence: await env.owners.claimOwnerWriteFence(id), assertCurrent() {}, release() {} });
}
async function loseOrdinaryCache(indexedDB: IDBFactory) {
	const database = await request(indexedDB.open('kw-media-framescaper-editor-v2-media'));
	try { const names = Array.from(database.objectStoreNames); await transact(database, names, 'readwrite', async stores => { for (const name of names) await request(stores[name]!.clear()); }); } finally { database.close(); }
}

test('M10 File Copy owns a fresh project identity and retains exact source archive for cache recovery', async () => {
	const first = await fixture(); const env = await environment();
	try {
		await importFramescaperSuccessorPortableArchive(first.blob, env.value.store, { line: 'successor' });
		const owner = await env.value.owners.loadOwner(first.project.id);
		const copied = await importFramescaperSuccessorPortableArchive(first.blob, env.value.store, { line: 'successor', collision: 'copy' });
		assert.notEqual(copied.project.id, first.project.id); assert.equal(copied.project.title, `${first.project.title} copy`); assert.equal(copied.collision, 'copy');
		assert.equal((await env.value.owners.loadOwner(first.project.id))?.ownerDigest, owner?.ownerDigest);
		const custody = await loadFramescaperSuccessorPortableCustody(copied.project.id, { indexedDB: env.indexedDB, line: 'successor' });
		assert.deepEqual(custody?.project, copied.project); assert.deepEqual(await smallMotionscaperArchiveBytes(custody?.archive), new Uint8Array(await first.blob.arrayBuffer()));
		await env.value.close(); await loseOrdinaryCache(env.indexedDB);
		const reopened = await createFramescaperSuccessorEnvironment({ line: 'successor', storeOptions: { indexedDB: env.indexedDB, preferOpfs: false } });
		try { assert.deepEqual(await reopened.controllerStore.loadProject(copied.project.id), copied.project); assert.ok(await reopened.store.loadMediaAsset(first.source.storageKey)); } finally { await reopened.close(); }
	} finally { await env.value.close(); }
});

test('M10 replacing a migrated owner preserves its original v1 archive and recovers both media generations', async () => {
	const first = await fixture(); const next = await fixture('after migration'); const env = await environment();
	try {
		const text = JSON.stringify(framescaperSuccessorBaselineProject(first.project)); const bytes = new TextEncoder().encode(text);
		const manifest = { ...first.manifest, project: { ...first.manifest.project, schemaVersion: 1, size: bytes.length, sha256: digestScapeBytes(bytes) } };
		const writer = new ZipWriter(new BlobWriter(), { level: 0, useWebWorkers: false });
		await writer.add('project.json', new TextReader(text)); await writer.add('manifest.json', new TextReader(JSON.stringify(manifest)));
		await writer.add(manifest.assets[0]!.entry, new Blob([first.bytes.slice()]).stream()); const original = await writer.close();
		await env.value.custody.stage(original); const migrated = await env.value.custody.complete(first.project.id); await env.value.controllerStore.loadProject(first.project.id);
		const replaced = await importFramescaperSuccessorPortableArchive(next.blob, env.value.store, { line: 'successor', collision: 'replace', acquireReplaceProjectWriteAuthority: replaceAuthority(env.value) });
		assert.equal((await env.value.custody.load(first.project.id))?.archiveDigest, migrated.archiveDigest);
		await env.value.close(); await loseOrdinaryCache(env.indexedDB);
		const reopened = await createFramescaperSuccessorEnvironment({ line: 'successor', storeOptions: { indexedDB: env.indexedDB, preferOpfs: false } });
		try {
			assert.deepEqual(await reopened.controllerStore.loadProject(first.project.id), replaced.project);
			assert.deepEqual(await smallMotionscaperArchiveBytes((await reopened.custody.load(first.project.id))?.originalArchive), new Uint8Array(await original.arrayBuffer()));
			assert.deepEqual(new Uint8Array(await (await reopened.store.loadMediaAsset(first.source.id))!.arrayBuffer()), first.bytes);
			const source = replaced.project.sources.find(source => source.kind === 'image')!;
			assert.deepEqual(new Uint8Array(await (await reopened.store.loadMediaAsset(String(source.storageKey)))!.arrayBuffer()), next.bytes);
		} finally { await reopened.close(); }
	} finally { await env.value.close(); }
});

test('M10 File Replace fences owner publication, preserves the previous archive and avoids overwriting conflicting media', async () => {
	const first = await fixture(); const next = await fixture('second original'); const env = await environment();
	try {
		await importFramescaperSuccessorPortableArchive(first.blob, env.value.store, { line: 'successor' });
		const previous = await loadFramescaperSuccessorPortableCustody(first.project.id, { indexedDB: env.indexedDB, line: 'successor' });
		await assert.rejects(importFramescaperSuccessorPortableArchive(next.blob, env.value.store, { line: 'successor', collision: 'replace' }), /write authority/u);
		const replaced = await importFramescaperSuccessorPortableArchive(next.blob, env.value.store, { line: 'successor', collision: 'replace', acquireReplaceProjectWriteAuthority: replaceAuthority(env.value) });
		assert.equal(replaced.project.id, first.project.id); assert.equal(replaced.project.title, next.project.title); assert.equal(replaced.collision, 'replace');
		const replacementSource = replaced.project.sources.find(source => source.kind === 'image')!;
		assert.notEqual(replacementSource.storageKey, first.source.storageKey);
		assert.deepEqual(new Uint8Array(await (await env.value.store.loadMediaAsset(first.source.storageKey))!.arrayBuffer()), first.bytes);
		assert.deepEqual(new Uint8Array(await (await env.value.store.loadMediaAsset(String(replacementSource.storageKey)))!.arrayBuffer()), next.bytes);
		const custody = await loadFramescaperSuccessorPortableCustody(first.project.id, { indexedDB: env.indexedDB, line: 'successor' });
		assert.notEqual(custody?.archiveDigest, previous?.archiveDigest); assert.deepEqual(await smallMotionscaperArchiveBytes(custody?.archive), new Uint8Array(await next.blob.arrayBuffer()));
		assert.equal(env.factory.recordCount('kw-media-framescaper-editor-v2', 'portableArchives'), 2);
		const database = await openFramescaperSuccessorDatabase(env.indexedDB, 'successor');
		try {
			const rows: unknown[] = await transact(database, ['portableArchives'], 'readonly', stores => request(stores.portableArchives!.getAll()));
			const retained = rows.find(row => row && typeof row === 'object' && Reflect.get(row, 'kind') === 'framescaper-successor-portable-history-v1'); assert.ok(retained && typeof retained === 'object');
			const original: unknown = Reflect.get(retained, 'custody'); assert.ok(original && typeof original === 'object');
			const archive: unknown = Reflect.get(original, 'archive'); assert.ok(!(archive instanceof Blob)); assert.deepEqual(await smallMotionscaperArchiveBytes(readFramescaperArchiveCustody(archive, String(Reflect.get(original, 'archiveDigest')), env.indexedDB)), new Uint8Array(await first.blob.arrayBuffer()));
		} finally { database.close(); }
		await env.value.close(); await loseOrdinaryCache(env.indexedDB);
		const reopened = await createFramescaperSuccessorEnvironment({ line: 'successor', storeOptions: { indexedDB: env.indexedDB, preferOpfs: false } });
		try { assert.deepEqual(await reopened.controllerStore.loadProject(first.project.id), replaced.project); assert.deepEqual(new Uint8Array(await (await reopened.store.loadMediaAsset(String(replacementSource.storageKey)))!.arrayBuffer()), next.bytes); } finally { await reopened.close(); }
	} finally { await env.value.close(); }
});

test('M10 File Replace refuses a superseded durable write fence after candidate hydration', async () => {
	const first = await fixture(); const next = await fixture('concurrent replacement'); const env = await environment();
	try {
		await importFramescaperSuccessorPortableArchive(first.blob, env.value.store, { line: 'successor' }); const before = await env.value.owners.loadOwner(first.project.id);
		await assert.rejects(importFramescaperSuccessorPortableArchive(next.blob, env.value.store, {
			line: 'successor', collision: 'replace', acquireReplaceProjectWriteAuthority: replaceAuthority(env.value),
			estimateStorageForPreflight: async () => { await env.value.owners.claimOwnerWriteFence(first.project.id); return { usage: 0, quota: 1_000_000_000 }; },
		}), /write authority/u);
		assert.equal((await env.value.owners.loadOwner(first.project.id))?.ownerDigest, before?.ownerDigest);
		const custody = await loadFramescaperSuccessorPortableCustody(first.project.id, { indexedDB: env.indexedDB, line: 'successor' }); assert.deepEqual(await smallMotionscaperArchiveBytes(custody?.archive), new Uint8Array(await first.blob.arrayBuffer()));
	} finally { await env.value.close(); }
});

test('M10 failed File Replace leaves the previous accepted owner and archive unchanged', async () => {
	const first = await fixture(); const next = await fixture('failed replacement'); const env = await environment();
	try {
		await importFramescaperSuccessorPortableArchive(first.blob, env.value.store, { line: 'successor' });
		const before = await env.value.owners.loadOwner(first.project.id);
		env.factory.failNextPutForStore('portableArchives', new Error('archive disk failure'));
		await assert.rejects(importFramescaperSuccessorPortableArchive(next.blob, env.value.store, { line: 'successor', collision: 'replace', acquireReplaceProjectWriteAuthority: replaceAuthority(env.value) }), /archive disk failure/u);
		assert.equal((await env.value.owners.loadOwner(first.project.id))?.ownerDigest, before?.ownerDigest);
		const custody = await loadFramescaperSuccessorPortableCustody(first.project.id, { indexedDB: env.indexedDB, line: 'successor' }); assert.deepEqual(await smallMotionscaperArchiveBytes(custody?.archive), new Uint8Array(await first.blob.arrayBuffer()));
		assert.equal(env.factory.recordCount('kw-media-framescaper-editor-v2', 'portableArchives'), 1);
	} finally { await env.value.close(); }
});

test('M10 replacing legacy portable Blob custody retains byte-exact chunk history and rolls back failed history publication', async () => {
	const first = await fixture(); const next = await fixture('new revision'); const env = await environment();
	const database = await openFramescaperSuccessorDatabase(env.indexedDB, 'successor');
	try {
		await importFramescaperSuccessorPortableArchive(first.blob, env.value.store, { line: 'successor' });
		await transact(database, ['portableArchives'], 'readwrite', async stores => {
			const prior = await request(stores.portableArchives.get(first.project.id)) as Record<string, unknown>;
			await request(stores.portableArchives.put({ ...prior, archive: first.blob }));
		});
		const beforeBodies = env.factory.recordCount(database.name, 'archiveBodies');
		env.factory.failNextPutForStore('owners', new Error('history owner failure'));
		await assert.rejects(importFramescaperSuccessorPortableArchive(next.blob, env.value.store, { line: 'successor', collision: 'replace', acquireReplaceProjectWriteAuthority: replaceAuthority(env.value) }), /history owner failure/u);
		assert.equal(env.factory.recordCount(database.name, 'portableArchives'), 1); assert.equal(env.factory.recordCount(database.name, 'archiveBodies'), beforeBodies);
		assert.equal(env.factory.recordCount(database.name, 'archiveStages'), 0);
		await importFramescaperSuccessorPortableArchive(next.blob, env.value.store, { line: 'successor', collision: 'replace', acquireReplaceProjectWriteAuthority: replaceAuthority(env.value) });
		const rows = await transact(database, ['portableArchives'], 'readonly', stores => request(stores.portableArchives.getAll())) as Record<string, unknown>[];
		const prior = rows.find(row => row.kind === 'framescaper-successor-portable-history-v1')?.custody as Record<string, unknown>;
		assert.ok(prior); assert.ok(!(prior.archive instanceof Blob));
		assert.deepEqual(await smallMotionscaperArchiveBytes(readFramescaperArchiveCustody(prior.archive, String(prior.archiveDigest), env.indexedDB)), new Uint8Array(await first.blob.arrayBuffer()));
	} finally { database.close(); await env.value.close(); }
});
