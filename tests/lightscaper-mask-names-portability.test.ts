/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { normalizeVideoMaskMatteGraphV1 } from '../src/common/editor/video-mask-matte-v24.ts';
import { defaultImageDevelopStateV1, normalizeImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizeImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { copyImageDevelopSettingsV1 } from '../src/common/editor/imaging/image-develop-settings-v1.ts';
import { copyImageDevelopSettingsV2, mergeImageDevelopSettingsV2 } from '../src/common/editor/imaging/image-develop-settings-v2.ts';
import { createImageDevelopPresetV2, normalizeImageDevelopPresetV2 } from '../src/common/editor/imaging/image-develop-preset-v2.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { normalizePhotoDocumentV2, parsePhotoDocumentV1OrV2, serializePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { normalizePhotoDevelopWorkspaceV2 } from '../src/lightscaper/catalog/photo-develop-workspace-v2.ts';
import { normalizePhotoDevelopPresetRowV2 } from '../src/lightscaper/storage/photo-develop-preset-row-v2.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { measurePhotoCatalogPackRecordV1 } from '../src/lightscaper/archive/catalog-pack.ts';
import { exportPhotoCatalogArchiveV5 } from '../src/lightscaper/archive/catalog-archive-export-v5.ts';
import { importPhotoCatalogArchiveV5, type PhotoCatalogArchiveStageV5 } from '../src/lightscaper/archive/catalog-archive-import-v5.ts';
import { exportPhotoCatalogArchiveV6 } from '../src/lightscaper/archive/catalog-archive-export-v6.ts';
import { importPhotoCatalogArchiveV6, type PhotoCatalogArchiveStageV6 } from '../src/lightscaper/archive/catalog-archive-import-v6.ts';
import { createPhotoLibraryDevelopSessionV2 } from '../src/lightscaper/controller/photo-library-develop-session-v2.ts';
import { withPhotoDevelopProxyFrameV2 } from '../src/lightscaper/controller/photo-develop-frame-v2.ts';
import { withFramescaperImageDevelopFrameV2 } from '../src/framescaper/timeline-image-develop-frame-v2.ts';
import { normalizeFramescaperImageSourceV2 } from '../src/common/editor/timeline-image-model-v2.ts';
import { createPhotoFramescaperHandoffPhotoV1 } from '../src/lightscaper/controller/photo-framescaper-handoff-photo-v1.ts';
import { assertPhotoDevelopHandoffMasksV1 } from '../src/lightscaper/controller/photo-develop-handoff-masks-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import type { BrushMaskResourceReferenceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import { currentDevelopFixture, CURRENT_TIME } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { frameImageFixture, rgbaFrame } from './helpers/lightscaper-masked-frame-fixture.ts';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const ALL = { effectTypes: 'all' as const, geometry: true, localAdjustments: true };
const tone = () => createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: -1 } });
const legacyGraph = () => ({ schemaVersion: 1, id: 'mask', kind: 'matte', inputs: [],
	nodes: [{ id: 'output', kind: 'vector-shape', shape: 'rectangle', x: 0.5, y: 0, width: 0.5, height: 1 }], outputNodeId: 'output' });
const namedGraph = (name = 'Bright foreground') => ({ ...legacyGraph(), schemaVersion: 2, name });
const recipe = (graph: unknown = namedGraph()) => normalizeImageDevelopStateV2({ ...defaultImageDevelopStateV1(), processVersion: 2,
	effects: [tone()], masks: [graph], maskBindings: [{ effectId: 'tone', maskId: 'mask' }] });
function label(graph: unknown): unknown { return Object.getOwnPropertyDescriptor(graph, 'name')?.value as unknown; }
function root() { return normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
	id: 'catalog-1', name: 'Named mask library', revision: 1, photoCount: 1, folders: [], keywords: [], collections: [] }); }
function retainedPhoto(develops: readonly unknown[]) {
	const base = photoArchiveFixture(), master = base.photo.versions[0]!;
	const workspace = normalizePhotoDevelopWorkspaceV2({ schemaVersion: 2, kind: 'photo-develop-workspace', cursor: 1,
		entries: develops.slice(0, 3).map((develop, index) => ({ label: `Step ${index}`, createdAt: CURRENT_TIME, develop })),
		snapshots: [{ id: 'saved', name: 'Saved state', createdAt: CURRENT_TIME, develop: develops[3] }] });
	return { original: base.original, photo: normalizePhotoDocumentV2({ ...base.photo, schemaVersion: 2, versions: [
		{ ...master, develop: develops[1], workspace }, { ...master, id: 'inactive', kind: 'virtual-copy', name: 'Inactive', develop: develops[4] },
	] }) };
}
function target() {
	const photos: unknown[] = [], originals: number[][] = [], rows: unknown[] = [], masks: { reference: Readonly<BrushMaskResourceReferenceV1>; bytes: Uint8Array }[] = [];
	const events: string[] = [];
	const stage: PhotoCatalogArchiveStageV6 = {
		async writePhoto(photo, original) { photos.push(photo); const bytes: number[] = []; for await (const part of original) bytes.push(...part); originals.push(bytes); },
		async writeStack() {}, async writeSavedCollection() {}, async writeDevelopPresets(row) { rows.push(row); },
		async writeLut() { assert.fail('No LUT belongs to the named-mask fixture.'); },
		async writeMaskRaster(reference, bytes) { masks.push({ reference, bytes: new Uint8Array(bytes) }); },
		async publish() { events.push('publish'); }, async rollback() { events.push('rollback'); },
	};
	return { stage, photos, originals, rows, masks, events };
}
function brush(alpha: number) {
	// Independent SCMASK01 header, little-endian dimensions and exact alpha plane.
	const bytes = Uint8Array.of(83, 67, 77, 65, 83, 75, 48, 49, 2, 0, 0, 0, 1, 0, 0, 0, alpha, 255 - alpha), digest = sha(bytes);
	const reference: Readonly<BrushMaskResourceReferenceV1> = Object.freeze({ storageKey: `brush-mask-v1:2:1:${digest}`,
		sha256: digest, width: 2, height: 1, byteLength: 18 });
	return { reference, bytes };
}
function failureLeaves(value: unknown, seen = new Set<AggregateError>()): unknown[] {
	if (!(value instanceof AggregateError)) return [value];
	if (seen.has(value)) return []; seen.add(value);
	const errors: unknown = Object.getOwnPropertyDescriptor(value, 'errors')?.value;
	assert.ok(Array.isArray(errors));
	return (errors as unknown[]).flatMap(error => failureLeaves(error, seen));
}

test('actual catalog Save retains mask names through snapshot, virtual copy, clear, reopen and history without changing originals', async () => {
	const f = await currentDevelopFixture(1);
	const apply = (expectedRevision: number, command: Parameters<typeof f.develop.apply>[0]['command']) =>
		f.develop.apply({ schemaVersion: 2, photoId: 'photo-1', expectedRevision, command });
	try {
		const named = recipe();
		let ack = await apply(0, { type: 'record-develop', versionId: 'version-1', develop: named, label: 'Name mask', createdAt: CURRENT_TIME });
		assert.equal(ack.snapshot.develop.processVersion, 2); assert.equal(label(ack.snapshot.develop.masks[0]), 'Bright foreground');
		ack = await apply(ack.snapshot.revision, { type: 'save-develop-snapshot', versionId: 'version-1', id: 'named', name: 'Named', createdAt: CURRENT_TIME });
		ack = await apply(ack.snapshot.revision, { type: 'create-virtual-copy', id: 'copy', name: 'Copy', sourceVersionId: 'version-1', createdAt: CURRENT_TIME });
		assert.equal(label(ack.snapshot.develop.masks[0]), 'Bright foreground');
		const cleared = recipe(legacyGraph());
		ack = await apply(ack.snapshot.revision, { type: 'record-develop', versionId: 'version-1', develop: cleared, label: 'Clear name', createdAt: CURRENT_TIME });
		assert.equal(ack.snapshot.develop.processVersion, 2); assert.deepEqual(ack.snapshot.develop.masks, [normalizeVideoMaskMatteGraphV1(legacyGraph())]);
		const saved = await f.repository.loadPhoto('catalog-1', 'photo-1'); assert.ok(saved);
		assert.equal(saved.schemaVersion, 2); assert.deepEqual(saved.original, f.photos[0]!.original);
		assert.deepEqual(parsePhotoDocumentV1OrV2(serializePhotoDocumentV1OrV2(saved)), saved);
		assert.deepEqual(await createPhotoLibraryDevelopSessionV2(f.host).read({ schemaVersion: 2, photoId: 'photo-1', versionId: 'version-1' }), ack.snapshot);
		ack = await apply(ack.snapshot.revision, { type: 'select-develop-history', versionId: 'version-1', cursor: 1 });
		assert.deepEqual(ack.snapshot.develop, named);
		ack = await apply(ack.snapshot.revision, { type: 'restore-develop-snapshot', versionId: 'version-1', snapshotId: 'named', label: 'Restore name', createdAt: CURRENT_TIME });
		assert.deepEqual(ack.snapshot.develop, named); assert.deepEqual((await f.repository.loadPhoto('catalog-1', 'photo-1'))?.original, f.photos[0]!.original);
	} finally { await f.close(); }
});

test('settings and preset2 retain exact names during ID remapping and promote a numeric target only for the explicit named recipe', () => {
	const donor = recipe(), packet = copyImageDevelopSettingsV2({ schemaVersion: 2, develop: donor, selection: ALL });
	assert.deepEqual(packet.develop, donor);
	const preset = createImageDevelopPresetV2({ schemaVersion: 2, id: 'named', name: 'Named preset', settings: packet });
	assert.equal(preset.identity.authoredStateSha256, sha(new TextEncoder().encode(JSON.stringify(packet))));
	assert.deepEqual(normalizeImageDevelopPresetV2(JSON.parse(JSON.stringify(preset)) as unknown), preset);
	const renamed = createImageDevelopPresetV2({ schemaVersion: 2, id: 'named', name: 'Named preset', settings: copyImageDevelopSettingsV2({
		schemaVersion: 2, develop: recipe(namedGraph('Other foreground')), selection: ALL }) });
	assert.notEqual(renamed.identity.authoredStateSha256, preset.identity.authoredStateSha256);
	const promoted = mergeImageDevelopSettingsV2({ schemaVersion: 2, target: defaultImageDevelopStateV1(), settings: packet });
	assert.equal(promoted.processVersion, 2); assert.deepEqual(promoted.masks, donor.masks);
	const targetRecipe = normalizeImageDevelopStateV2({ ...donor, effects: [createVideoEffect('white-balance-v1', { id: 'tone' })],
		masks: [legacyGraph()], maskBindings: [{ effectId: 'tone', maskId: 'mask' }] });
	const partial = copyImageDevelopSettingsV2({ schemaVersion: 2, develop: donor,
		selection: { effectTypes: ['tone-ladder-v1'], geometry: false, localAdjustments: true } });
	const merged = mergeImageDevelopSettingsV2({ schemaVersion: 2, target: targetRecipe, settings: partial });
	assert.deepEqual(merged.effects.map(effect => effect.id), ['tone', 'copied-effect-1']);
	assert.deepEqual(merged.maskBindings, [{ effectId: 'copied-effect-1', maskId: 'copied-mask-1' }, { effectId: 'tone', maskId: 'mask' }]);
	assert.deepEqual(merged.masks.find(graph => graph.id === 'mask'), targetRecipe.masks[0]);
	assert.deepEqual(merged.masks.find(graph => graph.id === 'copied-mask-1'), { ...donor.masks[0], id: 'copied-mask-1' });
	assert.equal(label(merged.masks.find(graph => graph.id === 'copied-mask-1')), 'Bright foreground');
	assert.deepEqual(targetRecipe.masks, [normalizeVideoMaskMatteGraphV1(legacyGraph())]);
});

test('Archive5 carries names-only Photo2/history/redo/snapshots and preset2 without a brush source or format upgrade', async () => {
	const record = retainedPhoto(['History', 'Current', 'Redo', 'Snapshot', 'Inactive'].map(name => recipe(namedGraph(name))));
	const preset = createImageDevelopPresetV2({ schemaVersion: 2, id: 'preset', name: 'Named', settings: copyImageDevelopSettingsV2({ schemaVersion: 2, develop: recipe(), selection: ALL }) });
	const row = normalizePhotoDevelopPresetRowV2({ schemaVersion: 2, kind: 'photo-develop-presets', catalogId: 'catalog-1', revision: 1, presets: [preset] }, 'catalog-1');
	const result = await exportPhotoCatalogArchiveV5(root(), [record], [], null, [], row, undefined); assert.ok(result.blob);
	assert.equal(result.document.schemaVersion, 5); assert.deepEqual(result.document.lutResources, []);
	assert.equal(result.manifest.assets.some(asset => asset.kind === 'photo-mask-raster'), false);
	assert.ok(result.manifest.assets.some(asset => asset.encoding === 'lightscaper-photo-pack-v2'));
	const imported = target(); const stage: PhotoCatalogArchiveStageV5 = imported.stage;
	await importPhotoCatalogArchiveV5(result.blob, async () => stage);
	assert.deepEqual(imported.photos, [record.photo]); assert.deepEqual(imported.originals, [[1, 2, 3]]);
	assert.deepEqual(imported.rows, [row]); assert.deepEqual(imported.masks, []); assert.deepEqual(imported.events, ['publish']);
});

test('named brushes retain the complete Archive6 inactive/history/redo/snapshot body closure and exact independent bytes', async () => {
	const bodies = [0, 32, 64, 128, 200].map(brush);
	const develops = bodies.map((body, index) => recipe({ ...namedGraph(`Brush ${index}`), inputs: [{ name: 'Paint', kind: 'alpha', sourceRef: body.reference.storageKey }],
		nodes: [{ id: 'output', kind: 'alpha', inputName: 'Paint' }] }));
	const record = retainedPhoto(develops), reads: string[] = [];
	const source: MaskRasterSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, source); reads.push(reference.storageKey); const body = bodies.find(body => body.reference.storageKey === reference.storageKey); assert.ok(body);
		assert.deepEqual(reference, body.reference); return await consume(new Uint8Array(body.bytes));
	} };
	const result = await exportPhotoCatalogArchiveV6(root(), [record], [], null, [], null, undefined, source); assert.ok(result.blob);
	const expected = bodies.map(body => body.reference).sort((a, b) => a.storageKey.localeCompare(b.storageKey));
	assert.deepEqual(result.document.maskRasters.map(row => row.reference), expected);
	for (const reference of expected) assert.equal(reads.filter(key => key === reference.storageKey).length, 2);
	const imported = target(); await importPhotoCatalogArchiveV6(result.blob, async () => imported.stage);
	assert.deepEqual(imported.photos, [record.photo]); assert.deepEqual(imported.originals, [[1, 2, 3]]);
	assert.deepEqual(imported.masks, expected.map(reference => ({ reference, bytes: bodies.find(body => body.reference.storageKey === reference.storageKey)!.bytes })));
	assert.deepEqual(imported.events, ['publish']);
	let originalTraps = 0;
	const original = new Proxy(record.original, { get() { originalTraps++; throw Error('A rejected brush acquired its original.'); } });
	await assert.rejects(exportPhotoCatalogArchiveV5(root(), [{ photo: record.photo, original }], [], null, [], null, undefined), (error: unknown) => {
		// ZIP retirement may repeat its failed primary through a cleanup envelope.
		const refused = failureLeaves(error).filter(reason => reason instanceof TypeError && /brush|portable|transport/iu.test(reason.message));
		assert.equal(new Set(refused).size, 1); return true;
	});
	assert.equal(originalTraps, 0);
	assert.throws(() => copyImageDevelopSettingsV2({ schemaVersion: 2, develop: develops[0], selection: ALL }), /external|authenticated/iu);
	assert.throws(() => assertPhotoDevelopHandoffMasksV1(develops[0]!, 2, 1), /brush|portable|transport/iu);
});

test('named Source2 recipe hashes and actual packed Frame pixels survive a fresh Photo receive with exact original custody', async () => {
	const develop = recipe(), pixels = Array.from({ length: 4 }, () => [255, 255, 255, 255]).flat();
	const f = frameImageFixture(develop, pixels), packed = [...f.pack.bytes], original = [...f.original];
	const source = normalizeFramescaperImageSourceV2(f.request.source);
	assert.equal(source.provenance.developSha256, sha(new TextEncoder().encode(JSON.stringify(develop))));
	const other = frameImageFixture(recipe(namedGraph('A different name')), pixels);
	assert.notEqual(other.request.source.provenance.developSha256, source.provenance.developSha256);
	assert.equal(other.request.source.contentSha256, source.contentSha256);
	const expected = [255, 255, 188, 188].flatMap(value => [value, value, value, 255]);
	assert.deepEqual(await withPhotoDevelopProxyFrameV2({ frame: rgbaFrame(pixels), develop }, view => [...view.frame.pixels]), expected);
	assert.deepEqual(await withFramescaperImageDevelopFrameV2(f.request, view => [...view.frame.pixels]), expected);
	const received = createPhotoFramescaperHandoffPhotoV1({ source, catalog: { ...root(), id: 'received-catalog', photoCount: 0 },
		ownership: { photoId: 'received-photo', originalId: 'received-original', storageKey: 'received-body', masterVersionId: 'received-master' },
		createdAt: CURRENT_TIME, metadata: photoArchiveFixture().photo.metadata, extractedMetadata: null });
	assert.deepEqual(received.versions[0]!.develop, develop); assert.equal(received.original.contentSha256, source.original.sha256);
	assert.deepEqual([...f.pack.bytes], packed); assert.deepEqual([...f.original], original);
	assert.throws(() => normalizeFramescaperImageSourceV2({ ...source, develop: other.request.source.develop }), /provenance|binding/iu);
});

test('legacy Graph1/Develop1/settings1/Photo1/pack1 refuse named successors before original or pixel authority', async () => {
	const graph = namedGraph(), named = { ...defaultImageDevelopStateV1(), masks: [graph] };
	assert.throws(() => normalizeVideoMaskMatteGraphV1(graph));
	assert.throws(() => normalizeVideoMaskMatteGraphV1({ ...legacyGraph(), name: 'Smuggled' }));
	assert.throws(() => normalizeImageDevelopStateV1(named));
	assert.throws(() => copyImageDevelopSettingsV1({ schemaVersion: 1, develop: named, selection: ALL }));
	const base = photoArchiveFixture(), raw = { ...base.photo, versions: [{ ...base.photo.versions[0], develop: named }] };
	assert.throws(() => normalizePhotoDocumentV1(raw)); assert.throws(() => measurePhotoCatalogPackRecordV1(raw));
	let traps = 0, delivered = 0; const unread = new Proxy({}, { ownKeys() { traps++; throw Error('Future graph inspected pixels'); } });
	await assert.rejects(withPhotoDevelopProxyFrameV2({ frame: unread, develop: { ...named, processVersion: 2, masks: [{ ...graph, schemaVersion: 3 }] } }, () => { delivered++; }));
	assert.equal(traps, 0); assert.equal(delivered, 0);
});
