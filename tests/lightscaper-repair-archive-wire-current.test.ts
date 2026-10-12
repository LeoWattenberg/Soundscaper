/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { copyImageDevelopSelectedSettingsV3 } from '../src/common/editor/imaging/image-develop-settings-selected-v3.ts';
import { createImageDevelopSelectedPresetV3 } from '../src/common/editor/imaging/image-develop-preset-selected-v3.ts';
import { normalizePhotoDocumentCurrentV1, serializePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { serializePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { normalizePhotoDevelopWorkspaceV3 } from '../src/lightscaper/catalog/photo-develop-workspace-v3.ts';
import { normalizePhotoDevelopPresetRowCurrentV1, type PhotoDevelopPresetRowCurrentV1 } from '../src/lightscaper/storage/photo-develop-preset-row-current-v1.ts';
import { encodePhotoCatalogPackV2 } from '../src/lightscaper/archive/catalog-pack-v2.ts';
import { encodePhotoCatalogPackV3, readPhotoCatalogPackV3, measurePhotoCatalogPackRecordV3 } from '../src/lightscaper/archive/catalog-pack-v3.ts';
import { encodePhotoCatalogPackV4, readPhotoCatalogPackV4, measurePhotoCatalogPackRecordV4 } from '../src/lightscaper/archive/catalog-pack-v4.ts';
import { encodePhotoDevelopPresetPackV2 } from '../src/lightscaper/archive/develop-preset-pack-v2.ts';
import { encodePhotoDevelopPresetPackV3, readPhotoDevelopPresetPackV3 } from '../src/lightscaper/archive/develop-preset-pack-v3.ts';
import { normalizePhotoCatalogArchiveV7, assertPhotoCatalogPackManifestV7 } from '../src/lightscaper/archive/catalog-archive-contract-v7.ts';
import { SCAPE_FORMAT, SCAPE_FORMAT_VERSION } from '../src/common/editor/scape-archive-limits.ts';
import { lutArchiveFixture } from './helpers/lightscaper-lut-archive-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

// Root observed these oracles against actual strict legacy owners before
// binding the named successors. Permanent old-profile controls stay explicit.
type Input = Readonly<{ photo: PhotoDocumentCurrentV1; original: Blob }>;
type Options = Readonly<{ signal?: AbortSignal; maximumRecords?: number; maximumPackBytes?: number; maximumChunkBytes?: number }>;
const encode = (records: Iterable<Input>, options: Options = {}): AsyncIterable<Uint8Array> => encodePhotoCatalogPackV4(records, options);
const read = (source: AsyncIterable<Uint8Array>, consume: (photo: PhotoDocumentCurrentV1, original: AsyncIterable<Uint8Array>) => Promise<void>, options: Options = {}): Promise<number> => readPhotoCatalogPackV4(source, consume, options);
const measure = (value: unknown): number => measurePhotoCatalogPackRecordV4(value);
const encodeRow = (value: unknown, catalogId = 'catalog-1'): AsyncIterable<Uint8Array> => encodePhotoDevelopPresetPackV3(value, catalogId);
const readRow = (source: AsyncIterable<Uint8Array>, catalogId = 'catalog-1'): Promise<PhotoDevelopPresetRowCurrentV1> => readPhotoDevelopPresetPackV3(source, catalogId);
const normalizeArchive = (value: unknown) => normalizePhotoCatalogArchiveV7(value);
const assertManifest = (document: unknown, manifest: unknown): void => { Reflect.apply(assertPhotoCatalogPackManifestV7, undefined, [document, manifest]); };
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const BODY = new Uint8Array([83, 67, 77, 65, 83, 75, 48, 49, 2, 0, 0, 0, 1, 0, 0, 0, 64, 192]);
const REFERENCE = Object.freeze({ storageKey: `brush-mask-v1:2:1:${sha(BODY)}`, sha256: sha(BODY), width: 2, height: 1, byteLength: BODY.length });
const NOW = '2026-10-07T00:00:00.000Z';
function repair(id: string, mode: 'clone' | 'heal') {
	return { id, mode, enabled: mode === 'clone', source: { x: 0.2, y: 0.5 }, target: { x: 0.7, y: 0.5 }, radius: 0.15, feather: 0.5, opacity: 0.75 };
}
function fixture() {
	const old = photoArchiveFixture(), legacy = old.photo.versions[0]!, previous = lutArchiveFixture();
	const current = replaceImageDevelopRepairSpotsV1({ ...previous.record.photo.versions[0]!.develop, masks: [{ schemaVersion: 2, id: 'paint', name: 'Retained paint', kind: 'matte',
		inputs: [{ name: 'used', kind: 'alpha', sourceRef: REFERENCE.storageKey }, { name: 'unused', kind: 'raster', sourceRef: REFERENCE.storageKey }],
		nodes: [{ id: 'a', kind: 'alpha', inputName: 'used' }, { id: 'out', kind: 'invert', inputNodeId: 'a' }], outputNodeId: 'out' }], maskBindings: [] },
	{ schemaVersion: 1, spots: [repair('clone', 'clone'), repair('heal', 'heal')] });
	const workspace = normalizePhotoDevelopWorkspaceV3({ schemaVersion: 3, kind: 'photo-develop-workspace', cursor: 0,
		entries: [{ label: 'Selected legacy', createdAt: null, develop: legacy.develop }, { label: 'Redo repairs', createdAt: null, develop: current }],
		snapshots: [{ id: 'repair-snapshot', name: 'Repairs and paint', createdAt: NOW, develop: current }] });
	const photo = normalizePhotoDocumentCurrentV1({ ...old.photo, schemaVersion: 3, versions: [{ ...legacy, workspace },
		{ ...legacy, id: 'inactive', kind: 'virtual-copy', name: 'Inactive repairs', develop: current }] });
	const settings = copyImageDevelopSelectedSettingsV3({ schemaVersion: 3, develop: current, selection: { effectTypes: 'all', geometry: true, localAdjustments: true, repairs: true } });
	const preset = createImageDevelopSelectedPresetV3({ schemaVersion: 3, id: 'repairs', name: 'Repairs', settings });
	const row = normalizePhotoDevelopPresetRowCurrentV1({ schemaVersion: 3, kind: 'photo-develop-presets', catalogId: old.photo.catalogId, revision: 29,
		presets: [preset, ...previous.row.presets] }, old.photo.catalogId);
	return { ...previous, record: { photo, original: old.original }, current, row };
}
async function collect(source: AsyncIterable<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
	const parts: Uint8Array<ArrayBuffer>[] = []; for await (const value of source) parts.push(new Uint8Array(value));
	const result = new Uint8Array(parts.reduce((size, value) => size + value.byteLength, 0)); let offset = 0;
	for (const value of parts) { result.set(value, offset); offset += value.byteLength; } return result;
}
async function* chunks(bytes: Uint8Array, span = 7) { for (let offset = 0; offset < bytes.length; offset += span) yield bytes.subarray(offset, offset + span); }
function literalPack(photo: unknown, magic = 'LSCPACK4', original = new Uint8Array([1, 2, 3]), json = JSON.stringify(photo)) {
	const metadata = new TextEncoder().encode(json), bytes = new Uint8Array(20 + metadata.byteLength + original.byteLength);
	bytes.set(new TextEncoder().encode(magic)); const header = new DataView(bytes.buffer, 8, 12);
	header.setUint32(0, metadata.byteLength, true); header.setBigUint64(4, BigInt(original.byteLength), true);
	bytes.set(metadata, 20); bytes.set(original, 20 + metadata.byteLength); return bytes;
}

test('Pack4 preserves full Photo3 active legacy, inactive repairs, redo and snapshots with independently framed Original bytes', async () => {
	const f = fixture(), literal = literalPack(f.record.photo), delivered: unknown[] = [];
	assert.equal(f.record.photo.versions[0]!.develop.processVersion, 1);
	assert.equal(measure(f.record.photo), 12 + new TextEncoder().encode(serializePhotoDocumentCurrentV1(f.record.photo)).byteLength + 3);
	assert.deepEqual(await collect(encode([f.record])), literalPack(f.record.photo, 'LSCPACK4', new Uint8Array([1, 2, 3]), serializePhotoDocumentCurrentV1(f.record.photo)));
	for (const span of [1, 7, 65_536]) {
		delivered.length = 0; assert.equal(await read(chunks(literal, span), async (photo, original) => { delivered.push({ photo, bytes: await collect(original) }); }), 1);
		assert.deepEqual(delivered, [{ photo: f.record.photo, bytes: new Uint8Array([1, 2, 3]) }]);
	}
});

test('PresetPack3 retains mixed exact Row3, selected-only brush refs, ordered repairs and explicit empty sticky3', async () => {
	const f = fixture(), bytes = new TextEncoder().encode(JSON.stringify(f.row));
	assert.deepEqual(await collect(encodeRow(f.row)), bytes); assert.deepEqual(await readRow(chunks(bytes, 1)), f.row);
	const empty = normalizePhotoDevelopPresetRowCurrentV1({ ...f.row, presets: [] }, 'catalog-1');
	assert.deepEqual(await readRow(chunks(await collect(encodeRow(empty)))), empty); assert.equal(empty.schemaVersion, 3);
	const selected = f.row.presets.find(preset => preset.schemaVersion === 3)!;
	assert.equal(selected.schemaVersion, 3); if (selected.schemaVersion !== 3) assert.fail('Expected Preset3.');
	assert.deepEqual(selected.settings.develop, f.current); assert.equal(selected.identity.authoredStateSha256,
		createHash('sha256').update(JSON.stringify(selected.settings)).digest('hex'));
});

test('new codecs still enforce Original digest, complete drain, duplicate IDs and caller-tightened capacity', async () => {
	const f = fixture(), valid = literalPack(f.record.photo); await read(chunks(valid), async (_photo, original) => { await collect(original); });
	const bad = new Uint8Array(valid); bad[bad.length - 1]! ^= 1;
	await assert.rejects(read(chunks(bad), async (_photo, original) => { await collect(original); }), /digest/u);
	await assert.rejects(read(chunks(valid), async () => undefined), /consume/u);
	await assert.rejects(collect(encode([f.record, f.record])), /duplicate/u);
	await assert.rejects(collect(encode([f.record], { maximumPackBytes: valid.length - 1 })), /byte limit/u);
	for (const options of [{ maximumRecords: 4097 }, { maximumPackBytes: 536_870_913 }, { maximumChunkBytes: 4_194_305 }]) await assert.rejects(collect(encode([f.record], options)));
});

test('successor admission rejects smuggled process3, invalid repairs and hostile own-data metadata before Original authority', async () => {
	const f = fixture(); let reads = 0;
	const original = new Proxy({}, { get() { reads++; throw new Error('Original read'); }, getPrototypeOf() { reads++; throw new Error('Original prototype'); } });
	const badRepairs = { ...f.current, repairs: { schemaVersion: 1, spots: [{ ...repair('bad', 'heal'), opacity: 2 }] } };
	for (const photo of [{ ...f.record.photo, schemaVersion: 2 }, { ...f.record.photo, schemaVersion: 4 }, { ...f.record.photo, bytes: BODY },
		{ ...f.record.photo, versions: [{ ...f.record.photo.versions[0]!, workspace: undefined, develop: badRepairs }] },
		Object.defineProperty({ ...f.record.photo }, 'versions', { enumerable: true, get() { reads++; return f.record.photo.versions; } })]) {
		assert.throws(() => measure(photo));
		await assert.rejects(collect(Reflect.apply(encode, undefined, [[{ photo, original }]]) as AsyncIterable<Uint8Array>));
	}
	assert.equal(reads, 0); assert.deepEqual(f.record.photo, fixture().record.photo);
});

test('PresetPack3 eagerly detaches valid Row3 and rejects foreign, future and digest-tampered rows', async () => {
	const f = fixture(), input = structuredClone(f.row), encoded = encodeRow(input); Reflect.set(input.presets, 'length', 0);
	assert.deepEqual(await readRow(chunks(await collect(encoded))), f.row);
	let getters = 0; const accessor = Object.defineProperty({ ...f.row }, 'presets', { enumerable: true, get() { getters++; return []; } });
	assert.throws(() => encodeRow(accessor));
	for (const value of [{ ...f.row, catalogId: 'foreign' }, { ...f.row, schemaVersion: 4 }, { ...f.row, body: BODY },
		{ ...f.row, presets: f.row.presets.map(preset => ({ ...preset, identity: { ...preset.identity, authoredStateSha256: '0'.repeat(64) } })) }]) {
		assert.throws(() => encodeRow(value)); await assert.rejects(readRow(chunks(new TextEncoder().encode(JSON.stringify(value)))));
	}
	assert.equal(getters, 0);
});

test('Archive7 binds exact Pack4/PresetPack3 and scalar resource declarations without claiming body authority', () => {
	const f = fixture(), document = { schemaFamily: 'lightscaper', schemaVersion: 7, kind: 'photo-catalog-archive', id: f.root.id, title: f.root.name, catalog: f.root,
		packs: [{ id: 'photo-pack-000001', entry: 'assets/photo-pack-000001.bin', photoCount: 1 }], stackCount: 0, stackPacks: [], savedCollectionState: null,
		savedCollectionPacks: [], developPresetPack: { id: 'develop-presets', entry: 'assets/develop-presets-v3.bin', rowSchemaVersion: 3, revision: 29, presetCount: f.row.presets.length },
		lutResources: [], maskRasters: [{ id: REFERENCE.storageKey, entry: `assets/masks/${REFERENCE.sha256}.scmask`, reference: REFERENCE }] };
	const admitted = normalizeArchive(document); assert.equal(admitted.schemaVersion, 7); assert.deepEqual(admitted, document);
	const manifest = { format: SCAPE_FORMAT, formatVersion: SCAPE_FORMAT_VERSION, project: { entry: 'project.json', schemaFamily: 'lightscaper', schemaVersion: 7, size: 1, sha256: '0'.repeat(64) },
		assets: [{ sourceId: 'photo-pack-000001', entry: document.packs[0]!.entry, kind: 'photo-catalog-pack', encoding: 'lightscaper-photo-pack-v4', size: 24, sha256: '0'.repeat(64) },
			{ sourceId: 'develop-presets', entry: 'assets/develop-presets-v3.bin', kind: 'photo-develop-preset-pack', encoding: 'lightscaper-develop-presets-json-v3', size: 2, sha256: '0'.repeat(64) },
			{ sourceId: REFERENCE.storageKey, entry: document.maskRasters[0]!.entry, kind: 'photo-mask-raster', encoding: 'lightscaper-mask-raster-v1', size: BODY.length, sha256: REFERENCE.sha256 }] };
	assertManifest(admitted, manifest);
	for (const pack of [{ ...document.developPresetPack, rowSchemaVersion: 4 }, { ...document.developPresetPack, entry: 'assets/develop-presets-v2.bin' }]) assert.throws(() => normalizeArchive({ ...document, developPresetPack: pack }));
	for (const encoding of ['lightscaper-photo-pack-v3', 'future']) assert.throws(() => assertManifest(admitted, { ...manifest, assets: manifest.assets.map((asset, index) => index === 0 ? { ...asset, encoding } : asset) }));
});

test('held Pack4 demand cancellation joins captured source retirement and retains exact opaque primary plus cleanup', async t => {
	const entered = deferred<void>(), release = deferred<void>(), retired = deferred<void>(), stop = new AbortController();
	const revoked = Proxy.revocable({}, {}), reason = revoked.proxy, cleanup = Object.freeze({ cleanup: true }); revoked.revoke(); let leaves = 0, consumers = 0;
	const source = { [Symbol.asyncIterator]() { return { async next() { entered.resolve(); await release.promise; return { done: false as const, value: literalPack(fixture().record.photo) }; },
		async return() { leaves++; await retired.promise; throw cleanup; } }; } };
	const outcome = read(source, async () => { consumers++; }, { signal: stop.signal }).then(() => ({ failed: false as const }), (error: unknown) => ({ failed: true as const, error }));
	t.after(async () => { release.resolve(); retired.resolve(); await outcome; });
	assert.equal(await Promise.race([entered.promise.then(() => true), outcome.then(() => false)]), true);
	stop.abort(reason); release.resolve(); assert.equal(await remainsPending(outcome), true); retired.resolve(); const result = await outcome;
	assert.ok(result.failed); assert.ok(result.error instanceof AggregateError); assert.equal(Object.is(result.error.errors[0], reason), true);
	assert.equal(Object.is(result.error.errors[1], cleanup), true); assert.equal(consumers, 0); assert.equal(leaves, 1);
});

test('permanent legacy pack bytes/readers keep their exact profiles and refuse explicit Photo3/Row3', async () => {
	const f = fixture(), old = photoArchiveFixture(), second = lutArchiveFixture();
	assert.deepEqual(await collect(encodePhotoCatalogPackV2([old])), literalPack(old.photo, 'LSCPACK2', new Uint8Array([1, 2, 3]), serializePhotoDocumentV1OrV2(old.photo)));
	assert.deepEqual(await collect(encodePhotoCatalogPackV3([second.record])), literalPack(second.record.photo, 'LSCPACK3', new Uint8Array([1, 2, 3]), serializePhotoDocumentV1OrV2(second.record.photo)));
	assert.deepEqual(await collect(encodePhotoDevelopPresetPackV2(second.row, 'catalog-1')), new TextEncoder().encode(JSON.stringify(second.row)));
	assert.throws(() => measurePhotoCatalogPackRecordV3(f.record.photo)); assert.throws(() => encodePhotoDevelopPresetPackV2(f.row, 'catalog-1'));
	await assert.rejects(readPhotoCatalogPackV3(chunks(literalPack(f.record.photo)), async () => undefined), /format/u);
	assert.equal(defaultImageDevelopStateV1().processVersion, 1);
});
