/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { createImageDevelopHandoffProvenanceCurrentV1, normalizeImageDevelopHandoffProvenanceCurrentV1 } from '../src/common/editor/image-develop-handoff-provenance-current-v1.ts';
import { createImageDevelopHandoffProvenanceHdrCurrentV1, normalizeImageDevelopHandoffProvenanceHdrCurrentV1 } from '../src/common/editor/image-develop-handoff-provenance-hdr-current-v1.ts';
import { normalizeFramescaperHdrOriginalReceiptV1 } from '../src/common/editor/timeline-image-hdr-receipt-v1.ts';
import { normalizeFramescaperHdrImageSourceCurrentV1, prepareFramescaperHdrImageOriginalCurrentV1 } from '../src/common/editor/timeline-image-model-hdr-current-v1.ts';
import { normalizeFramescaperImageSourceCurrentV1 } from '../src/common/editor/timeline-image-model-current-v1.ts';
import { normalizeFramescaperImageSourceV4 } from '../src/common/editor/timeline-image-model-v4.ts';
import { FRAMESCAPER_IMAGE_ASSET_MIME_TYPE } from '../src/common/editor/timeline-image-model.ts';
import { encodeFramescaperImageConversionReceiptV1 } from '../src/common/editor/timeline-image-conversion-receipt-v1.ts';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function receipt() {
	return { schemaVersion: 1, format: 'lightscaper-hdr', bodyVersion: 1,
		descriptor: { schemaVersion: 1, width: 2, height: 1, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' },
		pixelEncoding: 'rgb32f-le', pixelsSha256: 'a'.repeat(64), metadataSha256: 'b'.repeat(64) };
}
function provenanceRequest(byteLength = 2048) {
	return { develop: defaultImageDevelopStateV1(),
		original: { exactName: 'HDR master.lshdr', sha256: 'c'.repeat(64), byteLength },
		origin: { schemaFamily: 'lightscaper', schemaVersion: 3, catalogId: 'catalog', photoId: 'photo', revision: 7,
			versionId: 'master', versionKind: 'master', versionName: 'Master', versionCreatedAt: '2026-10-16T00:00:00.000Z' } };
}
function source(byteLength = 2048) {
	const hdr = receipt(), request = provenanceRequest(byteLength);
	return { schemaVersion: 5, kind: 'image', id: 'hdr-source', name: 'HDR master', mimeType: FRAMESCAPER_IMAGE_ASSET_MIME_TYPE,
		storageKey: 'hdr-source', contentSha256: 'd'.repeat(64), assetByteLength: byteLength + 4096,
		original: { fileName: request.original.exactName, mimeType: 'image/x-lightscaper-hdr', recognizedFormat: 'lightscaper-hdr',
			byteLength, sha256: request.original.sha256 },
		canonical: { width: 2, height: 1, hasAlpha: false, frameCount: 1, durationTicks: '1000000', timingMode: 'fallback' },
		conversionReceiptSha256: digest(encodeFramescaperImageConversionReceiptV1({ schemaVersion: 1, kind: 'hdr-original', hdr })),
		develop: request.develop, developed: { width: 2, height: 1 }, provenance: createImageDevelopHandoffProvenanceHdrCurrentV1(request), hdr };
}

test('named HDR handoff policy retains exact large Original facts while existing Current handoff keeps its fixed 64 MiB cap', () => {
	const request = provenanceRequest(196 * 1024 * 1024), before = structuredClone(request);
	const captured = createImageDevelopHandoffProvenanceHdrCurrentV1(request);
	assert.equal(captured.schemaVersion, 2); assert.equal(captured.original.byteLength, request.original.byteLength);
	assert.deepEqual(normalizeImageDevelopHandoffProvenanceHdrCurrentV1(JSON.parse(JSON.stringify(captured))), captured);
	assert.deepEqual(request, before); assert.ok(Object.isFrozen(captured.original));
	assert.throws(() => createImageDevelopHandoffProvenanceCurrentV1(request));
	assert.throws(() => normalizeImageDevelopHandoffProvenanceCurrentV1(captured));
	assert.throws(() => createImageDevelopHandoffProvenanceHdrCurrentV1(provenanceRequest(196 * 1024 * 1024 + 1)));
	assert.deepEqual(createImageDevelopHandoffProvenanceHdrCurrentV1(provenanceRequest()), createImageDevelopHandoffProvenanceCurrentV1(provenanceRequest()));
});

test('explicit Source5 scalar owner retains opaque Float32 Original authority separately from FramePack1 display cache', () => {
	const input = source(), before = structuredClone(input), captured = normalizeFramescaperHdrImageSourceCurrentV1(input);
	assert.equal(captured.schemaVersion, 5); assert.equal(captured.hdr.descriptor.sampleFormat, 'float32');
	assert.deepEqual(captured, before); assert.deepEqual(input, before); assert.ok(Object.isFrozen(captured.hdr.descriptor));
	assert.deepEqual(normalizeFramescaperHdrImageSourceCurrentV1(JSON.parse(JSON.stringify(captured))), captured);
	// Global activation waits for the actual reader/archive/authoring closure.
	assert.throws(() => normalizeFramescaperImageSourceCurrentV1(input)); assert.throws(() => normalizeFramescaperImageSourceV4(input));
});

test('native HDR receipt refuses fake RAW/byte/color identities, noncanonical digests and accessor declarations', () => {
	const valid = receipt(); assert.deepEqual(normalizeFramescaperHdrOriginalReceiptV1(valid), valid);
	for (const patch of [{ schemaVersion: 2 }, { format: 'pfm' }, { bodyVersion: 2 }, { pixelEncoding: 'rgba32f-le' },
		{ decoder: { id: 'libraw' } }, { metadataSha256: 'B'.repeat(64) }, { pixelsSha256: 'a'.repeat(63) },
		{ descriptor: { ...valid.descriptor, sampleFormat: 'unorm16' } }, { descriptor: { ...valid.descriptor, primaries: 'bt709' } },
		{ descriptor: { ...valid.descriptor, transfer: 'srgb' } }, { descriptor: { ...valid.descriptor, width: 8193 } }]) {
		assert.throws(() => normalizeFramescaperHdrOriginalReceiptV1({ ...valid, ...patch }));
	}
	let reads = 0; const hostile = Object.defineProperty({ ...valid }, 'metadataSha256', { enumerable: true, get() { reads++; return valid.metadataSha256; } });
	assert.throws(() => normalizeFramescaperHdrOriginalReceiptV1(hostile), /data/iu); assert.equal(reads, 0);
});

test('Source5 cross-validates Original format, native receipt, natural extent, unchanged recipe and truthful Photo origin', () => {
	const valid = source();
	for (const patch of [{ schemaVersion: 4 }, { raw: {} }, { original: { ...valid.original, mimeType: 'image/png' } },
		{ original: { ...valid.original, recognizedFormat: 'pfm' } }, { original: { ...valid.original, sha256: 'e'.repeat(64) } },
		{ canonical: { ...valid.canonical, hasAlpha: true } }, { canonical: { ...valid.canonical, width: 1 } },
		{ canonical: { ...valid.canonical, frameCount: 2 } }, { assetByteLength: 512 * 1024 * 1024 + 1 },
		{ developed: { width: 8193, height: 1 } }, { developed: { width: 8192, height: 8192 } },
		{ provenance: { ...valid.provenance, developSha256: 'f'.repeat(64) } }]) {
		assert.throws(() => normalizeFramescaperHdrImageSourceCurrentV1({ ...valid, ...patch }));
	}
	assert.equal(normalizeFramescaperHdrImageSourceCurrentV1(source(196 * 1024 * 1024)).original.byteLength, 196 * 1024 * 1024);
});

test('Source5 scalar decode plan proves exact native conversion receipt and budgets encoded-plus-float phases before I/O', () => {
	const input = source(), plan = prepareFramescaperHdrImageOriginalCurrentV1(input);
	assert.equal(plan.originalBytes, 2048); assert.equal(plan.frameBytes, 32);
	assert.ok(plan.decodeWorkingBytes >= BigInt(plan.originalBytes + plan.frameBytes)); assert.ok(plan.decodeWorkingBytes <= 768n * 1024n * 1024n);
	assert.equal(plan.source.schemaVersion, 5); assert.ok(Object.isFrozen(plan));
	assert.throws(() => prepareFramescaperHdrImageOriginalCurrentV1({ ...input, conversionReceiptSha256: '0'.repeat(64) }), /receipt/iu);
	const maximum = source(196 * 1024 * 1024);
	maximum.canonical.width = 4096; maximum.canonical.height = 4096;
	maximum.hdr.descriptor.width = 4096; maximum.hdr.descriptor.height = 4096;
	maximum.conversionReceiptSha256 = digest(encodeFramescaperImageConversionReceiptV1({ schemaVersion: 1, kind: 'hdr-original', hdr: maximum.hdr }));
	const admitted = prepareFramescaperHdrImageOriginalCurrentV1(maximum);
	assert.equal(admitted.frameBytes, 268435456); assert.ok(admitted.decodeWorkingBytes <= 768n * 1024n * 1024n);
});
