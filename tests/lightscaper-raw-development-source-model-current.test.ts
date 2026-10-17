/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { normalizeFramescaperImageSourceCurrentV1, framescaperImageSourceResourceReferencesCurrentV1 } from '../src/common/editor/timeline-image-model-current-v1.ts';
import { normalizeFramescaperImageSourceV4 } from '../src/common/editor/timeline-image-model-v4.ts';
import { normalizeFramescaperImageSourceV3 } from '../src/common/editor/timeline-image-model-v3.ts';
import { imageDevelopHandoffRecipeSha256CurrentV1, createImageDevelopHandoffProvenanceCurrentV1,
	normalizeImageDevelopHandoffProvenanceCurrentV1 } from '../src/common/editor/image-develop-handoff-provenance-current-v1.ts';
import { imageDevelopHandoffRecipeSha256V2, createImageDevelopHandoffProvenanceV2 } from '../src/common/editor/image-develop-handoff-provenance-v2.ts';
import { createFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../src/common/editor/timeline-image-model.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { createPhotoExportSidecarCurrentV1, normalizePhotoExportSidecarCurrentV1, serializePhotoExportSidecarCurrentV1,
	parsePhotoExportSidecarCurrentV1 } from '../src/lightscaper/catalog/photo-export-sidecar-current-v1.ts';
import { createPhotoExportSidecarV2, normalizePhotoExportSidecarV2, parsePhotoExportSidecarV2 } from '../src/lightscaper/catalog/photo-export-sidecar-v2.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { normalizePhotoDocumentV3 } from '../src/lightscaper/catalog/photo-document-v3.ts';
import { createPhotoDevelopWorkspaceCurrentV1, commitPhotoDevelopWorkspaceCurrentV1 } from '../src/lightscaper/catalog/photo-develop-workspace-current-v1.ts';
import { queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { createRawFrameFixtureCurrentV1 } from './helpers/lightscaper-raw-frame-current-fixture.ts';

const TIME = '2026-10-20T00:00:00.000Z';
const SHA = 'b'.repeat(64), BRUSH = `brush-mask-v1:2:1:${'c'.repeat(64)}`;
const LUT = { storageKey: `lut-sha256:${SHA}`, sha256: SHA, byteLength: 73, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
function recipe(mode: 'canonical' | 'headroom' | 'recovery' = 'recovery') {
	return normalizeImageDevelopStateV4({ ...defaultImageDevelopStateV2(), processVersion: 4,
		rawDevelopment: { schemaVersion: 1, mode }, effects: [{ id: 'disabled-lut', type: 'cube-lut-profile-v1', enabled: false, params: { lut: LUT } }],
		masks: [{ schemaVersion: 2, id: 'named', name: 'Retained unused paint', kind: 'matte',
			inputs: [{ name: 'Paint', kind: 'alpha', sourceRef: BRUSH }, { name: 'Unused', kind: 'raster', sourceRef: BRUSH }],
			nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'Paint' }], outputNodeId: 'alpha' }], maskBindings: [],
		repairs: { schemaVersion: 1, spots: [{ id: 'retained-clone', mode: 'clone', enabled: false, target: { x: .5, y: .5 },
			source: { x: .25, y: .5 }, radius: .1, feather: .5, opacity: 1 }] } });
}
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function sourceWithRecipe<Source extends { readonly provenance: Readonly<{ developSha256: string }> }>(source: Source, develop = recipe()) {
	return { ...source, develop, provenance: { ...source.provenance, developSha256: digest(develop) } };
}
function photo(hidden = false) {
	const base = queryPhotoV1(), develop = recipe();
	let workspace = createPhotoDevelopWorkspaceCurrentV1(develop, { label: 'Recovered', createdAt: TIME });
	if (hidden) workspace = commitPhotoDevelopWorkspaceCurrentV1(workspace, defaultImageDevelopStateV2(), { label: 'Canonical selected', createdAt: TIME });
	return normalizePhotoDocumentCurrentV1({ ...base, schemaVersion: 3,
		versions: base.versions.map(version => ({ ...version, develop: hidden ? defaultImageDevelopStateV2() : develop, workspace })) });
}
function binding(value: ReturnType<typeof photo>) {
	return { catalogId: value.catalogId, photoId: value.id, versionId: value.activeVersionId, expectedRevision: value.revision };
}

test('Current Source4 admits all RAW modes with complete recipe4 hash while preserving the actual ABI1 receipt and FramePack1 binding', async () => {
	const f = await createRawFrameFixtureCurrentV1(), before = structuredClone(f.source), packBytes = f.pack.bytes.slice();
	try {
		for (const mode of ['canonical', 'headroom', 'recovery'] as const) {
			const value = sourceWithRecipe(f.source, recipe(mode)), source = normalizeFramescaperImageSourceCurrentV1(value);
			assert.equal(source.schemaVersion, 4); if (source.schemaVersion !== 4) assert.fail('The RAW source envelope must remain4.');
			assert.equal(source.develop.processVersion, 4); assert.deepEqual(source.develop, recipe(mode));
			assert.deepEqual(source.raw, f.raw); assert.deepEqual(source.original, f.source.original); assert.deepEqual(source.canonical, f.source.canonical);
			assert.equal(source.contentSha256, f.pack.contentSha256); assert.equal(source.assetByteLength, f.pack.assetByteLength);
			assert.equal(source.conversionReceiptSha256, f.pack.conversionReceiptSha256); assert.equal(source.provenance.developSha256, digest(recipe(mode)));
			assert.deepEqual(framescaperImageSourceResourceReferencesCurrentV1(source), { luts: [LUT], brushes: [{ storageKey: BRUSH,
				sha256: 'c'.repeat(64), width: 2, height: 1, byteLength: 18 }] });
			assert.throws(() => normalizeFramescaperImageSourceV4(value), 'The permanent Source4 facade remains through3.');
			assert.throws(() => normalizeFramescaperImageSourceCurrentV1({ ...value, provenance: f.source.provenance }), /recipe|provenance/iu);
			assert.throws(() => normalizeFramescaperImageSourceCurrentV1({ ...value, provenance: { ...value.provenance,
				origin: { ...value.provenance.origin, schemaVersion: 2 } } }), /schema|origin|Photo/iu);
		}
		assert.deepEqual(f.source, before); assert.deepEqual(f.pack.bytes, packBytes);
	} finally { await f.close(); }
});

// Actual pack metadata, deliberately synthetic encoded payload: this qualifies
// the scalar raster transport policy, not a native PNG decoder or body proof.
function rasterSource() {
	const original = new TextEncoder().encode('synthetic static PNG fixture'), pixels = Uint8Array.of(17, 29, 43, 255);
	const pack = createFramescaperImageFramePackV1({ original, receipt: { schemaVersion: 1 }, width: 1, height: 1, timingMode: 'fallback',
		frames: [{ presentationTicks: 0n, durationTicks: 5_000_000n, rgba: pixels }] });
	const develop = defaultImageDevelopStateV2(), provenance = createImageDevelopHandoffProvenanceV2({ develop,
		original: { exactName: 'Static.png', sha256: pack.originalSha256, byteLength: original.byteLength },
		origin: { schemaFamily: 'lightscaper', schemaVersion: 3, catalogId: 'catalog', photoId: 'photo', revision: 1,
			versionId: 'master', versionKind: 'master', versionName: 'Saved', versionCreatedAt: TIME } });
	return { schemaVersion: 3, kind: 'image', id: 'static-source', name: 'Static', storageKey: 'static-source', mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
		contentSha256: pack.contentSha256, assetByteLength: pack.assetByteLength, conversionReceiptSha256: pack.conversionReceiptSha256,
		original: { fileName: 'Static.png', mimeType: 'image/png', recognizedFormat: 'png', byteLength: original.byteLength, sha256: pack.originalSha256 },
		canonical: { width: 1, height: 1, hasAlpha: false, frameCount: 1, durationTicks: pack.durationTicks, timingMode: 'fallback' },
		develop, developed: { width: 1, height: 1 }, provenance };
}

test('Current raster Source3 retains sticky canonical process4 but cannot claim a noncanonical RAW profile', () => {
	const source = rasterSource(), canonical = sourceWithRecipe(source, recipe('canonical'));
	const admitted = normalizeFramescaperImageSourceCurrentV1(canonical);
	assert.equal(admitted.schemaVersion, 3); if (admitted.schemaVersion !== 3) assert.fail('Raster Source3 must stay3.');
	assert.deepEqual(admitted.develop, recipe('canonical')); assert.deepEqual(admitted.original, source.original);
	assert.equal(admitted.provenance.developSha256, digest(recipe('canonical')));
	assert.throws(() => normalizeFramescaperImageSourceV3(canonical));
	for (const mode of ['headroom', 'recovery'] as const) assert.throws(() => normalizeFramescaperImageSourceCurrentV1(sourceWithRecipe(source, recipe(mode))), /RAW|canonical|profile/iu);
	assert.deepEqual(normalizeFramescaperImageSourceCurrentV1(source), normalizeFramescaperImageSourceV3(source));
});

test('Current provenance recipe hashing includes RAW mode, repairs, named graph and disabled resources without widening fixed V2', () => {
	const value = recipe(); assert.equal(imageDevelopHandoffRecipeSha256CurrentV1(value), digest(value));
	assert.notEqual(imageDevelopHandoffRecipeSha256CurrentV1(value), imageDevelopHandoffRecipeSha256CurrentV1(recipe('headroom')));
	for (const changed of [{ ...value, repairs: { schemaVersion: 1, spots: [] } }, { ...value, effects: [] },
		{ ...value, masks: value.masks.map(mask => ({ ...mask, name: 'Other retained name' })) }]) {
		assert.notEqual(imageDevelopHandoffRecipeSha256CurrentV1(changed), digest(value));
	}
	assert.throws(() => imageDevelopHandoffRecipeSha256V2(value));
	const request = { develop: value, original: rasterSource().provenance.original, origin: rasterSource().provenance.origin };
	assert.throws(() => createImageDevelopHandoffProvenanceV2(request));
	const created = createImageDevelopHandoffProvenanceCurrentV1(request);
	assert.equal(created.schemaVersion, 2); assert.equal(created.developSha256, digest(value));
	assert.deepEqual(created.original, request.original); assert.deepEqual(created.origin, request.origin);
	assert.deepEqual(normalizeImageDevelopHandoffProvenanceCurrentV1(created), created);
	assert.throws(() => createImageDevelopHandoffProvenanceCurrentV1({ ...request, origin: { ...request.origin, schemaVersion: 2 } }), /Photo|successor/iu);
});

test('Current source hashing refuses a hostile RAW slot without invoking it or fabricating a legacy recipe', () => {
	let reads = 0; const value = Object.defineProperty({ ...recipe() }, 'rawDevelopment', { enumerable: true,
		get() { reads++; return { schemaVersion: 1, mode: 'recovery' }; } });
	assert.throws(() => imageDevelopHandoffRecipeSha256CurrentV1(value));
	assert.equal(reads, 0);
});

test('Current Sidecar2 preserves selected recipe4 and exact Original facts through canonical JSON while permanent Sidecar2 refuses it', () => {
	const input = photo(), original = structuredClone(input.original), sidecar = createPhotoExportSidecarCurrentV1(input, binding(input));
	assert.equal(sidecar.schemaVersion, 2); assert.equal(sidecar.photoSchemaVersion, 3); assert.deepEqual(sidecar.version.develop, recipe());
	const text = serializePhotoExportSidecarCurrentV1(sidecar), reopened = parsePhotoExportSidecarCurrentV1(text);
	assert.deepEqual(reopened, sidecar); assert.equal(serializePhotoExportSidecarCurrentV1(reopened), text);
	assert.deepEqual(reopened.original, { fileName: input.original.name, contentSha256: input.original.contentSha256, byteLength: input.original.byteLength });
	assert.deepEqual(input.original, original); assert.throws(() => normalizePhotoExportSidecarV2(sidecar));
	assert.throws(() => parsePhotoExportSidecarV2(text)); assert.throws(() => createPhotoExportSidecarV2(input, binding(input)));
	assert.throws(() => normalizePhotoExportSidecarCurrentV1({ ...sidecar, version: { ...sidecar.version,
		develop: { ...recipe(), rawDevelopment: { schemaVersion: 1, mode: 'future' } } } }));
});

test('Permanent Sidecar2 creation refuses hidden retained recipe4 before reducing whole Photo3 to selected older settings', () => {
	const input = photo(true); assert.equal(input.versions[0]!.develop.processVersion, 2);
	assert.throws(() => normalizePhotoDocumentV3(input));
	assert.throws(() => createPhotoExportSidecarV2(input, binding(input)), 'Whole-document fixed admission must precede selected projection.');
	const current = createPhotoExportSidecarCurrentV1(input, binding(input));
	assert.equal(current.schemaVersion, 2); assert.deepEqual(current.version.develop, defaultImageDevelopStateV2());
});
