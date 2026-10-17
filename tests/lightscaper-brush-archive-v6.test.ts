/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { exportPhotoCatalogArchiveV6 } from '../src/lightscaper/archive/catalog-archive-export-v6.ts';
import { importPhotoCatalogArchiveV6, type PhotoCatalogArchiveStageV6 } from '../src/lightscaper/archive/catalog-archive-import-v6.ts';
import { normalizePhotoCatalogArchiveV6 } from '../src/lightscaper/archive/catalog-archive-contract-v6.ts';
import { exportPhotoCatalogArchiveV1 } from '../src/lightscaper/archive/catalog-archive-export.ts';
import { exportPhotoCatalogArchiveV2 } from '../src/lightscaper/archive/catalog-archive-export-v2.ts';
import { exportPhotoCatalogArchiveV3 } from '../src/lightscaper/archive/catalog-archive-export-v3.ts';
import { exportPhotoCatalogArchiveV4 } from '../src/lightscaper/archive/catalog-archive-export-v4.ts';
import { exportPhotoCatalogArchiveV5 } from '../src/lightscaper/archive/catalog-archive-export-v5.ts';
import { importPhotoCatalogArchiveV5 } from '../src/lightscaper/archive/catalog-archive-import-v5.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { normalizePhotoDevelopWorkspaceV2 } from '../src/lightscaper/catalog/photo-develop-workspace-v2.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import type { BrushMaskResourceReferenceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { LUT_BODY, LUT_REFERENCE, lutArchiveFixture, rewriteLutArchiveFixture } from './helpers/lightscaper-lut-archive-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function resource(alpha: number, width = 2, height = 1) {
	const body = new Uint8Array([83, 67, 77, 65, 83, 75, 48, 49, width, 0, 0, 0, height, 0, 0, 0, alpha, 255 - alpha]), digest = sha(body);
	const reference: Readonly<BrushMaskResourceReferenceV1> = Object.freeze({ storageKey: `brush-mask-v1:${width}:${height}:${digest}`,
		sha256: digest, width, height, byteLength: body.length });
	return { body, reference };
}
function fixture() {
	const f = lutArchiveFixture(), first = f.record.photo.versions[0]!, resources = [resource(0), resource(32, 1, 2), resource(64), resource(128, 1, 2)];
	const withBrush = (index: number) => ({ ...first.develop, masks: [{ schemaVersion: 1, id: `brush-${index}`, kind: 'matte',
		inputs: [{ name: 'Body', kind: 'raster', sourceRef: resources[index]!.reference.storageKey }],
		nodes: [{ id: 'alpha', kind: 'raster', inputName: 'Body', channel: 'alpha' }], outputNodeId: 'alpha' }], maskBindings: [] });
	const workspace = normalizePhotoDevelopWorkspaceV2({ schemaVersion: 2, kind: 'photo-develop-workspace', cursor: 1,
		entries: [{ label: 'History', createdAt: null, develop: withBrush(1) }, { label: 'Current', createdAt: null, develop: first.develop },
			{ label: 'Redo', createdAt: null, develop: withBrush(2) }],
		snapshots: [{ id: 'snapshot', name: 'Saved mask', createdAt: first.createdAt, develop: withBrush(3) }] });
	const photo = normalizePhotoDocumentV2({ ...f.record.photo, versions: [{ ...first, workspace },
		{ ...first, id: 'inactive', kind: 'virtual-copy', name: 'Inactive', develop: withBrush(0) }] });
	return { ...f, record: { photo, original: f.record.original }, resources };
}
const lutSource = { async withBytes<Result>(_ref: unknown, consume: (bytes: Uint8Array<ArrayBuffer>) => Promise<Result>) { return await consume(new Uint8Array(LUT_BODY)); } };
function maskSource(f: ReturnType<typeof fixture>, events: string[] = []): MaskRasterSourcePortV1 {
	return { async withBytes(reference, consume) { events.push(`body:${reference.storageKey}`);
		const row = f.resources.find(row => row.reference.storageKey === reference.storageKey); assert.ok(row); assert.deepEqual(reference, row.reference);
		return await consume(new Uint8Array(row.body)); } };
}
function target() {
	const photos: unknown[] = [], masks: { reference: Readonly<BrushMaskResourceReferenceV1>; bytes: Uint8Array }[] = [];
	const rows: unknown[] = [], luts: Uint8Array[] = [], events: string[] = [];
	const stage: PhotoCatalogArchiveStageV6 = { async writePhoto(photo, original) { const bytes: number[] = [];
		for await (const part of original) for (const value of part) bytes.push(value); photos.push({ photo, bytes }); events.push('photo'); },
		async writeStack() {}, async writeSavedCollection() {}, async writeDevelopPresets(row) { rows.push(row); events.push('presets'); },
		async writeLut(ref, bytes) { assert.deepEqual(ref, LUT_REFERENCE); luts.push(new Uint8Array(bytes)); events.push('lut'); },
		async writeMaskRaster(reference, bytes) { masks.push({ reference, bytes: new Uint8Array(bytes) }); events.push('mask'); },
		async publish() { events.push('publish'); }, async rollback() { events.push('rollback'); } };
	return { stage, photos, masks, rows, luts, events };
}
async function archive(f = fixture(), source = maskSource(f)) {
	const result = await exportPhotoCatalogArchiveV6(f.root, [f.record], [], null, [], f.row, lutSource, source); assert.ok(result.blob); return { f, result, blob: result.blob };
}
function failureLeaves(value: unknown, opaque: readonly unknown[], seen = new Set<AggregateError>()): unknown[] {
	if (opaque.some(reason => Object.is(reason, value))) return [value];
	if (!(value instanceof AggregateError)) return [value];
	if (seen.has(value)) return []; seen.add(value);
	const descriptor = Object.getOwnPropertyDescriptor(value, 'errors');
	assert.ok(descriptor && Object.hasOwn(descriptor, 'value') && Array.isArray(descriptor.value));
	return (descriptor.value as unknown[]).flatMap(reason => failureLeaves(reason, opaque, seen));
}

test('V6 transports complete inactive/history/redo/snapshot unbound masks with LUT preset custody and exact originals', async () => {
	const f = fixture(), events: string[] = [], source = maskSource(f, events);
	const result = await exportPhotoCatalogArchiveV6(f.root, [f.record], [], null, [], f.row, lutSource, source,
		{ async verifySource() { events.push('verify'); } }); assert.ok(result.blob);
	assert.equal(result.document.schemaVersion, 6); assert.deepEqual(result.document.lutResources.map(row => row.reference), [LUT_REFERENCE]);
	const expected = f.resources.map(row => row.reference).sort((a, b) => a.storageKey.localeCompare(b.storageKey));
	assert.deepEqual(result.document.maskRasters.map(row => row.reference), expected);
	assert.deepEqual(result.manifest.assets.filter(row => row.kind === 'photo-mask-raster').map(row => ({ id: row.sourceId, entry: row.entry, encoding: row.encoding, size: row.size, sha256: row.sha256 })),
		expected.map(ref => ({ id: ref.storageKey, entry: `assets/masks/${ref.sha256}.scmask`, encoding: 'lightscaper-mask-raster-v1', size: ref.byteLength, sha256: ref.sha256 })));
	assert.ok(result.manifest.assets.some(row => row.kind === 'photo-catalog-pack' && row.encoding === 'lightscaper-photo-pack-v3'));
	assert.equal(events.at(-1), 'verify'); for (const ref of expected) assert.equal(events.filter(event => event === `body:${ref.storageKey}`).length, 2);
	const destination = target(); await importPhotoCatalogArchiveV6(result.blob, async (root, saved, preset, luts, masks) => {
		assert.deepEqual(root, f.root); assert.equal(saved, null); assert.equal(preset?.revision, 29);
		assert.deepEqual(luts, result.document.lutResources); assert.deepEqual(masks, result.document.maskRasters); return destination.stage;
	});
	assert.deepEqual(destination.photos, [{ photo: f.record.photo, bytes: [1, 2, 3] }]); assert.deepEqual(destination.rows, [f.row]); assert.deepEqual(destination.luts, [LUT_BODY]);
	assert.deepEqual(destination.masks, expected.map(reference => ({ reference, bytes: f.resources.find(row => row.reference.storageKey === reference.storageKey)!.body })));
	assert.equal(destination.events.at(-1), 'publish'); assert.equal(destination.events.includes('rollback'), false);
});

test('V6 delegates every legacy version with exact absence while direct V5 still refuses new brushes/schema', async () => {
	const f = fixture(), record = photoArchiveFixture();
	const results = [await exportPhotoCatalogArchiveV1(f.root, [record]), await exportPhotoCatalogArchiveV2(f.root, [record], []),
		await exportPhotoCatalogArchiveV3(f.root, [record], [], null, []), await exportPhotoCatalogArchiveV4(f.root, [record], [], null, [], null),
		await exportPhotoCatalogArchiveV5(f.root, [lutArchiveFixture().record], [], null, [], f.row, lutSource)];
	for (const result of results) { assert.ok(result.blob); const destination = target();
		await importPhotoCatalogArchiveV6(result.blob, async (_root, _saved, _preset, _luts, masks) => { assert.deepEqual(masks, []); return destination.stage; });
		assert.equal(destination.masks.length, 0); assert.equal(destination.events.at(-1), 'publish');
	}
	await assert.rejects(exportPhotoCatalogArchiveV5(f.root, [f.record], [], null, [], f.row, lutSource));
	const current = await archive(f); let stages = 0;
	await assert.rejects(importPhotoCatalogArchiveV5(current.blob, async () => { stages++; return target().stage; })); assert.equal(stages, 0);
});

test('declared closure cannot omit or add a valid brush; honestly rehashed malformed ZIPs never publish', async () => {
	const { f, result, blob } = await archive();
	for (const mode of ['missing', 'extra', 'body', 'profile'] as const) {
		const rewritten = await rewriteLutArchiveFixture(blob, files => {
			const document = { ...structuredClone(result.document), maskRasters: [...result.document.maskRasters] }, manifest = structuredClone(result.manifest);
			if (mode === 'missing') { const row = document.maskRasters.shift()!; files.delete(row.entry); manifest.assets = manifest.assets.filter(asset => asset.sourceId !== row.id); }
			if (mode === 'extra') { const extra = resource(200), entry = `assets/masks/${extra.reference.sha256}.scmask`;
				document.maskRasters.push({ id: extra.reference.storageKey, entry, reference: extra.reference }); files.set(entry, extra.body);
				manifest.assets.push({ sourceId: extra.reference.storageKey, entry, kind: 'photo-mask-raster', encoding: 'lightscaper-mask-raster-v1', size: extra.body.length, sha256: sha(extra.body) }); }
			if (mode === 'body') { const row = document.maskRasters[0]!, bytes = new Uint8Array(files.get(row.entry)!); bytes[16]! ^= 1; files.set(row.entry, bytes);
				manifest.assets = manifest.assets.map(asset => asset.sourceId === row.id ? { ...asset, sha256: sha(bytes), size: bytes.length } : asset); }
			if (mode === 'profile') manifest.assets = manifest.assets.map(asset => asset.kind === 'photo-mask-raster' ? { ...asset, encoding: 'lightscaper-mask-raster-v2' } : asset);
			const project = new TextEncoder().encode(JSON.stringify(document)); files.set('project.json', project);
			manifest.project = { ...manifest.project, size: project.length, sha256: sha(project) }; files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
		});
		const destination = target(); await assert.rejects(importPhotoCatalogArchiveV6(rewritten, async () => destination.stage));
		assert.equal(destination.events.includes('publish'), false); assert.equal(destination.masks.length, 0);
		if (destination.events.length) assert.equal(destination.events.at(-1), 'rollback');
	}
	assert.equal(f.resources.length, 4);
});

test('V6 contract shares the global asset budget and rejects duplicate or mismatched closed mask declarations', async () => {
	const { result } = await archive(), row = result.document.maskRasters[0]!;
	for (const masks of [[row, row], [{ ...row, id: 'near' }], [{ ...row, entry: `assets/masks/${row.reference.sha256}.cube` }],
		[{ ...row, reference: { ...row.reference, width: 3 } }], [{ ...row, extra: true }]]) {
		assert.throws(() => normalizePhotoCatalogArchiveV6({ ...result.document, maskRasters: masks }));
	}
	assert.throws(() => normalizePhotoCatalogArchiveV6({ ...result.document, maskRasters: Array.from({ length: 4094 }, () => row) }), /count|pack|entry|limit|resource/u);
});

test('held borrowed mask joins before final verify and destination Close', async t => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>(), events: string[] = []; let held = false;
	const source: MaskRasterSourcePortV1 = { async withBytes(ref, consume) { const row = f.resources.find(row => row.reference.storageKey === ref.storageKey)!;
		const work = Promise.resolve(consume(new Uint8Array(row.body))); void work.catch(() => undefined);
		if (!held) { held = true; entered.resolve(); await release.promise; } return await work; } };
	const work = exportPhotoCatalogArchiveV6(f.root, [f.record], [], null, [], f.row, lutSource, source,
		{ writable: new WritableStream({ write() {}, close() { events.push('close'); } }), async verifySource() { events.push('verify'); } });
	t.after(async () => { release.resolve(); await work.catch(() => undefined); });
	await entered.promise; assert.equal(await remainsPending(work), true); assert.deepEqual(events, []); release.resolve(); await work;
	assert.deepEqual(events, ['verify', 'close']);
});

test('known native publication ACK wins late cancellation; exact opaque body failure keeps distinct rollback', async () => {
	const { blob } = await archive(), revoked = Proxy.revocable({}, {}), primary = revoked.proxy, cleanup = Object.freeze({ rollback: true }); revoked.revoke();
	const destination = target(); let failure: unknown;
	try { await importPhotoCatalogArchiveV6(blob, async () => ({ ...destination.stage, async writeMaskRaster() { throw primary; },
		async rollback() { destination.events.push('rollback'); throw cleanup; } })); }
	catch (error) { failure = error; }
	const leaves = failureLeaves(failure, [primary, cleanup]); assert.equal(leaves.length, 2);
	assert.equal(Object.is(leaves[0], primary), true); assert.equal(Object.is(leaves[1], cleanup), true);
	assert.deepEqual(destination.events, ['photo', 'presets', 'lut', 'rollback']); assert.equal(destination.masks.length, 0);
	const stop = new AbortController(), published = target(); await importPhotoCatalogArchiveV6(blob, async () => ({ ...published.stage,
		async publish() { published.events.push('publish'); stop.abort(primary); } }), { signal: stop.signal }); assert.equal(published.events.at(-1), 'publish');
});

test('V6 opaque mask source failure retains native destination abort failure and releases its writer', async () => {
	const f = fixture(), revoked = Proxy.revocable({}, {}), primary = revoked.proxy, cleanup = Object.freeze({ abort: true }); revoked.revoke();
	const events: string[] = [], writable = new WritableStream<Uint8Array>({ write() { events.push('write'); }, close() { events.push('close'); },
		abort(reason) { assert.equal(Object.is(reason, primary), true); events.push('abort'); throw cleanup; } });
	const source: MaskRasterSourcePortV1 = { async withBytes() { throw primary; } }; let failure: unknown;
	try { await exportPhotoCatalogArchiveV6(f.root, [f.record], [], null, [], f.row, lutSource, source, { writable }); }
	catch (error) { failure = error; }
	// Actual ZIP retirement repeats the stream's original failure after native abort rejects.
	const leaves = failureLeaves(failure, [primary, cleanup]); assert.equal(leaves.length, 3);
	assert.equal(Object.is(leaves[0], primary), true); assert.equal(Object.is(leaves[1], cleanup), true);
	assert.equal(Object.is(leaves[2], primary), true);
	assert.ok(events.includes('write')); assert.equal(events.filter(event => event === 'abort').length, 1);
	assert.equal(events.includes('close'), false); assert.equal(writable.locked, false);
});
