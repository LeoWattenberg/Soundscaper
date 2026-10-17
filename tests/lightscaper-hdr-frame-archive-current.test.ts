/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { cloneFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { prepareFramescaperImageDevelopSourceCurrentV1 } from '../src/framescaper/timeline-image-develop-authoring-current-v1.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { withPhotoFramescaperHandoffReadCurrentV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-read-current-v1.ts';
import { preparePhotoFramescaperHandoffOriginalCurrentV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-original-current-v1.ts';
import { withPhotoOriginalFrameCurrentV1 } from '../src/lightscaper/preview/photo-original-frame-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateThroughV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { hdrFrameFixtureCurrentV1, HDR_FRAME_SAMPLES } from './helpers/lightscaper-hdr-frame-current-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });

test('Current Source5 native save, archive collision rebind, reopen and reverse read preserve actual HDR body and recipe', async t => {
	const f = await hdrFrameFixtureCurrentV1(), sender = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	const db = createInstrumentedIndexedDB(); let recipient = createFramescaperProjectStore(PROFILE, { indexedDB: db as unknown as IDBFactory, preferOpfs: false });
	t.after(async () => { await sender.close(); await recipient.close(); });
	await sender.writeMediaAsset(f.source.storageKey, f.body, { kind: 'timeline-image', encoding: 'framescaper-image-asset-v1', name: f.source.name, mimeType: f.source.mimeType });
	const project = f.project(); assert.ok(await sender.createScapeProjectIfAbsent(project));
	const metadata = await sender.getMediaAssetMetadata(f.source.storageKey);
	const develop = normalizeImageDevelopStateThroughV4({ ...defaultImageDevelopStateV2(), effects: [{ id: 'exposure', type: 'tone-ladder-v1', enabled: true, params: { exposure: -2 } }] });
	const edited = applyFramescaperProjectCommand(PROFILE, project, prepareFramescaperImageDevelopSourceCurrentV1(project, 'hdr-clip', develop));
	assert.deepEqual(await sender.saveProjectIfCurrent(project, edited), edited); assert.equal(await sender.saveProjectIfCurrent(project, edited), null);
	const runtime = createFramescaperScapeNativeRuntime(PROFILE), exported = await runtime.exportScapeProject(edited, sender); assert.ok(exported.blob);
	const opened = cloneFramescaperProject(PROFILE, (await runtime.importScapeProject(exported.blob, recipient)).project);
	assert.deepEqual(opened, edited);
	const rebound = cloneFramescaperProject(PROFILE, (await runtime.importScapeProject(exported.blob, recipient)).project);
	const source = rebound.sources.find(value => value.kind === 'image'); assert.ok(source?.kind === 'image' && source.schemaVersion === 5);
	assert.notEqual(source.storageKey, f.source.storageKey); assert.deepEqual(source.hdr, f.source.hdr); assert.deepEqual(source.develop, develop);
	await recipient.close(); recipient = createFramescaperProjectStore(PROFILE, { indexedDB: db as unknown as IDBFactory, preferOpfs: false });
	assert.deepEqual(await recipient.loadProject(rebound.id), rebound);
	assert.deepEqual(new Uint8Array(await (await recipient.loadMediaAsset(source.storageKey))!.arrayBuffer()), f.pack.bytes);
	assert.deepEqual(await sender.getMediaAssetMetadata(f.source.storageKey), metadata);
	await withPhotoFramescaperHandoffReadCurrentV1({ archive: exported.blob, sourceId: f.source.id }, async view => {
		assert.equal(view.source.schemaVersion, 5); assert.equal(view.canonicalFrameSha256, f.hdr.pixelsSha256); assert.deepEqual(view.source.develop, develop);
		const prepared = await preparePhotoFramescaperHandoffOriginalCurrentV1({ source: view.source, originalBlob: view.originalBlob,
			canonicalFrameSha256: view.canonicalFrameSha256, signal: view.signal });
		assert.deepEqual(new Uint8Array(await prepared.originalBlob.arrayBuffer()), f.original);
		await withPhotoOriginalFrameCurrentV1({ binding: { sourceKind: 'hdr-original', catalogId: 'return-catalog', photoId: 'return-photo', originalId: 'return-original', storageKey: 'return-storage',
			contentSha256: f.source.original.sha256, byteLength: f.original.length, width: 2, height: 1 }, body: prepared.originalBlob }, async frame => {
			assert.deepEqual([...frame.pixels], [...Float32Array.from(HDR_FRAME_SAMPLES)]);
		});
	});
});

test('ordinary Source5 save refuses immutable HDR receipt changes before any native publication', async t => {
	const f = await hdrFrameFixtureCurrentV1(), store = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	t.after(() => store.close());
	await store.writeMediaAsset(f.source.storageKey, f.body, { kind: 'timeline-image', encoding: 'framescaper-image-asset-v1', name: f.source.name, mimeType: f.source.mimeType });
	const project = f.project(); assert.ok(await store.createScapeProjectIfAbsent(project));
	const source = project.sources.find(value => value.kind === 'image'); assert.ok(source?.kind === 'image' && source.schemaVersion === 5);
	const changed = applyFramescaperProjectCommand(PROFILE, project, { type: 'image-source/set', sourceId: source.id, expectedSource: source,
		source: { ...source, hdr: { ...source.hdr, pixelsSha256: 'f'.repeat(64) } } });
	await assert.rejects(store.saveProjectIfCurrent(project, changed), /immutable image-body authority/iu);
	assert.deepEqual(await store.loadProject(project.id), project); assert.deepEqual(new Uint8Array(await (await store.loadMediaAsset(source.storageKey))!.arrayBuffer()), f.pack.bytes);
});

test('Source5 creation rejects a corrupted retained body without publishing project state', async t => {
	const f = await hdrFrameFixtureCurrentV1(), bytes = new Uint8Array(f.pack.bytes); bytes[bytes.length - 1]! ^= 1;
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false }); t.after(() => store.close());
	await store.writeMediaAsset(f.source.storageKey, new Blob([bytes]), { kind: 'timeline-image', encoding: 'framescaper-image-asset-v1', name: f.source.name, mimeType: f.source.mimeType });
	await assert.rejects(store.createScapeProjectIfAbsent(f.project()), /digest|SHA|authority/iu); assert.equal(await store.loadProject('hdr-project'), null);
});
