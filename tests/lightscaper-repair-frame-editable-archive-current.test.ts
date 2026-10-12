/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { metadataCrc32 } from '../src/common/editor/imaging/image-metadata-binary.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { createFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../src/common/editor/timeline-image-model.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { createStorageRepositories } from '../src/common/editor/storage/repositories.ts';
import { createFramescaperProjectStore } from '../src/framescaper/editor-project-store.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { collectProjectStorageKeys } from '../src/common/editor/retention.js';
import { collectCubeLutProfileProjectReferencesV1 } from '../src/common/editor/video-cube-lut-project-references-v1.ts';
import { cloneFramescaperProject, validateFramescaperProject } from '../src/framescaper/editor-project.ts';
import { createFramescaperProjectHistory, executeFramescaperProjectCommand, undoFramescaperProjectCommand,
	redoFramescaperProjectCommand } from '../src/framescaper/editor-project-history.ts';
import { editableImageFixture, PROFILE, LUT, LUT_BODY } from './helpers/framescaper-editable-image-current-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
function digest(bytes: Uint8Array | string) { return createHash('sha256').update(bytes).digest('hex'); }
function png(pixels: Uint8Array) {
	function chunk(name: string, bytes: Uint8Array) {
		const type = Buffer.from(name), value = Buffer.alloc(bytes.length + 12); value.writeUInt32BE(bytes.length);
		type.copy(value, 4); value.set(bytes, 8); value.writeUInt32BE(metadataCrc32(Buffer.concat([type, bytes])), bytes.length + 8); return value;
	}
	const header = Buffer.alloc(13); header.writeUInt32BE(3); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
	return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
		chunk('IDAT', deflateSync(Buffer.concat([Buffer.from([0]), pixels]))), chunk('IEND', new Uint8Array())]));
}
function fixture() {
	const pixels = new Uint8Array([64, 64, 64, 255, 0, 0, 0, 255, 255, 255, 255, 255]), original = png(pixels);
	// Independent canonical SCMASK01 header and alpha, not a production encoder oracle.
	const maskBytes = new Uint8Array([83, 67, 77, 65, 83, 75, 48, 49, 1, 0, 0, 0, 1, 0, 0, 0, 64]), sha256 = digest(maskBytes);
	const mask = { storageKey: `brush-mask-v1:1:1:${sha256}`, sha256, width: 1, height: 1, byteLength: 17 };
	const develop = replaceImageDevelopRepairSpotsV1({ ...defaultImageDevelopStateV2(),
		effects: [{ id: 'inactive-profile', type: 'cube-lut-profile-v1', enabled: false, params: { lut: LUT } }],
		masks: [{ schemaVersion: 2, name: 'Unused retained paint', id: 'unused', kind: 'matte', inputs: [{ name: 'paint', kind: 'alpha', sourceRef: mask.storageKey }],
			nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'alpha' }], maskBindings: [] },
		{ schemaVersion: 1, spots: [{ id: 'repair', mode: 'clone', enabled: true, target: { x: .5, y: .5 }, source: { x: 1 / 6, y: .5 }, radius: .1, feather: 0, opacity: 1 }] });
	const pack = createFramescaperImageFramePackV1({ original, receipt: { schemaVersion: 1, orientation: 1, decoder: { id: 'browser-native', version: '1' } }, width: 3, height: 1,
		timingMode: 'fallback', frames: [{ presentationTicks: 0n, durationTicks: 1_000_000n, rgba: pixels }] });
	const source = { schemaVersion: 3, kind: 'image', id: 'repair-source', name: 'Repaired photo', storageKey: 'repair-source', mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
		assetByteLength: pack.assetByteLength, contentSha256: pack.contentSha256, conversionReceiptSha256: pack.conversionReceiptSha256,
		original: { fileName: 'repair.png', mimeType: 'image/png', recognizedFormat: 'png', byteLength: original.byteLength, sha256: pack.originalSha256 },
		canonical: { width: 3, height: 1, hasAlpha: false, frameCount: 1, durationTicks: pack.durationTicks, timingMode: 'fallback' }, develop, developed: { width: 3, height: 1 },
		provenance: { schemaVersion: 2, kind: 'image-develop-handoff', original: { exactName: 'repair.png', sha256: pack.originalSha256, byteLength: original.byteLength },
			developSha256: digest(JSON.stringify(develop)), origin: { schemaFamily: 'lightscaper', schemaVersion: 3, catalogId: 'catalog', photoId: 'photo', revision: 7,
				versionId: 'saved', versionKind: 'master', versionName: 'Saved', versionCreatedAt: '2026-10-01T00:00:00.000Z' } } };
	const base = editableImageFixture({ crop: false }).baseProject();
	const command = { type: 'image-source/set', sourceId: source.id, expectedSource: null, source };
	const project = () => applyFramescaperProjectCommand(PROFILE, base, { type: 'batch', commands: [command,
		{ type: 'image-clip/set', clipId: 'repair-clip', expectedClip: null, expectedPlacement: null,
			clip: { schemaVersion: 1, kind: 'image', id: 'repair-clip', sourceId: source.id, sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 1, sourceStartTicks: '0' },
			placement: { scope: 'timeline', trackId: 'video-track' } }] });
	return { source, pack, original, mask, maskBytes, base, command, project };
}
async function stage(store: ReturnType<typeof createFramescaperProjectStore>, f: ReturnType<typeof fixture>, maskBytes = f.maskBytes) {
	await store.writeMediaAsset(f.source.storageKey, new Blob([new Uint8Array(f.pack.bytes)]), { kind: 'timeline-image', encoding: 'framescaper-image-asset-v1', name: f.source.name, mimeType: f.source.mimeType });
	await store.writeMediaAsset(LUT.storageKey, new Blob([LUT_BODY]));
	await store.writeMediaAsset(f.mask.storageKey, new Blob([maskBytes]), { kind: 'photo-mask-raster', encoding: 'lightscaper-mask-raster-v1', mimeType: 'application/octet-stream' });
}

test('Light Current Frame actual source commands and undo/redo retain complete Source3 in project schema1', () => {
	const f = fixture(), before = structuredClone(f.base), project = f.project();
	assert.equal(project.schemaVersion, 1); assert.equal(validateFramescaperProject(PROFILE, project), true);
	assert.deepEqual(cloneFramescaperProject(PROFILE, project).sources, [f.source]); assert.deepEqual(f.base, before);
	const history = executeFramescaperProjectCommand(PROFILE, createFramescaperProjectHistory(PROFILE, f.base), f.command);
	assert.deepEqual(history.present.sources, [f.source]); const undone = undoFramescaperProjectCommand(PROFILE, history);
	assert.deepEqual(undone.present.sources, []); assert.deepEqual(redoFramescaperProjectCommand(PROFILE, undone).present.sources, [f.source]);
	assert.throws(() => applyFramescaperProjectCommand(PROFILE, project, { ...f.command, expectedSource: null }), /stale/iu);
	assert.deepEqual(project.sources, [f.source]);
});

test('Light Current native Frame archive closes complete disabled LUT and unused brush declarations before editable publication', async t => {
	const f = fixture(), project = f.project(), sender = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	const recipient = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false });
	t.after(async () => { await sender.close(); await recipient.close(); }); await stage(sender, f);
	const runtime = createFramescaperScapeNativeRuntime(PROFILE), exported = await runtime.exportScapeProject(project, sender); assert.ok(exported.blob);
	assert.equal(exported.manifest.project.schemaVersion, 1);
	assert.equal(exported.manifest.assets.length, 3); assert.ok(exported.manifest.assets.some(asset => asset.sha256 === LUT.sha256));
	assert.deepEqual(exported.manifest.assets.find(asset => asset.kind === 'photo-mask-raster'), { sourceId: f.mask.storageKey,
		kind: 'photo-mask-raster', entry: `assets/masks/${f.mask.sha256}.scmask`, encoding: 'lightscaper-mask-raster-v1', mimeType: 'application/octet-stream', size: 17, sha256: f.mask.sha256 });
	const imported = await runtime.importScapeProject(exported.blob, recipient); assert.equal(imported.readOnly, false);
	const actual = cloneFramescaperProject(PROFILE, imported.project), image = actual.sources.find(value => value.kind === 'image'); assert.ok(image);
	assert.equal(image.schemaVersion, 3); assert.ok('develop' in image); assert.deepEqual(image.develop, f.source.develop);
	assert.deepEqual(image.provenance, f.source.provenance); assert.deepEqual(await recipient.loadProject(actual.id), actual);
	for (const [key, bytes] of [[image.storageKey, f.pack.bytes], [LUT.storageKey, LUT_BODY], [f.mask.storageKey, f.maskBytes]] as const) {
		const body = await recipient.loadMediaAsset(key); assert.ok(body); assert.deepEqual(new Uint8Array(await body.arrayBuffer()), bytes);
	}
	const again = await runtime.importScapeProject(exported.blob, recipient), rebound = cloneFramescaperProject(PROFILE, again.project);
	assert.notEqual(rebound.id, actual.id); const moved = rebound.sources.find(value => value.kind === 'image'); assert.ok(moved);
	assert.notEqual(moved.storageKey, image.storageKey); assert.ok('develop' in moved); assert.deepEqual(moved.develop, f.source.develop); assert.deepEqual(moved.provenance, f.source.provenance);
	assert.deepEqual(new Uint8Array(await (await recipient.loadMediaAsset(moved.storageKey))!.arrayBuffer()), f.pack.bytes);
});

for (const corruption of ['missing', 'header', 'digest'] as const) test(`Light Current native Frame publication refuses ${corruption} unused brush authority`, async t => {
	const f = fixture(), project = f.project(), indexedDB = createInstrumentedIndexedDB();
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: indexedDB as unknown as IDBFactory, preferOpfs: false }); t.after(() => store.close());
	const bytes = f.maskBytes.slice(); if (corruption === 'header') bytes[0] = 0; if (corruption === 'digest') bytes[16] = 63;
	await stage(store, f, bytes); if (corruption === 'missing') await store.deleteMediaAsset(f.mask.storageKey);
	await assert.rejects(store.createScapeProjectIfAbsent(project), /body|brush|mask|SCMASK|SHA|digest|missing/iu);
	assert.equal(await store.loadProject(project.id), null); assert.deepEqual(await store.listProjectRevisions(project.id), []);
	assert.deepEqual(f.maskBytes, new Uint8Array([83, 67, 77, 65, 83, 75, 48, 49, 1, 0, 0, 0, 1, 0, 0, 0, 64]));
});


test('Light native Source3 recipe edits save and reopen without changing immutable pack or unused body retention', async t => {
	const f = fixture(), indexedDB = createInstrumentedIndexedDB();
	let store = createFramescaperProjectStore(PROFILE, { indexedDB: indexedDB as unknown as IDBFactory, preferOpfs: false }); t.after(() => store.close());
	await stage(store, f); const initial = await store.createScapeProjectIfAbsent(f.project()); assert.ok(initial);
	const source = cloneFramescaperProject(PROFILE, initial).sources.find(value => value.kind === 'image'); assert.ok(source && source.kind === 'image' && source.schemaVersion === 3);
	const develop = replaceImageDevelopRepairSpotsV1(source.develop, { schemaVersion: 1, spots: [] });
	const changed = { ...source, develop, provenance: { ...source.provenance, developSha256: digest(JSON.stringify(develop)) } };
	const edited = applyFramescaperProjectCommand(PROFILE, initial, { type: 'image-source/set', sourceId: source.id, expectedSource: source, source: changed });
	assert.deepEqual(await store.saveProjectIfCurrent(initial, edited), edited);
	const acknowledgedRevisions = await store.listProjectRevisions(edited.id);
	assert.equal(await store.saveProjectIfCurrent(initial, edited), null);
	assert.deepEqual(await store.loadProject(edited.id), edited); assert.deepEqual(await store.listProjectRevisions(edited.id), acknowledgedRevisions);
	assert.throws(() => collectCubeLutProfileProjectReferencesV1(edited), /version/iu);
	assert.ok(collectProjectStorageKeys(edited).has(f.mask.storageKey)); assert.ok(collectProjectStorageKeys(edited).has(LUT.storageKey));
	await store.close(); store = createFramescaperProjectStore(PROFILE, { indexedDB: indexedDB as unknown as IDBFactory, preferOpfs: false });
	assert.deepEqual(await store.loadProject(edited.id), edited);
	const pruned = await store.pruneUnreferencedSources({ minimumAgeMs: 0, now: Date.now() + 86_400_000 });
	assert.ok(!pruned.deletedSourceIds.includes(f.mask.storageKey)); assert.ok(!pruned.deletedSourceIds.includes(LUT.storageKey));
	for (const [key, bytes] of [[source.storageKey, f.pack.bytes], [LUT.storageKey, LUT_BODY], [f.mask.storageKey, f.maskBytes]] as const) {
		assert.deepEqual(new Uint8Array(await (await store.loadMediaAsset(key))!.arrayBuffer()), bytes);
	}
});


function withReferences(f: ReturnType<typeof fixture>, refs: readonly string[], id = f.source.id) {
	const masks = Array.from({ length: Math.ceil(refs.length / 256) }, (_, graph) => ({ schemaVersion: 1, id: `declared-${graph}`, kind: 'matte',
		inputs: refs.slice(graph * 256, (graph + 1) * 256).map((sourceRef, input) => ({ name: `paint-${input}`, kind: 'alpha', sourceRef })),
		nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'paint-0' }], outputNodeId: 'alpha' }));
	const develop = replaceImageDevelopRepairSpotsV1({ ...f.source.develop, effects: [], masks, maskBindings: [] }, f.source.develop.repairs);
	return { ...f.source, id, storageKey: id, develop, provenance: { ...f.source.provenance, developSha256: digest(JSON.stringify(develop)) } };
}
for (const corruption of ['missing', 'header'] as const) test(`Light ordinary native Source3 save refuses a newly declared ${corruption} brush before its Photo-independent project ACK`, async t => {
	const f = fixture(), indexedDB = createInstrumentedIndexedDB(), store = createFramescaperProjectStore(PROFILE, { indexedDB: indexedDB as unknown as IDBFactory, preferOpfs: false });
	t.after(() => store.close()); await stage(store, f); const initial = await store.createScapeProjectIfAbsent(f.project()); assert.ok(initial);
	const current = cloneFramescaperProject(PROFILE, initial), source = current.sources.find(value => value.kind === 'image'); assert.ok(source);
	const bad = f.maskBytes.slice(); bad[0] = 0; const key = `brush-mask-v1:1:1:${corruption === 'missing' ? 'a'.repeat(64) : digest(bad)}`;
	if (corruption === 'header') await store.writeMediaAsset(key, new Blob([bad]));
	const next = withReferences(f, [key]), edited = applyFramescaperProjectCommand(PROFILE, current,
		{ type: 'image-source/set', sourceId: source.id, expectedSource: source, source: next });
	const revisions = await store.listProjectRevisions(current.id);
	await assert.rejects(store.saveProjectIfCurrent(current, edited), /body|missing|brush|mask|header|SCMASK/iu);
	assert.deepEqual(await store.loadProject(current.id), current); assert.deepEqual(await store.listProjectRevisions(current.id), revisions);
	assert.deepEqual(new Uint8Array(await (await store.loadMediaAsset(source.storageKey))!.arrayBuffer()), f.pack.bytes);
});

for (const failure of ['conflicting-geometry', 'combined-capacity'] as const) test(`Light complete two-source ${failure} refusal precedes every native Frame body read`, async t => {
	const f = fixture(), indexedDB = createInstrumentedIndexedDB(); let reads = 0;
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: indexedDB as unknown as IDBFactory, preferOpfs: false,
		repositoryFactory(port: Parameters<typeof createStorageRepositories>[0], options: Parameters<typeof createStorageRepositories>[1]) {
			const repositories = createStorageRepositories(port, options), originalLoad = repositories.media.loadAsset;
			repositories.media.loadAsset = function (...args: Parameters<typeof originalLoad>) { reads++; return Reflect.apply(originalLoad, repositories.media, args) as ReturnType<typeof originalLoad>; };
			return repositories;
		} }); t.after(() => store.close());
	const refs = failure === 'conflicting-geometry' ? [`brush-mask-v1:2:1:${'b'.repeat(64)}`, `brush-mask-v1:1:2:${'b'.repeat(64)}`]
		: Array.from({ length: 4095 }, (_, index) => `brush-mask-v1:1:1:${(index + 1).toString(16).padStart(64, '0')}`);
	const first = withReferences(f, failure === 'conflicting-geometry' ? [refs[0]!] : refs.slice(0, 2048)),
		second = withReferences(f, failure === 'conflicting-geometry' ? [refs[1]!] : refs.slice(2048), 'second-source');
	let project = applyFramescaperProjectCommand(PROFILE, f.base, { type: 'image-source/set', sourceId: first.id, expectedSource: null, source: first });
	project = applyFramescaperProjectCommand(PROFILE, project, { type: 'image-source/set', sourceId: second.id, expectedSource: null, source: second });
	for (const source of [first, second]) await store.writeMediaAsset(source.storageKey, new Blob([new Uint8Array(f.pack.bytes)]), { kind: 'timeline-image', encoding: 'framescaper-image-asset-v1', name: source.name, mimeType: source.mimeType });
	reads = 0; const outcome = await store.createScapeProjectIfAbsent(project).then(value => ({ value }), (error: unknown) => ({ error }));
	assert.equal(reads, 0, 'The complete scalar closure must refuse before the first authenticated body read');
	assert.ok('error' in outcome); assert.match(String(outcome.error), /capacity|conflict|geometry|reachability/iu);
	assert.equal(await store.loadProject(project.id), null); assert.deepEqual(await store.listProjectRevisions(project.id), []);
});


test('Light native Source3 save cannot mint a body certificate from a substituted public media reader', async t => {
	const f = fixture(), indexedDB = createInstrumentedIndexedDB();
	let nativeMedia: ReturnType<typeof createStorageRepositories>['media'] | undefined, nativePort: Parameters<typeof createStorageRepositories>[0] | undefined;
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: indexedDB as unknown as IDBFactory, preferOpfs: false,
		repositoryFactory(port: Parameters<typeof createStorageRepositories>[0], options: Parameters<typeof createStorageRepositories>[1]) {
			const repositories = createStorageRepositories(port, options); nativeMedia = repositories.media; nativePort = port; return repositories;
		} }); t.after(() => store.close());
	await stage(store, f); const initial = await store.createScapeProjectIfAbsent(f.project()); assert.ok(initial); assert.ok(nativeMedia); assert.ok(nativePort);
	const media = nativeMedia, load = media.loadAsset, database = await nativePort.database(); assert.ok(database);
	const rows = indexedDB.records(database.name, 'mediaAssets') as Record<string, unknown>[], row = rows.find(value => value.sourceId === f.mask.storageKey); assert.ok(row);
	const malformed = f.maskBytes.slice(); malformed[0] = 0;
	// Hostile same-token corruption plus a substitute body reader must never
	// become native publication authority. Original/pack bytes remain genuine.
	indexedDB.seedRecord(database.name, 'mediaAssets', { ...row, blob: new Blob([malformed]) });
	media.loadAsset = function (...args: Parameters<typeof load>) {
		assert.equal(this, media);
		return args[0] === f.mask.storageKey ? Promise.resolve(new Blob([f.maskBytes])) : Reflect.apply(load, media, args) as ReturnType<typeof load>;
	}; t.after(() => { media.loadAsset = load; });
	const project = cloneFramescaperProject(PROFILE, initial), source = project.sources.find(value => value.kind === 'image'); assert.ok(source && source.kind === 'image' && source.schemaVersion === 3);
	const develop = replaceImageDevelopRepairSpotsV1(source.develop, { schemaVersion: 1, spots: [] });
	const next = { ...source, develop, provenance: { ...source.provenance, developSha256: digest(JSON.stringify(develop)) } };
	const edited = applyFramescaperProjectCommand(PROFILE, project, { type: 'image-source/set', sourceId: source.id, expectedSource: source, source: next }), revisions = await store.listProjectRevisions(project.id);
	await assert.rejects(store.saveProjectIfCurrent(project, edited), /body|brush|mask|header|SCMASK/iu);
	assert.deepEqual(await store.loadProject(project.id), project); assert.deepEqual(await store.listProjectRevisions(project.id), revisions);
	const stored = indexedDB.records(database.name, 'mediaAssets') as Record<string, unknown>[];
	assert.deepEqual(new Uint8Array(await (stored.find(value => value.sourceId === f.mask.storageKey)!.blob as Blob).arrayBuffer()), malformed);
	assert.deepEqual(new Uint8Array(await (await Reflect.apply(load, media, [f.source.storageKey]) as Blob).arrayBuffer()), f.pack.bytes);
});


test('Light native Source3 body tokens are rechecked inside the actual save transaction before project ACK', async t => {
	const f = fixture(), indexedDB = createInstrumentedIndexedDB(); let nativePort: Parameters<typeof createStorageRepositories>[0] | undefined;
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: indexedDB as unknown as IDBFactory, preferOpfs: false,
		repositoryFactory(port: Parameters<typeof createStorageRepositories>[0], options: Parameters<typeof createStorageRepositories>[1]) { nativePort = port; return createStorageRepositories(port, options); }
	}); t.after(() => store.close()); await stage(store, f);
	const initial = await store.createScapeProjectIfAbsent(f.project()); assert.ok(initial); assert.ok(nativePort);
	const database = await nativePort.database(); assert.ok(database);
	const row = (indexedDB.records(database.name, 'mediaAssets') as Record<string, unknown>[]).find(value => value.sourceId === f.mask.storageKey); assert.ok(row);
	const prior = Object.getOwnPropertyDescriptor(database, 'transaction'), transaction = database.transaction; let checkpoints = 0;
	Object.defineProperty(database, 'transaction', { configurable: true, value: function (this: IDBDatabase, names: string | string[], mode?: IDBTransactionMode, options?: IDBTransactionOptions): IDBTransaction {
		assert.equal(this, database); const stores = typeof names === 'string' ? [names] : names;
		if (mode === 'readwrite' && stores.join(',') === 'projects,revisions,sources,mediaAssets,settings') {
			checkpoints++; indexedDB.seedRecord(database.name, 'mediaAssets', { ...row, mediaContentToken: 'media-content-11111111-1111-4111-8111-111111111111' });
		}
		return Reflect.apply(transaction, database, [names, mode, options]) as IDBTransaction;
	} }); t.after(() => { if (prior) Object.defineProperty(database, 'transaction', prior); else Reflect.deleteProperty(database, 'transaction'); });
	const project = cloneFramescaperProject(PROFILE, initial), source = project.sources.find(value => value.kind === 'image'); assert.ok(source && source.kind === 'image' && source.schemaVersion === 3);
	const develop = replaceImageDevelopRepairSpotsV1(source.develop, { schemaVersion: 1, spots: [] });
	const next = { ...source, develop, provenance: { ...source.provenance, developSha256: digest(JSON.stringify(develop)) } };
	const edited = applyFramescaperProjectCommand(PROFILE, project, { type: 'image-source/set', sourceId: source.id, expectedSource: source, source: next }), revisions = await store.listProjectRevisions(project.id);
	await assert.rejects(store.saveProjectIfCurrent(project, edited), /body|resource|changed|atomic/iu); assert.equal(checkpoints, 1);
	assert.deepEqual(await store.loadProject(project.id), project); assert.deepEqual(await store.listProjectRevisions(project.id), revisions);
	assert.deepEqual(new Uint8Array(await (await store.loadMediaAsset(f.mask.storageKey))!.arrayBuffer()), f.maskBytes);
	assert.deepEqual(new Uint8Array(await (await store.loadMediaAsset(f.source.storageKey))!.arrayBuffer()), f.pack.bytes);
});
