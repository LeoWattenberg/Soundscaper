/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeFramescaperImageSourceV2, normalizeFramescaperImageSourceV1OrV2, framescaperImageSourceResourceReferencesV2 } from '../src/common/editor/timeline-image-model-v2.ts';
import { normalizeFramescaperImageSourceV1, FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../src/common/editor/timeline-image-model.ts';
import { createImageDevelopHandoffProvenanceV1 } from '../src/common/editor/image-develop-handoff-provenance-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';

function fixture() {
	const develop = defaultImageDevelopStateV2(), original = { fileName: 'é.png', mimeType: 'image/png', recognizedFormat: 'png', byteLength: 17, sha256: 'a'.repeat(64) };
	const base = { schemaVersion: 1, kind: 'image', id: 'local-source', name: 'Photo', mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
		storageKey: 'local-source', contentSha256: 'b'.repeat(64), assetByteLength: 2048, original,
		canonical: { width: 2, height: 2, hasAlpha: false, frameCount: 1, durationTicks: '1000000', timingMode: 'fallback' }, conversionReceiptSha256: 'c'.repeat(64) };
	const provenance = createImageDevelopHandoffProvenanceV1({ origin: { schemaFamily: 'lightscaper', schemaVersion: 2, catalogId: 'catalog', photoId: 'photo', revision: 2,
		versionId: 'master', versionKind: 'master', versionName: 'Master', versionCreatedAt: '2026-10-01T00:00:00.000Z' }, original: { exactName: 'e\u0301.png', sha256: original.sha256, byteLength: 17 }, develop });
	return { base, value: { ...base, schemaVersion: 2, develop, developed: { width: 2, height: 2 }, provenance } };
}

test('named image V2 retains immutable V1 pack facts, exact spelling and typed editable process without widening V1', () => {
	const { base, value } = fixture(), admitted = normalizeFramescaperImageSourceV2(value);
	assert.deepEqual(admitted.develop, value.develop); assert.equal(admitted.original.fileName, 'é.png');
	assert.equal(admitted.provenance.original.exactName, 'e\u0301.png'); assert.equal(admitted.kind, 'image');
	assert.throws(() => normalizeFramescaperImageSourceV1(value));
	assert.deepEqual(normalizeFramescaperImageSourceV1OrV2(base), normalizeFramescaperImageSourceV1(base));
	assert.deepEqual(normalizeFramescaperImageSourceV1OrV2(admitted), admitted);
	assert.throws(() => normalizeFramescaperImageSourceV1OrV2({ ...value, schemaVersion: 3 }));
});

test('exact original spelling binds the canonical original filename while the editable display name remains independent', () => {
	const { value } = fixture();
	assert.throws(() => normalizeFramescaperImageSourceV2({ ...value, original: { ...value.original, fileName: 'display.png' } }));
	const admitted = normalizeFramescaperImageSourceV2({ ...value, name: 'Independent title' });
	assert.equal(admitted.name, 'Independent title'); assert.equal(admitted.original.fileName, 'é.png'); assert.equal(admitted.provenance.original.exactName, 'e\u0301.png');
});

test('source V2 binds original digest/length and normalized recipe digest, refusing mismatches before storage reads', () => {
	const { value } = fixture();
	for (const provenance of [{ ...value.provenance, original: { ...value.provenance.original, sha256: 'd'.repeat(64) } },
		{ ...value.provenance, original: { ...value.provenance.original, byteLength: 18 } }, { ...value.provenance, developSha256: 'e'.repeat(64) }]) {
		assert.throws(() => normalizeFramescaperImageSourceV2({ ...value, provenance }));
	}
	assert.throws(() => normalizeFramescaperImageSourceV2({ ...value, canonical: { ...value.canonical, frameCount: 2 } }));
	assert.throws(() => normalizeFramescaperImageSourceV2({ ...value, developed: { width: 8193, height: 2 } }));
	assert.throws(() => normalizeFramescaperImageSourceV2({ ...value, assetByteLength: 512 * 1024 * 1024 + 1 }));
	assert.throws(() => normalizeFramescaperImageSourceV2({ ...value, body: new Uint8Array(1) }));
});

test('disabled LUT references remain in custody closure and duplicate resources are returned exactly once', () => {
	const { value } = fixture(), reference = { storageKey: `lut-sha256:${'f'.repeat(64)}`, sha256: 'f'.repeat(64), byteLength: 120,
		size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
	const develop = { ...value.develop, effects: [false, true].map((enabled, index) => ({ id: `profile-${index}`, type: 'cube-lut-profile-v1', enabled, params: { lut: reference } })) };
	const provenance = createImageDevelopHandoffProvenanceV1({ origin: value.provenance.origin, original: value.provenance.original, develop });
	const source = normalizeFramescaperImageSourceV2({ ...value, develop, provenance });
	assert.deepEqual(framescaperImageSourceResourceReferencesV2(source), [reference]);
	assert.equal(source.develop.effects[0]?.enabled, false);
});
