/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { BlobReader, BlobWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { createStorageRepositories } from '../src/common/editor/storage/repositories.ts';
import { freshVerifiedMediaContentDigest } from '../src/common/editor/storage/media-content-provenance.ts';
import { collectCubeLutProfileProjectReferencesV1 } from '../src/common/editor/video-cube-lut-project-references-v1.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { deferred } from './helpers/async-test-control.ts';
import { editableImageFixture, PROFILE, LUT, LUT_BODY } from './helpers/framescaper-editable-image-current-fixture.ts';

for (const cube of [false, true]) test(`current Scape owns the saved editable source and ${cube ? 'enabled' : 'disabled'} LUT body`, async t => {
	const f = editableImageFixture({ cube }), project = f.project();
	const sender = createProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false, databaseName: `editable-sender-${crypto.randomUUID()}` });
	const recipient = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	t.after(async () => { await sender.close(); await recipient.close(); });
	await sender.writeMediaAsset(f.source.storageKey, new Blob([new Uint8Array(f.pack.bytes)]), { kind: 'timeline-image', encoding: 'framescaper-image-asset-v1', name: f.source.name, mimeType: f.source.mimeType });
	await sender.writeMediaAsset(LUT.storageKey, new Blob([LUT_BODY]));
	const runtime = createFramescaperScapeNativeRuntime(PROFILE), exported = await runtime.exportScapeProject(project, sender); assert.ok(exported.blob);
	assert.ok(exported.manifest.assets.some(asset => asset.sha256 === LUT.sha256));
	const imported = await runtime.importScapeProject(exported.blob, recipient); assert.equal(imported.readOnly, false);
	const actual = imported.project as typeof project; const image = actual.sources.find(source => source.kind === 'image'); assert.ok(image);
	assert.equal(image.schemaVersion, 2); assert.deepEqual(image.develop, f.source.develop); assert.deepEqual(image.provenance, f.source.provenance);
	assert.deepEqual(new Uint8Array(await (await recipient.loadMediaAsset(image.storageKey))!.arrayBuffer()), f.pack.bytes);
	assert.deepEqual(new Uint8Array(await (await recipient.loadMediaAsset(LUT.storageKey))!.arrayBuffer()), LUT_BODY);
	const second = await runtime.importScapeProject(exported.blob, recipient), rebound = second.project as typeof project;
	assert.notEqual(rebound.id, actual.id);
	const reboundImage = rebound.sources.find(source => source.kind === 'image'); assert.ok(reboundImage);
	assert.deepEqual(reboundImage.develop, f.source.develop); assert.deepEqual(reboundImage.provenance, f.source.provenance);
	assert.deepEqual(new Uint8Array(await (await recipient.loadMediaAsset(reboundImage.storageKey))!.arrayBuffer()), f.pack.bytes);
});

test('every disabled editable recipe LUT is retained by the actual project cleanup closure, and malformed sources refuse before cleanup', async t => {
	const f = editableImageFixture({ cube: false }), project = f.project();
	assert.deepEqual(collectCubeLutProfileProjectReferencesV1(project), [LUT]);
	const indexedDB = createInstrumentedIndexedDB(); let store = createFramescaperProjectStore(PROFILE, { indexedDB: indexedDB as unknown as IDBFactory, preferOpfs: false });
	t.after(async () => { await store.close(); });
	await importFixture(f, store);
	await store.close(); store = createFramescaperProjectStore(PROFILE, { indexedDB: indexedDB as unknown as IDBFactory, preferOpfs: false });
	assert.deepEqual((await store.loadProject(project.id))!.sources, project.sources);
	const pruned = await store.pruneUnreferencedSources({ minimumAgeMs: 0, now: Date.now() + 86_400_000 });
	assert.ok(!pruned.deletedSourceIds.includes(LUT.storageKey));
	assert.deepEqual(new Uint8Array(await (await store.loadMediaAsset(LUT.storageKey))!.arrayBuffer()), LUT_BODY);
	let getters = 0;
	for (const source of [{ ...f.source, schemaVersion: 3 }, Object.defineProperty({ ...f.source }, 'develop', { enumerable: true, get() { getters++; return f.source.develop; } })]) {
		assert.throws(() => collectCubeLutProfileProjectReferencesV1({ ...project, sources: [source] }));
	}
	assert.equal(getters, 0);
});

test('selected Frame Scape creation refuses missing or tampered staged packs and disabled LUTs before publishing any project', async t => {
	const f = editableImageFixture({ cube: false }), project = f.project(), indexedDB = createInstrumentedIndexedDB();
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: indexedDB as unknown as IDBFactory, preferOpfs: false }); t.after(async () => { await store.close(); });
	await assert.rejects(store.createScapeProjectIfAbsent(project), /Scape image body.*missing/iu);
	const bytes = f.pack.bytes.slice(); bytes[bytes.length - 1]! ^= 1;
	await writePack(store, f, bytes);
	await assert.rejects(store.createScapeProjectIfAbsent(project), /SHA-256|digest|immutable/iu);
	await store.deleteMediaAsset(f.source.storageKey); await writePack(store, f, f.pack.bytes);
	await assert.rejects(store.createScapeProjectIfAbsent(project), /Scape image body.*missing/iu);
	await store.writeMediaAsset(LUT.storageKey, new Blob([new TextEncoder().encode('not the saved LUT')]));
	await assert.rejects(store.createScapeProjectIfAbsent(project), /immutable|size|LUT/iu);
	assert.equal(await store.loadProject(project.id), null); assert.deepEqual(await store.listProjectRevisions(project.id), []);
	for (const row of indexedDB.records(store.databaseName, 'mediaAssets')) assert.ok(row.pendingProjectUntil);
});

for (const mutation of ['replace', 'remove'] as const) test(`selected Frame Scape creation rechecks a ${mutation}d staged row after joining its held native body read`, async t => {
	const f = editableImageFixture(), indexedDB = createInstrumentedIndexedDB(), entered = deferred<void>(), release = deferred<void>(); let hold = true;
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: indexedDB as unknown as IDBFactory, preferOpfs: false,
		repositoryFactory(port: Parameters<typeof createStorageRepositories>[0], options: Parameters<typeof createStorageRepositories>[1]) {
			const repositories = createStorageRepositories(port, options), read = repositories.media.loadAsset.bind(repositories.media);
			repositories.media.loadAsset = async (...args) => {
				const blob = await read(...args);
				if (hold) { hold = false; entered.resolve(); await release.promise; }
				return blob;
			}; return repositories;
		},
	}); t.after(async () => { await store.close(); });
	await writePack(store, f, f.pack.bytes);
	let settled = false;
	const creating = store.createScapeProjectIfAbsent(f.project());
	const refusing = assert.rejects(creating, /staged image body.*changed/iu).finally(() => { settled = true; });
	await entered.promise;
	if (mutation === 'remove') await store.deleteMediaAsset(f.source.storageKey);
	else { const row = indexedDB.records(store.databaseName, 'mediaAssets')[0]!;
		indexedDB.seedRecord(store.databaseName, 'mediaAssets', { ...row, ...freshVerifiedMediaContentDigest(f.source.contentSha256) }); }
	await Promise.resolve(); assert.equal(settled, false); assert.equal(await store.loadProject(f.project().id), null);
	release.resolve(); await refusing;
	assert.equal(await store.loadProject(f.project().id), null);
	if (mutation === 'remove') await writePack(store, f, f.pack.bytes);
	const created = await store.createScapeProjectIfAbsent(f.project()); assert.ok(created);
	assert.equal(await store.createScapeProjectIfAbsent(f.project()), null);
	assert.equal(await store.deleteProjectIfCurrent(structuredClone(created)), false);
	assert.equal(await store.deleteProjectIfCurrent(created), true); assert.equal(await store.deleteProjectIfCurrent(created), false);
	const next = await store.createScapeProjectIfAbsent(f.project()); assert.ok(next);
	await store.saveProject(next);
	assert.equal(await store.deleteProjectIfCurrent(next), false); assert.deepEqual(await store.loadProject(next.id), next);
	const foreign = { ...next, title: 'Foreign writer' }; await store.saveProject(foreign);
	assert.equal(await store.deleteProjectIfCurrent(next), false); assert.equal((await store.loadProject(next.id))!.title, 'Foreign writer');
});

for (const failingStore of ['projects', 'revisions', 'mediaAssets']) test(`selected image Scape ${failingStore} write refusal rolls back all project and pending body publication`, async t => {
	const f = editableImageFixture({ cube: false }), indexedDB = createInstrumentedIndexedDB();
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: indexedDB as unknown as IDBFactory, preferOpfs: false }); t.after(async () => { await store.close(); });
	await writePack(store, f, f.pack.bytes); await store.writeMediaAsset(LUT.storageKey, new Blob([LUT_BODY]));
	const before = indexedDB.records(store.databaseName, 'mediaAssets'), failure = new Error(`Atomic ${failingStore} refusal`);
	indexedDB.failNextPutForStore(failingStore, failure);
	await assert.rejects(store.createScapeProjectIfAbsent(f.project()), error => error === failure);
	assert.equal(await store.loadProject(f.project().id), null); assert.deepEqual(await store.listProjectRevisions(f.project().id), []);
	assert.deepEqual(indexedDB.records(store.databaseName, 'mediaAssets'), before);
	assert.ok(await store.createScapeProjectIfAbsent(f.project()));
});

test('current Scape rolls back provisional bodies when the disabled recipe LUT is corrupt', async t => {
	const f = editableImageFixture({ cube: false }), project = f.project(), before = structuredClone(project);
	const sender = durableStore(t), recipient = durableStore(t);
	await sender.writeMediaAsset(f.source.storageKey, new Blob([new Uint8Array(f.pack.bytes)]), { kind: 'timeline-image', encoding: 'framescaper-image-asset-v1', name: f.source.name, mimeType: f.source.mimeType });
	await sender.writeMediaAsset(LUT.storageKey, new Blob([LUT_BODY]));
	const runtime = createFramescaperScapeNativeRuntime(PROFILE), exported = await runtime.exportScapeProject(project, sender); assert.ok(exported.blob);
	const descriptor = exported.manifest.assets.find(asset => asset.sha256 === LUT.sha256); assert.ok(descriptor);
	const corrupt = await corruptBody(exported.blob, descriptor.entry);
	await assert.rejects(runtime.importScapeProject(corrupt, recipient), /digest|SHA-256/iu);
	assert.equal(await recipient.loadProject(project.id), null); assert.deepEqual(await recipient.listProjectRevisions(project.id), []);
	for (const key of [f.source.storageKey, LUT.storageKey]) { assert.equal(await recipient.loadMediaAsset(key), null); assert.equal(await recipient.getMediaAssetMetadata(key), null); }
	assert.deepEqual(project, before); assert.deepEqual(new Uint8Array(await (await sender.loadMediaAsset(LUT.storageKey))!.arrayBuffer()), LUT_BODY);
});

function durableStore(t: TestContext) {
	const store = createProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false, databaseName: `editable-corrupt-${crypto.randomUUID()}` });
	t.after(async () => { await store.close(); }); return store;
}
async function corruptBody(archive: Blob, entryName: string) {
	const reader = new ZipReader(new BlobReader(archive), { useWebWorkers: false }), entries: { filename: string; body: Blob }[] = [];
	let found = false;
	try { for (const entry of await reader.getEntries()) {
		assert.equal(entry.directory, false); let body = await entry.getData(new BlobWriter());
		if (entry.filename === entryName) { const bytes = new Uint8Array(await body.arrayBuffer()); assert.ok(bytes.byteLength); bytes[bytes.byteLength - 1]! ^= 0xff; body = new Blob([bytes.buffer]); found = true; }
		entries.push({ filename: entry.filename, body });
	} } finally { await reader.close(); }
	assert.equal(found, true);
	const output = new BlobWriter('application/vnd.soundscaper.scape+zip'), writer = new ZipWriter(output, { zip64: true, useWebWorkers: false, level: 0 });
	for (const entry of entries) await writer.add(entry.filename, entry.body.stream(), { zip64: true, level: 0 });
	return await writer.close(undefined, { zip64: true });
}

async function writePack(store: ReturnType<typeof createProjectStore>, f: ReturnType<typeof editableImageFixture>, bytes: Uint8Array) {
	await store.writeMediaAsset(f.source.storageKey, new Blob([new Uint8Array(bytes)]), { kind: 'timeline-image', encoding: 'framescaper-image-asset-v1', name: f.source.name, mimeType: f.source.mimeType });
}

async function importFixture(f: ReturnType<typeof editableImageFixture>, recipient: ReturnType<typeof createProjectStore>) {
	const sender = createProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false, databaseName: `retained-image-${crypto.randomUUID()}` });
	try { await writePack(sender, f, f.pack.bytes); await sender.writeMediaAsset(LUT.storageKey, new Blob([LUT_BODY]));
		const runtime = createFramescaperScapeNativeRuntime(PROFILE), archive = await runtime.exportScapeProject(f.project(), sender); assert.ok(archive.blob); await runtime.importScapeProject(archive.blob, recipient);
	} finally { await sender.close(); }
}
