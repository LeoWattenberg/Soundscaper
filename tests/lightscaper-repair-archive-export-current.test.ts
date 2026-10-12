/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { copyImageDevelopSelectedSettingsV3 } from '../src/common/editor/imaging/image-develop-settings-selected-v3.ts';
import { createImageDevelopSelectedPresetV3 } from '../src/common/editor/imaging/image-develop-preset-selected-v3.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import type { BrushMaskResourceReferenceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { normalizePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { normalizePhotoDevelopWorkspaceV3 } from '../src/lightscaper/catalog/photo-develop-workspace-v3.ts';
import { normalizePhotoDevelopPresetRowCurrentV1, type PhotoDevelopPresetRowCurrentV1 } from '../src/lightscaper/storage/photo-develop-preset-row-current-v1.ts';
import { exportPhotoCatalogArchiveV6 } from '../src/lightscaper/archive/catalog-archive-export-v6.ts';
import { importPhotoCatalogArchiveV6 } from '../src/lightscaper/archive/catalog-archive-import-v6.ts';
import { exportPhotoCatalogArchiveV7 } from '../src/lightscaper/archive/catalog-archive-export-v7.ts';
import { importPhotoCatalogArchiveV7 } from '../src/lightscaper/archive/catalog-archive-import-v7.ts';
import { exportPhotoCatalogArchiveV5 } from '../src/lightscaper/archive/catalog-archive-export-v5.ts';
import { LUT_BODY, LUT_REFERENCE, lutArchiveFixture, rewriteLutArchiveFixture } from './helpers/lightscaper-lut-archive-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

// Root observed the same oracles against actual strict6 frontdoors. Current
// subjects preserve the permanent old-profile controls below.
const exportArchive = (...args: readonly unknown[]): ReturnType<typeof exportPhotoCatalogArchiveV7> => Reflect.apply(exportPhotoCatalogArchiveV7, undefined, args) as ReturnType<typeof exportPhotoCatalogArchiveV7>;
type Stage = Readonly<{ writePhoto(photo: PhotoDocumentCurrentV1, original: AsyncIterable<Uint8Array>): Promise<void>;
	writeStack(): Promise<void>; writeSavedCollection(): Promise<void>; writeDevelopPresets(row: PhotoDevelopPresetRowCurrentV1): Promise<void>;
	writeLut(reference: unknown, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
	writeMaskRaster(reference: Readonly<BrushMaskResourceReferenceV1>, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
	publish(): Promise<void>; rollback(): Promise<void> }>;
type Factory = (root: unknown, state: unknown, header: unknown, luts: unknown, masks: unknown) => Promise<Stage>;
const importArchive = (input: Blob, factory: Factory, options: Parameters<typeof importPhotoCatalogArchiveV7>[2] = {}): Promise<unknown> => Reflect.apply(importPhotoCatalogArchiveV7, undefined, [input, factory, options]) as Promise<unknown>;
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function resource(alpha: number, width = 2, height = 1) {
	const body = new Uint8Array([83, 67, 77, 65, 83, 75, 48, 49, width, 0, 0, 0, height, 0, 0, 0, alpha, 255 - alpha]), digest = sha(body);
	const reference: Readonly<BrushMaskResourceReferenceV1> = Object.freeze({ storageKey: `brush-mask-v1:${width}:${height}:${digest}`,
		sha256: digest, width, height, byteLength: body.length }); return { body, reference };
}
function fixture() {
	const previous = lutArchiveFixture(), old = photoArchiveFixture(), version = old.photo.versions[0]!;
	const resources = [resource(0), resource(32, 1, 2), resource(64), resource(96, 1, 2), resource(128), resource(160, 1, 2)];
	const develop = (index: number) => replaceImageDevelopRepairSpotsV1({ ...defaultImageDevelopStateV1(), processVersion: 2,
		masks: [{ schemaVersion: 2, id: `brush-${index}`, name: `Retained ${index}`, kind: 'matte',
			inputs: [{ name: 'body', kind: 'raster', sourceRef: resources[index]!.reference.storageKey }],
			nodes: [{ id: 'out', kind: 'raster', inputName: 'body', channel: 'alpha' }], outputNodeId: 'out' }], maskBindings: [] },
	{ schemaVersion: 1, spots: [{ id: `repair-${index}`, mode: index % 2 ? 'heal' : 'clone', enabled: false,
		target: { x: 0.7, y: 0.5 }, source: { x: 0.2, y: 0.5 }, radius: 0.15, feather: 0.5, opacity: 0.75 }] });
	const workspace = normalizePhotoDevelopWorkspaceV3({ schemaVersion: 3, kind: 'photo-develop-workspace', cursor: 1,
		entries: [{ label: 'Past repair', createdAt: null, develop: develop(1) }, { label: 'Selected legacy', createdAt: null, develop: version.develop },
			{ label: 'Redo repair', createdAt: null, develop: develop(2) }], snapshots: [{ id: 'snapshot', name: 'Snapshot', createdAt: version.createdAt, develop: develop(3) }] });
	const photo = normalizePhotoDocumentCurrentV1({ ...old.photo, schemaVersion: 3, versions: [{ ...version, workspace },
		{ ...version, id: 'inactive', kind: 'virtual-copy', name: 'Inactive', develop: develop(0) }] });
	const painted = develop(4), presetDevelop = { ...painted, effects: previous.record.photo.versions[0]!.develop.effects,
		masks: painted.masks.map(mask => ({ ...mask, inputs: [...mask.inputs, { name: 'unused', kind: 'alpha', sourceRef: resources[5]!.reference.storageKey }] })) };
	const settings = copyImageDevelopSelectedSettingsV3({ schemaVersion: 3, develop: presetDevelop,
		selection: { effectTypes: 'all', geometry: true, localAdjustments: true, repairs: true } });
	const preset = createImageDevelopSelectedPresetV3({ schemaVersion: 3, id: 'preset-only-paint', name: 'Preset-only resources', settings });
	const row = normalizePhotoDevelopPresetRowCurrentV1({ schemaVersion: 3, kind: 'photo-develop-presets', catalogId: photo.catalogId, revision: 31,
		presets: [preset, ...previous.row.presets] }, photo.catalogId);
	return { ...previous, record: { photo, original: old.original }, row, resources };
}
const lutSource = { async withBytes<Result>(_reference: unknown, consume: (bytes: Uint8Array<ArrayBuffer>) => Promise<Result>) { return await consume(new Uint8Array(LUT_BODY)); } };
function maskSource(f: ReturnType<typeof fixture>, events: string[] = []): MaskRasterSourcePortV1 {
	return { async withBytes(reference, consume) { events.push(`body:${reference.storageKey}`);
		const row = f.resources.find(row => row.reference.storageKey === reference.storageKey); assert.ok(row); assert.deepEqual(reference, row.reference);
		return await consume(new Uint8Array(row.body)); } };
}
function target() {
	const photos: unknown[] = [], rows: unknown[] = [], masks: unknown[] = [], luts: Uint8Array[] = [], backings: Uint8Array[] = [], events: string[] = [];
	const stage: Stage = { async writePhoto(photo, original) { const bytes: number[] = []; for await (const part of original) for (const value of part) bytes.push(value);
		photos.push({ photo, bytes }); events.push('photo'); }, async writeStack() {}, async writeSavedCollection() {},
		async writeDevelopPresets(row) { rows.push(row); events.push('presets'); }, async writeLut(reference, bytes) {
			assert.deepEqual(reference, LUT_REFERENCE); luts.push(new Uint8Array(bytes)); events.push('lut'); },
		async writeMaskRaster(reference, bytes) { masks.push({ reference, bytes: new Uint8Array(bytes) }); backings.push(bytes); events.push('mask'); },
		async publish() { events.push('publish'); }, async rollback() { events.push('rollback'); } };
	return { stage, photos, rows, masks, luts, backings, events };
}
async function archive(f = fixture(), source = maskSource(f)) {
	const result = await exportArchive(f.root, [f.record], [], null, [], f.row, lutSource, source); assert.ok(result.blob); return { f, result, blob: result.blob };
}
function leaves(value: unknown, opaque: readonly unknown[], seen = new Set<AggregateError>()): unknown[] {
	if (opaque.some(reason => Object.is(reason, value))) return [value];
	if (!(value instanceof AggregateError)) return [value]; if (seen.has(value)) return []; seen.add(value);
	const descriptor = Object.getOwnPropertyDescriptor(value, 'errors'); assert.ok(descriptor && Object.hasOwn(descriptor, 'value') && Array.isArray(descriptor.value));
	return (descriptor.value as unknown[]).flatMap(reason => leaves(reason, opaque, seen));
}

test('Archive7 carries every retained Photo3 recipe plus preset-only LUT and unused brush bodies, exact originals and Row3', async () => {
	const f = fixture(), events: string[] = [], result = await exportArchive(f.root, [f.record], [], null, [], f.row, lutSource, maskSource(f, events),
		{ async verifySource() { events.push('verify'); } }); assert.ok(result.blob); assert.equal(result.document.schemaVersion, 7);
	assert.equal(result.document.developPresetPack?.rowSchemaVersion, 3); assert.equal(result.document.developPresetPack?.entry, 'assets/develop-presets-v3.bin');
	const expected = f.resources.map(row => row.reference).sort((a, b) => a.storageKey < b.storageKey ? -1 : a.storageKey > b.storageKey ? 1 : 0);
	assert.deepEqual(result.document.lutResources.map(row => row.reference), [LUT_REFERENCE]); assert.deepEqual(result.document.maskRasters.map(row => row.reference), expected);
	assert.ok(result.manifest.assets.some(row => row.encoding === 'lightscaper-photo-pack-v4'));
	assert.ok(result.manifest.assets.some(row => row.encoding === 'lightscaper-develop-presets-json-v3'));
	assert.equal(events.at(-1), 'verify'); for (const reference of expected) assert.equal(events.filter(event => event === `body:${reference.storageKey}`).length, 2);
	const destination = target(); await importArchive(result.blob, async (root, state, header, luts, masks) => {
		assert.deepEqual(root, f.root); assert.equal(state, null); assert.deepEqual(header, result.document.developPresetPack);
		assert.deepEqual(luts, result.document.lutResources); assert.deepEqual(masks, result.document.maskRasters); return destination.stage;
	});
	assert.deepEqual(destination.photos, [{ photo: f.record.photo, bytes: [1, 2, 3] }]); assert.deepEqual(destination.rows, [f.row]); assert.deepEqual(destination.luts, [LUT_BODY]);
	assert.deepEqual(destination.masks, expected.map(reference => ({ reference, bytes: f.resources.find(row => row.reference.storageKey === reference.storageKey)!.body })));
	assert.ok(destination.backings.every(bytes => bytes.every(value => value === 0))); assert.equal(destination.events.at(-1), 'publish'); assert.equal(destination.events.includes('rollback'), false);
});

test('explicit7 retains absent presets and empty sticky Row3, while its importer accepts canonical legacy5/6 without promotion', async () => {
	const f = fixture(), old = lutArchiveFixture(), empty = normalizePhotoDevelopPresetRowCurrentV1({ ...f.row, presets: [] }, 'catalog-1');
	for (const row of [null, empty]) { const result = await exportArchive(f.root, [f.record], [], null, [], row, lutSource, maskSource(f)); assert.ok(result.blob);
		assert.equal(result.document.schemaVersion, 7); assert.equal(result.document.developPresetPack === null, row === null);
		const destination = target(); await importArchive(result.blob, async () => destination.stage); assert.deepEqual(destination.rows, row === null ? [] : [empty]); }
	const old5 = await exportPhotoCatalogArchiveV5(old.root, [old.record], [], null, [], old.row, lutSource);
	const old6 = await exportPhotoCatalogArchiveV6(old.root, [old.record], [], null, [], null, lutSource, undefined);
	for (const result of [old5, old6]) { assert.ok(result.blob); const destination = target(); await importArchive(result.blob, async () => destination.stage);
		assert.deepEqual(destination.photos, [{ photo: old.record.photo, bytes: [1, 2, 3] }]); assert.equal(destination.events.at(-1), 'publish'); }
});

test('reserved future and foreign mask input namespaces in retained Photos and preset-only unused inputs refuse before body or Original authority', async () => {
	const f = fixture(); let originalReads = 0, bodies = 0;
	const original = new Proxy({}, { get() { originalReads++; throw new Error('Original read'); }, getPrototypeOf() { originalReads++; throw new Error('Original prototype'); } });
	const source: MaskRasterSourcePortV1 = { async withBytes() { bodies++; throw new Error('Body'); } };
	for (const sourceRef of ['brush-mask-v2:2:1:' + 'a'.repeat(64), 'external-image']) {
		const inactive = f.record.photo.versions[1]!, draft = { ...inactive.develop, masks: inactive.develop.masks.map(mask => ({ ...mask,
			inputs: [...mask.inputs, { name: 'unused-foreign', kind: 'alpha', sourceRef }] })) };
		const photo = normalizePhotoDocumentCurrentV1({ ...f.record.photo, versions: [f.record.photo.versions[0]!, { ...inactive, develop: draft }] });
		await assert.rejects(exportArchive(f.root, [{ photo, original }], [], null, [], null, undefined, source));
		const settings = copyImageDevelopSelectedSettingsV3({ schemaVersion: 3, develop: draft, selection: { effectTypes: 'all', geometry: true, localAdjustments: true, repairs: true } });
		const preset = createImageDevelopSelectedPresetV3({ schemaVersion: 3, id: 'foreign', name: 'Foreign unused', settings });
		const row = normalizePhotoDevelopPresetRowCurrentV1({ ...f.row, presets: [preset] }, 'catalog-1');
		await assert.rejects(exportArchive(f.root, [{ photo: photoArchiveFixture().photo, original }], [], null, [], row, undefined, source));
	}
	assert.equal(originalReads, 0); assert.equal(bodies, 0);
});

test('honestly rehashed Archive7 missing, extra and corrupt preset-only assets, wrong profiles and row headers never publish', async () => {
	const { f, result, blob } = await archive();
	for (const mode of ['missing', 'extra', 'body', 'encoding', 'header'] as const) {
		const rewritten = await rewriteLutArchiveFixture(blob, files => {
			const document = { ...structuredClone(result.document), maskRasters: [...result.document.maskRasters] }, manifest = structuredClone(result.manifest);
			const presetOnly = document.maskRasters.find(row => row.id === f.resources[5]!.reference.storageKey)!;
			if (mode === 'missing') { document.maskRasters = document.maskRasters.filter(row => row.id !== presetOnly.id); files.delete(presetOnly.entry); manifest.assets = manifest.assets.filter(asset => asset.sourceId !== presetOnly.id); }
			if (mode === 'extra') { const extra = resource(200), entry = `assets/masks/${extra.reference.sha256}.scmask`;
				document.maskRasters.push({ id: extra.reference.storageKey, entry, reference: extra.reference }); files.set(entry, extra.body);
				manifest.assets.push({ sourceId: extra.reference.storageKey, entry, kind: 'photo-mask-raster', encoding: 'lightscaper-mask-raster-v1', size: extra.body.length, sha256: sha(extra.body) }); }
			if (mode === 'body') { const bytes = new Uint8Array(files.get(presetOnly.entry)!); bytes[16]! ^= 1; files.set(presetOnly.entry, bytes);
				manifest.assets = manifest.assets.map(asset => asset.sourceId === presetOnly.id ? { ...asset, sha256: sha(bytes), size: bytes.length } : asset); }
			if (mode === 'encoding') manifest.assets = manifest.assets.map(asset => asset.kind === 'photo-catalog-pack' ? { ...asset, encoding: 'lightscaper-photo-pack-v3' } : asset);
			if (mode === 'header') document.developPresetPack = { ...document.developPresetPack!, revision: 32 };
			const project = new TextEncoder().encode(JSON.stringify(document)); files.set('project.json', project);
			manifest.project = { ...manifest.project, size: project.length, sha256: sha(project) }; files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
		});
		const destination = target(); await assert.rejects(importArchive(rewritten, async () => destination.stage));
		assert.equal(destination.events.includes('publish'), false); if (destination.events.length) assert.equal(destination.events.at(-1), 'rollback');
	}
});

test('held authenticated preset-only body joins before one-shot final source verification and native destination Close', async t => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>(), events: string[] = []; let held = false;
	const source: MaskRasterSourcePortV1 = { async withBytes(reference, consume) { const row = f.resources.find(row => row.reference.storageKey === reference.storageKey)!;
		const work = Promise.resolve(consume(new Uint8Array(row.body))); void work.catch(() => undefined);
		if (!held && reference.storageKey === f.resources[5]!.reference.storageKey) { held = true; entered.resolve(); await release.promise; } return await work; } };
	const work = exportArchive(f.root, [f.record], [], null, [], f.row, lutSource, source,
		{ writable: new WritableStream<Uint8Array>({ write() {}, close() { events.push('close'); } }), async verifySource() { events.push('verify'); } });
	const outcome = work.then(() => ({ failed: false as const }), (error: unknown) => ({ failed: true as const, error }));
	t.after(async () => { release.resolve(); await outcome; });
	assert.equal(await Promise.race([entered.promise.then(() => true), outcome.then(() => false)]), true);
	assert.equal(await remainsPending(outcome), true); assert.deepEqual(events, []); release.resolve(); const result = await outcome;
	assert.equal(result.failed, false); assert.deepEqual(events, ['verify', 'close']);
});

test('late final body corruption or saved-source drift aborts native destination before Close and releases the writer', async () => {
	const f = fixture(); let corruptFinal = false; const counts = new Map<string, number>();
	const source: MaskRasterSourcePortV1 = { async withBytes(reference, consume) { const row = f.resources.find(row => row.reference.storageKey === reference.storageKey)!;
		const count = (counts.get(reference.storageKey) ?? 0) + 1; counts.set(reference.storageKey, count);
		const bytes = new Uint8Array(row.body); if (count === 2 && reference.storageKey === f.resources[5]!.reference.storageKey) { bytes[16]! ^= 1; corruptFinal = true; }
		return await consume(bytes); } };
	for (const bodyFailure of [true, false]) { let closes = 0, aborts = 0, verifies = 0; const writable = new WritableStream<Uint8Array>({ write() {}, close() { closes++; }, abort() { aborts++; } });
		await assert.rejects(exportArchive(f.root, [f.record], [], null, [], f.row, lutSource, bodyFailure ? source : maskSource(f),
			{ writable, async verifySource() { verifies++; throw new Error('Saved source drift'); } }));
		assert.equal(closes, 0); assert.equal(aborts, 1); assert.equal(writable.locked, false); assert.equal(verifies, bodyFailure ? 0 : 1);
	}
	assert.equal(corruptFinal, true);
});

test('opaque provisional brush failure retains distinct rollback; positive native publication ACK survives late cancellation', async () => {
	const { blob } = await archive(), revoked = Proxy.revocable({}, {}), primary = revoked.proxy, cleanup = Object.freeze({ rollback: true }); revoked.revoke();
	const failed = target(); let failure: unknown;
	try { await importArchive(blob, async () => ({ ...failed.stage, async writeMaskRaster() { throw primary; }, async rollback() { failed.events.push('rollback'); throw cleanup; } })); }
	catch (error) { failure = error; }
	const observed = leaves(failure, [primary, cleanup]); assert.equal(observed.length, 2);
	assert.equal(Object.is(observed[0], primary), true); assert.equal(Object.is(observed[1], cleanup), true); assert.equal(failed.events.includes('publish'), false);
	const stop = new AbortController(), destination = target(); await importArchive(blob, async () => ({ ...destination.stage,
		async publish() { destination.events.push('publish'); stop.abort(primary); } }), { signal: stop.signal }); assert.equal(destination.events.at(-1), 'publish');
});

test('Current archive serially accepts17 maximum brush bodies above16MiB without confusing body bytes with scalar identity capacity', async () => {
	const f = fixture(), old = photoArchiveFixture(), makeBody = (alpha: number) => {
		const bytes = new Uint8Array(16 + 1024 * 1024); bytes.set([83, 67, 77, 65, 83, 75, 48, 49]);
		const header = new DataView(bytes.buffer); header.setUint32(8, 1024, true); header.setUint32(12, 1024, true); bytes.fill(alpha, 16); return bytes;
	};
	const references = Array.from({ length: 17 }, (_, index) => {
		const bytes = makeBody(index), digest = sha(bytes); return Object.freeze({ storageKey: `brush-mask-v1:1024:1024:${digest}`,
			sha256: digest, width: 1024, height: 1024, byteLength: bytes.length });
	});
	assert.ok(references.reduce((bytes, ref) => bytes + ref.byteLength, 0) > 16 * 1024 * 1024);
	const develop = replaceImageDevelopRepairSpotsV1({ ...defaultImageDevelopStateV1(), processVersion: 2, masks: [{ schemaVersion: 1, id: 'many', kind: 'mask',
		inputs: references.map((ref, index) => ({ name: `body-${index}`, kind: 'alpha', sourceRef: ref.storageKey })),
		nodes: [{ id: 'out', kind: 'alpha', inputName: 'body-0' }], outputNodeId: 'out' }], maskBindings: [] }, { schemaVersion: 1, spots: [] });
	const photo = normalizePhotoDocumentCurrentV1({ ...old.photo, schemaVersion: 3, versions: [{ ...old.photo.versions[0]!, develop }] });
	const row = normalizePhotoDevelopPresetRowCurrentV1({ ...f.row, presets: [] }, 'catalog-1'), calls = new Map<string, number>();
	const source: MaskRasterSourcePortV1 = { async withBytes(reference, consume) {
		const index = references.findIndex(ref => ref.storageKey === reference.storageKey); assert.ok(index >= 0); assert.deepEqual(reference, references[index]);
		calls.set(reference.storageKey, (calls.get(reference.storageKey) ?? 0) + 1); return await consume(makeBody(index));
	} };
	const result = await exportArchive(f.root, [{ photo, original: old.original }], [], null, [], row, undefined, source);
	assert.equal(result.document.schemaVersion, 7); assert.equal(result.document.maskRasters.length, 17); assert.ok(result.blob);
	assert.ok(result.byteLength > 17 * 1024 * 1024); for (const reference of references) assert.equal(calls.get(reference.storageKey), 2);
});

test('Current source next failure joins held return and retains each distinct opaque outcome once', async t => {
	const f = fixture(), entered = deferred<void>(), demandRelease = deferred<void>(), retiring = deferred<void>(), returnRelease = deferred<void>();
	const revoked = Proxy.revocable({}, {}), primary = revoked.proxy, cleanup = Object.freeze({ sourceReturn: true }); revoked.revoke(); let returns = 0;
	const photos = { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<ReturnType<typeof fixture>['record']>> {
		entered.resolve(); await demandRelease.promise; throw primary;
	}, async return(): Promise<IteratorResult<ReturnType<typeof fixture>['record']>> { returns++; retiring.resolve(); await returnRelease.promise; throw cleanup; } }; } };
	const outcome = exportArchive(f.root, photos, [], null, [], null, undefined, undefined).then(() => ({ failed: false as const }), (error: unknown) => ({ failed: true as const, error }));
	t.after(async () => { demandRelease.resolve(); returnRelease.resolve(); await outcome; });
	assert.equal(await Promise.race([entered.promise.then(() => true), outcome.then(() => false)]), true); demandRelease.resolve();
	assert.equal(await Promise.race([retiring.promise.then(() => true), outcome.then(() => false)]), true);
	assert.equal(await remainsPending(outcome), true); returnRelease.resolve(); const result = await outcome; assert.ok(result.failed);
	const failures = leaves(result.error, [primary, cleanup]); assert.equal(failures.length, 2);
	assert.equal(Object.is(failures[0], primary), true); assert.equal(Object.is(failures[1], cleanup), true); assert.equal(returns, 1);
});

test('legacy export/read frontdoors permanently refuse repaired Photos, Row3 and Archive7 before target publication', async () => {
	const f = fixture(); await assert.rejects(Reflect.apply(exportPhotoCatalogArchiveV6, undefined, [f.root, [f.record], [], null, [], null, lutSource, maskSource(f)]) as Promise<unknown>);
	await assert.rejects(exportPhotoCatalogArchiveV6(f.root, [photoArchiveFixture()], [], null, [], f.row, lutSource, maskSource(f)));
	const { blob } = await archive(); let factories = 0;
	await assert.rejects(importPhotoCatalogArchiveV6(blob, async () => { factories++; return target().stage; })); assert.equal(factories, 0);
});
