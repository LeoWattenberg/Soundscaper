/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { cloneFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createRawFrameFixtureCurrentV1 } from './helpers/lightscaper-raw-frame-current-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { createPhotoFramescaperCollectionHandoffProjectCurrentV1 } from '../src/lightscaper/controller/photo-framescaper-collection-handoff-project-current-v1.ts';
import { prepareFramescaperImageDevelopSourceCurrentV1 } from '../src/framescaper/timeline-image-develop-authoring-current-v1.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { collectProjectStorageKeys } from '../src/common/editor/retention.js';
import { editableImageFixture, LUT, LUT_BODY } from './helpers/framescaper-editable-image-current-fixture.ts';
import { rawFixtureSha256CurrentV1 } from './helpers/lightscaper-raw-frame-current-fixture.ts';
import { FramescaperScapeImageProjectPublication } from '../src/framescaper/editor-scape-image-project-publication.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });

test('Light RAW Frame native creation, archive, collision rebind and reopen retain Source4 and the complete Original pack', async t => {
	const f = await createRawFrameFixtureCurrentV1(); t.after(() => f.close());
	const senderDb = createInstrumentedIndexedDB(), recipientDb = createInstrumentedIndexedDB();
	const sender = createFramescaperProjectStore(PROFILE, { indexedDB: senderDb as unknown as IDBFactory, preferOpfs: false });
	let recipient = createFramescaperProjectStore(PROFILE, { indexedDB: recipientDb as unknown as IDBFactory, preferOpfs: false });
	t.after(async () => { await sender.close(); await recipient.close(); });
	await f.withDefaultTransport(async () => {
		await sender.writeMediaAsset(f.source.storageKey, f.body, { kind: 'timeline-image', encoding: 'framescaper-image-asset-v1', name: f.source.name, mimeType: f.source.mimeType });
		const project = f.project(), created = await sender.createScapeProjectIfAbsent(project); assert.ok(created);
		assert.deepEqual(await sender.loadProject(project.id), project);
		const runtime = createFramescaperScapeNativeRuntime(PROFILE), exported = await runtime.exportScapeProject(project, sender); assert.ok(exported.blob);
		assert.equal(exported.manifest.project.schemaVersion, 1); assert.equal(exported.manifest.assets.length, 1);
		assert.equal(exported.manifest.assets[0]!.sha256, f.pack.contentSha256);
		const opened = await runtime.importScapeProject(exported.blob, recipient); assert.equal(opened.readOnly, false);
		const actual = cloneFramescaperProject(PROFILE, opened.project), source = actual.sources.find(value => value.kind === 'image'); assert.ok(source);
		assert.deepEqual(source, f.source); assert.deepEqual(await recipient.loadProject(actual.id), actual);
		const body = await recipient.loadMediaAsset(source.storageKey); assert.ok(body); assert.deepEqual(new Uint8Array(await body.arrayBuffer()), f.pack.bytes);
		const again = await runtime.importScapeProject(exported.blob, recipient), rebound = cloneFramescaperProject(PROFILE, again.project);
		const moved = rebound.sources.find(value => value.kind === 'image'); assert.ok(moved); assert.notEqual(moved.storageKey, source.storageKey);
		assert.deepEqual({ ...moved, id: source.id, storageKey: source.storageKey }, source);
		await recipient.close(); recipient = createFramescaperProjectStore(PROFILE, { indexedDB: recipientDb as unknown as IDBFactory, preferOpfs: false });
		assert.deepEqual(await recipient.loadProject(actual.id), actual); assert.deepEqual(await recipient.loadProject(rebound.id), rebound);
		assert.deepEqual(new Uint8Array(await (await recipient.loadMediaAsset(moved.storageKey))!.arrayBuffer()), f.pack.bytes);
		assert.equal(f.workers.active(), 0);
	});
});

test('Light ordinary RAW Frame save refuses a changed native receipt before body audit or project ACK', async t => {
	const f = await createRawFrameFixtureCurrentV1(); t.after(() => f.close());
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false }); t.after(() => store.close());
	await f.withDefaultTransport(async () => {
		await store.writeMediaAsset(f.source.storageKey, f.body, { kind: 'timeline-image', encoding: 'framescaper-image-asset-v1', name: f.source.name, mimeType: f.source.mimeType });
		const project = f.project(), created = await store.createScapeProjectIfAbsent(project); assert.ok(created);
		const revisions = await store.listProjectRevisions(project.id), metadata = await store.getMediaAssetMetadata(f.source.storageKey), joined = f.workers.statistics.joined;
		let audits = 0; const actual = FramescaperScapeImageProjectPublication.prototype.prepareSave;
		t.mock.method(FramescaperScapeImageProjectPublication.prototype, 'prepareSave', function (this: FramescaperScapeImageProjectPublication, ...args: Parameters<typeof actual>) {
			audits++; return Reflect.apply(actual, this, args) as ReturnType<typeof actual>;
		});
		const source = project.sources.find(value => value.kind === 'image'); assert.ok(source && source.kind === 'image' && source.schemaVersion === 4);
		const changed = applyFramescaperProjectCommand(PROFILE, project, { type: 'image-source/set', sourceId: source.id, expectedSource: source,
			source: { ...source, raw: { ...source.raw, rawFlip: 3 } } });
		await assert.rejects(store.saveProjectIfCurrent(project, changed), /immutable image-body authority/iu);
		assert.equal(audits, 0); assert.equal(f.workers.statistics.joined, joined); assert.deepEqual(await store.loadProject(project.id), project);
		assert.deepEqual(await store.listProjectRevisions(project.id), revisions); assert.deepEqual(await store.getMediaAssetMetadata(source.storageKey), metadata);
		assert.deepEqual(new Uint8Array(await (await store.loadMediaAsset(source.storageKey))!.arrayBuffer()), f.pack.bytes);
	});
});

test('Light mixed RAW/raster collection archive preserves order and disabled resources through native save, rebound import and reopen', async t => {
	const maskBytes = Uint8Array.of(83, 67, 77, 65, 83, 75, 48, 49, 1, 0, 0, 0, 1, 0, 0, 0, 64), digest = rawFixtureSha256CurrentV1(maskBytes);
	const brush = { storageKey: `brush-mask-v1:1:1:${digest}`, sha256: digest, byteLength: 17, width: 1, height: 1 };
	const develop = { ...defaultImageDevelopStateV2(), effects: [{ id: 'inactive-lut', type: 'cube-lut-profile-v1' as const, enabled: false, params: { lut: LUT } }],
		masks: [{ schemaVersion: 2 as const, name: 'Retained RAW paint', id: 'paint', kind: 'matte' as const,
			inputs: [{ name: 'body', kind: 'alpha' as const, sourceRef: brush.storageKey }], nodes: [{ id: 'alpha', kind: 'alpha' as const, inputName: 'body' }], outputNodeId: 'alpha' }], maskBindings: [] };
	const f = await createRawFrameFixtureCurrentV1({ develop }), raster = editableImageFixture({ crop: false, cube: false, sourceId: 'raster-source' }); t.after(() => f.close());
	const db = createInstrumentedIndexedDB(), sender = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	let recipient = createFramescaperProjectStore(PROFILE, { indexedDB: db as unknown as IDBFactory, preferOpfs: false });
	t.after(async () => { await sender.close(); await recipient.close(); });
	await f.withDefaultTransport(async () => {
		for (const [source, body] of [[f.source, f.body], [raster.source, new Blob([new Uint8Array(raster.pack.bytes)])]] as const) {
			await sender.writeMediaAsset(source.storageKey, body, { kind: 'timeline-image', encoding: 'framescaper-image-asset-v1', name: source.name, mimeType: source.mimeType });
		}
		await sender.writeMediaAsset(LUT.storageKey, new Blob([LUT_BODY]));
		await sender.writeMediaAsset(brush.storageKey, new Blob([maskBytes]), { kind: 'photo-mask-raster', encoding: 'lightscaper-mask-raster-v1', mimeType: 'application/octet-stream' });
		const project = createPhotoFramescaperCollectionHandoffProjectCurrentV1([f.source, raster.source], { projectId: 'raw-mixed-project', sequenceId: 'raw-mixed-sequence',
			trackId: 'raw-mixed-track', clipIds: ['raw-first', 'raster-second'], name: 'Native mixed order', now: '2026-10-15T00:00:00.000Z' });
		assert.deepEqual(project.sources.map(source => source.id), [f.source.id, raster.source.id]);
		assert.deepEqual(project.clips.map(clip => [clip.id, clip.sourceId, clip.kind === 'image' ? clip.sequenceStartFrame : null]), [['raw-first', f.source.id, 0], ['raster-second', raster.source.id, 150]]);
		const created = await sender.createScapeProjectIfAbsent(project); assert.ok(created);
		const runtime = createFramescaperScapeNativeRuntime(PROFILE), exported = await runtime.exportScapeProject(project, sender); assert.ok(exported.blob);
		assert.equal(exported.manifest.assets.length, 4); assert.equal(exported.manifest.assets.filter(asset => asset.sha256 === LUT.sha256).length, 1);
		assert.equal(exported.manifest.assets.filter(asset => asset.sha256 === brush.sha256).length, 1);
		const imported = await runtime.importScapeProject(exported.blob, recipient); assert.equal(imported.readOnly, false);
		const current = cloneFramescaperProject(PROFILE, imported.project); assert.deepEqual(current.sources, project.sources); assert.deepEqual(current.clips, project.clips);
		const nextDevelop = replaceImageDevelopRepairSpotsV1(f.source.develop, { schemaVersion: 1, spots: [{ id: 'frame-clone', mode: 'clone', enabled: true,
			target: { x: .765625, y: .640625 }, source: { x: .265625, y: .640625 }, radius: .01, feather: 0, opacity: 1 }] });
		const command = prepareFramescaperImageDevelopSourceCurrentV1(current, 'raw-first', nextDevelop);
		const edited = applyFramescaperProjectCommand(PROFILE, current, command); assert.deepEqual(await recipient.saveProjectIfCurrent(current, edited), edited);
		assert.equal(await recipient.saveProjectIfCurrent(current, edited), null);
		assert.ok(collectProjectStorageKeys(edited).has(LUT.storageKey)); assert.ok(collectProjectStorageKeys(edited).has(brush.storageKey));
		const source = edited.sources.find(value => value.kind === 'image' && value.id === f.source.id); assert.ok(source && source.kind === 'image' && source.schemaVersion === 4);
		assert.deepEqual(source.raw, f.raw); assert.deepEqual(source.develop, nextDevelop); assert.equal(source.provenance.origin.schemaFamily, 'framescaper');
		const nextArchive = await runtime.exportScapeProject(edited, recipient); assert.ok(nextArchive.blob);
		const rebound = cloneFramescaperProject(PROFILE, (await runtime.importScapeProject(nextArchive.blob, recipient)).project);
		assert.notEqual(rebound.id, edited.id); assert.deepEqual(rebound.sources.map(value => value.kind === 'image' ? value.schemaVersion : null), [4, 2]);
		assert.deepEqual(rebound.clips.map(clip => clip.kind === 'image' ? clip.sequenceStartFrame : null), [0, 150]);
		await recipient.close(); recipient = createFramescaperProjectStore(PROFILE, { indexedDB: db as unknown as IDBFactory, preferOpfs: false });
		assert.deepEqual(await recipient.loadProject(edited.id), edited); assert.deepEqual(await recipient.loadProject(rebound.id), rebound);
		for (const [key, bytes] of [[source.storageKey, f.pack.bytes], [raster.source.storageKey, raster.pack.bytes], [LUT.storageKey, LUT_BODY], [brush.storageKey, maskBytes]] as const) {
			const body = await recipient.loadMediaAsset(key); assert.ok(body); assert.deepEqual(new Uint8Array(await body.arrayBuffer()), bytes);
		}
	});
});
