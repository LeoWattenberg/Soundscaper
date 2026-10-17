/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { manageImageDevelopMasksV3 } from '../src/common/editor/imaging/image-develop-mask-management-v3.ts';
import { defaultImageDevelopStateV2, normalizeImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { copyImageDevelopSettingsV2 } from '../src/common/editor/imaging/image-develop-settings-v2.ts';
import { normalizePhotoDocumentV2, parsePhotoDocumentV1OrV2, serializePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { normalizePhotoDevelopWorkspaceV2 } from '../src/lightscaper/catalog/photo-develop-workspace-v2.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { createPhotoLibraryDevelopSessionV2 } from '../src/lightscaper/controller/photo-library-develop-session-v2.ts';
import { withPhotoDevelopProxyFrameV2 } from '../src/lightscaper/controller/photo-develop-frame-v2.ts';
import { assertPhotoDevelopHandoffMasksV1 } from '../src/lightscaper/controller/photo-develop-handoff-masks-v1.ts';
import { exportPhotoCatalogArchiveV5 } from '../src/lightscaper/archive/catalog-archive-export-v5.ts';
import { exportPhotoCatalogArchiveV6 } from '../src/lightscaper/archive/catalog-archive-export-v6.ts';
import { importPhotoCatalogArchiveV6, type PhotoCatalogArchiveStageV6 } from '../src/lightscaper/archive/catalog-archive-import-v6.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import type { BrushMaskResourceReferenceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import { currentDevelopFixture, CURRENT_TIME } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { rgbaFrame } from './helpers/lightscaper-masked-frame-fixture.ts';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const OPERATIONS = ['union', 'subtract', 'intersect'] as const;
// Straight coverage endpoints: A=[255,0], B=[0,255]. These literals are
// independent of the composition command and shared mask evaluator.
const COVERAGE = { union: [255, 255], subtract: [255, 0], intersect: [0, 0] };
const PIXELS = { union: [188, 188, 188, 255, 188, 188, 188, 255],
	subtract: [188, 188, 188, 255, 255, 255, 255, 255], intersect: [255, 255, 255, 255, 255, 255, 255, 255] };
function body(alpha: readonly number[]) {
	// Independent SCMASK01 header and native alpha bytes, not the production encoder.
	const bytes = Uint8Array.of(83, 67, 77, 65, 83, 75, 48, 49, 2, 0, 0, 0, 1, 0, 0, 0, ...alpha), digest = sha(bytes);
	const reference: Readonly<BrushMaskResourceReferenceV1> = Object.freeze({ storageKey: `brush-mask-v1:2:1:${digest}`,
		sha256: digest, width: 2, height: 1, byteLength: 18 });
	return { reference, bytes };
}
function fixture() {
	const bodies = [body([255, 0]), body([0, 255]), body([64, 192])];
	const graph = (id: string, name: string, index: number) => ({ schemaVersion: 2, id, name, kind: 'matte',
		inputs: [{ name: 'paint', kind: 'alpha', sourceRef: bodies[index]!.reference.storageKey }],
		nodes: [{ id: 'output', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'output' });
	const selected = graph('selected', 'Primary mask', 0), operand = graph('operand', 'Operand mask', 1);
	const develop = normalizeImageDevelopStateV2({ ...defaultImageDevelopStateV2(), effects: [createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: -1 } })],
		masks: [selected, { ...operand, inputs: [...operand.inputs, { name: 'unused', kind: 'alpha', sourceRef: bodies[2]!.reference.storageKey }] }],
		maskBindings: [{ effectId: 'tone', maskId: 'selected' }] });
	const reads: string[] = [];
	const source: MaskRasterSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, source); reads.push(reference.storageKey);
		const found = bodies.find(body => body.reference.storageKey === reference.storageKey); assert.ok(found); assert.deepEqual(reference, found.reference);
		return await consume(new Uint8Array(found.bytes));
	} };
	return { bodies, develop, reads, source };
}
function compose(develop: unknown, operation: typeof OPERATIONS[number]) {
	return manageImageDevelopMasksV3(develop, { type: 'compose', maskId: 'selected', operandMaskId: 'operand', operation });
}
function retainedPhoto(develops: readonly unknown[]) {
	const base = photoArchiveFixture(), master = base.photo.versions[0]!;
	const workspace = normalizePhotoDevelopWorkspaceV2({ schemaVersion: 2, kind: 'photo-develop-workspace', cursor: 1,
		entries: develops.slice(0, 3).map((develop, index) => ({ label: `Composition ${index}`, createdAt: CURRENT_TIME, develop })),
		snapshots: [{ id: 'saved', name: 'Saved union', createdAt: CURRENT_TIME, develop: develops[0] }] });
	return { original: base.original, photo: normalizePhotoDocumentV2({ ...base.photo, schemaVersion: 2, versions: [
		{ ...master, develop: develops[1], workspace }, { ...master, id: 'inactive', kind: 'virtual-copy', name: 'Inactive union', develop: develops[0] },
	] }) };
}
function root() { return normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
	id: 'catalog-1', name: 'Composed masks', revision: 1, photoCount: 1, folders: [], keywords: [], collections: [] }); }
function failureLeaves(value: unknown, seen = new Set<AggregateError>()): unknown[] {
	if (!(value instanceof AggregateError)) return [value];
	if (seen.has(value)) return []; seen.add(value);
	const errors: unknown = Object.getOwnPropertyDescriptor(value, 'errors')?.value; assert.ok(Array.isArray(errors));
	return (errors as unknown[]).flatMap(error => failureLeaves(error, seen));
}

test('actual composition Save preserves selected named identity, donor, bindings and original through all operators, snapshot, reopen and history', async () => {
	const storage = await currentDevelopFixture(1), f = fixture(), donor = f.develop.masks.find(mask => mask.id === 'operand');
	const apply = (expectedRevision: number, command: Parameters<typeof storage.develop.apply>[0]['command']) =>
		storage.develop.apply({ schemaVersion: 2, photoId: 'photo-1', expectedRevision, command });
	try {
		let ack = await apply(0, { type: 'record-develop', versionId: 'version-1', develop: f.develop, label: 'Base masks', createdAt: CURRENT_TIME });
		const recipes = OPERATIONS.map(operation => compose(f.develop, operation));
		for (const [index, operation] of OPERATIONS.entries()) {
			const recipe = recipes[index]!, selected = recipe.masks.find(mask => mask.id === 'selected'); assert.ok(selected);
			assert.equal(selected.schemaVersion, 2); if (selected.schemaVersion === 2) assert.equal(selected.name, 'Primary mask');
			assert.equal(selected.kind, 'matte'); assert.deepEqual(recipe.masks.find(mask => mask.id === 'operand'), donor);
			assert.deepEqual(recipe.effects, f.develop.effects); assert.deepEqual(recipe.maskBindings, f.develop.maskBindings);
			const originalFrame = rgbaFrame([255, 255, 255, 255, 255, 255, 255, 255]), before = [...originalFrame.pixels];
			await withPhotoDevelopProxyFrameV2({ frame: originalFrame, develop: recipe, maskOverlay: { maskId: 'selected', effectId: 'tone' } }, view => {
				assert.deepEqual([...view.frame.pixels], PIXELS[operation]); assert.ok(view.maskOverlay);
				assert.deepEqual([...view.maskOverlay.coverage], COVERAGE[operation]);
			}, { maskSource: f.source });
			assert.deepEqual([...originalFrame.pixels], before);
			ack = await apply(ack.snapshot.revision, { type: 'record-develop', versionId: 'version-1', develop: recipe, label: operation, createdAt: CURRENT_TIME });
			assert.deepEqual(ack.snapshot.develop, recipe);
			if (index === 0) ack = await apply(ack.snapshot.revision, { type: 'save-develop-snapshot', versionId: 'version-1', id: 'union', name: 'Union', createdAt: CURRENT_TIME });
		}
		const saved = await storage.repository.loadPhoto('catalog-1', 'photo-1'); assert.ok(saved);
		assert.deepEqual(saved.original, storage.photos[0]!.original);
		assert.deepEqual(parsePhotoDocumentV1OrV2(serializePhotoDocumentV1OrV2(saved)), saved);
		assert.deepEqual(await createPhotoLibraryDevelopSessionV2(storage.host).read({ schemaVersion: 2, photoId: 'photo-1' }), ack.snapshot);
		ack = await apply(ack.snapshot.revision, { type: 'select-develop-history', versionId: 'version-1', cursor: 2 });
		assert.deepEqual(ack.snapshot.develop, recipes[0]);
		ack = await apply(ack.snapshot.revision, { type: 'restore-develop-snapshot', versionId: 'version-1', snapshotId: 'union', label: 'Restore union', createdAt: CURRENT_TIME });
		assert.deepEqual(ack.snapshot.develop, recipes[0]); assert.deepEqual((await storage.repository.loadPhoto('catalog-1', 'photo-1'))?.original, storage.photos[0]!.original);
		assert.deepEqual(f.develop.masks.find(mask => mask.id === 'operand'), donor);
	} finally { await storage.close(); }
});

test('Archive6 roundtrips composed named brushes including unbound donor and unused declared body with unchanged originals', async () => {
	const f = fixture(), recipes = OPERATIONS.map(operation => compose(f.develop, operation)), record = retainedPhoto(recipes);
	const result = await exportPhotoCatalogArchiveV6(root(), [record], [], null, [], null, undefined, f.source); assert.ok(result.blob);
	const expected = f.bodies.map(body => body.reference).sort((a, b) => a.storageKey.localeCompare(b.storageKey));
	assert.deepEqual(result.document.maskRasters.map(resource => resource.reference), expected);
	for (const reference of expected) assert.equal(f.reads.filter(key => key === reference.storageKey).length, 2);
	const photos: unknown[] = [], originals: number[][] = [], masks: { reference: Readonly<BrushMaskResourceReferenceV1>; bytes: Uint8Array }[] = [], events: string[] = [];
	const stage: PhotoCatalogArchiveStageV6 = {
		async writePhoto(photo, original) { photos.push(photo); const bytes: number[] = []; for await (const part of original) bytes.push(...part); originals.push(bytes); },
		async writeMaskRaster(reference, bytes) { masks.push({ reference, bytes: new Uint8Array(bytes) }); },
		async writeStack() {}, async writeSavedCollection() {}, async writeDevelopPresets() { assert.fail('No preset belongs to this brush fixture.'); },
		async writeLut() { assert.fail('No LUT belongs to this brush fixture.'); }, async publish() { events.push('publish'); }, async rollback() { events.push('rollback'); },
	};
	await importPhotoCatalogArchiveV6(result.blob, async () => stage);
	assert.deepEqual(photos, [record.photo]); assert.deepEqual(originals, [[1, 2, 3]]); assert.deepEqual(events, ['publish']);
	assert.deepEqual(masks, expected.map(reference => ({ reference, bytes: f.bodies.find(body => body.reference.storageKey === reference.storageKey)!.bytes })));
	const unused = f.bodies[2]!, corrupted = new Uint8Array(unused.bytes); corrupted[16] = 0;
	let unusedReads = 0;
	const bad: MaskRasterSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, bad); if (reference.storageKey === unused.reference.storageKey) { unusedReads++; return await consume(corrupted); }
		return f.source.withBytes(reference, consume);
	} };
	await assert.rejects(exportPhotoCatalogArchiveV6(root(), [record], [], null, [], null, undefined, bad), (error: unknown) => {
		assert.ok(failureLeaves(error).some(reason => reason instanceof Error && /digest|sha|authentic/iu.test(reason.message))); return true;
	});
	assert.equal(unusedReads, 1); assert.deepEqual(record.photo.versions[0]!.workspace?.snapshots[0]?.develop, recipes[0]);
});

test('composition keeps preset, handoff and Archive5 brush refusals ahead of original authority', async () => {
	const f = fixture(), develop = compose(f.develop, 'union'), record = retainedPhoto([develop, develop, develop]);
	assert.throws(() => copyImageDevelopSettingsV2({ schemaVersion: 2, develop,
		selection: { effectTypes: 'all', geometry: true, localAdjustments: true } }), /external|authenticated/iu);
	assert.throws(() => assertPhotoDevelopHandoffMasksV1(develop, 2, 1), /brush|portable|transport/iu);
	let originalTraps = 0;
	const original = new Proxy(record.original, { get() { originalTraps++; throw Error('A rejected composed brush acquired its original.'); } });
	await assert.rejects(exportPhotoCatalogArchiveV5(root(), [{ photo: record.photo, original }], [], null, [], null, undefined), (error: unknown) => {
		const refused = failureLeaves(error).filter(reason => reason instanceof TypeError && /brush|portable|transport/iu.test(reason.message));
		assert.equal(new Set(refused).size, 1); return true;
	});
	assert.equal(originalTraps, 0);
});
