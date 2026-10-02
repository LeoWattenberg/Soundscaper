/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	confirmImageImportGesture,
	confirmImageCanonicalBody,
} from '../src/common/editor/image-import-size-warnings.ts';
import { admitImageDecodeWorkload, IMAGE_IMPORT_LIMITS } from '../src/common/editor/image-import-admission.ts';
import { FileSizeWarningRequiredError } from '../src/common/editor/controller/shared/file-size-warning.ts';
import { normalizeFramescaperImageSourceV1 } from '../src/common/editor/timeline-image-model.ts';
import {
	createFramescaperImageFramePackWithWarningsV1,
	openFramescaperImageFramePackV1,
} from '../src/common/editor/timeline-image-frame-pack-v1.ts';

test('image file and batch warning approvals admit all selected bytes without weakening geometry', async () => {
	const fileBytes = IMAGE_IMPORT_LIMITS.maximumFileInputBytes + 1;
	const warnings: string[] = [];
	const admitted = await confirmImageImportGesture({ fileByteLengths: Array<number>(9).fill(fileBytes) }, {
		confirmFileSizeWarning: async (warning) => { warnings.push(warning.label); return true; },
	});
	assert.equal(admitted.totalInputBytes, fileBytes * 9);
	assert.equal(admitted.maximumFileInputBytes, fileBytes);
	assert.equal(warnings.length, 10);
	const base = { sourceByteLength: fileBytes, width: 1, height: 1, precision: 'sdr', frameCount: 1,
		durationMicroseconds: 1, iccBytes: 0, metadataBytes: 0 };
	assert.equal(admitImageDecodeWorkload(base, admitted).sourceByteLength, fileBytes);
	assert.throws(() => admitImageDecodeWorkload({ ...base, width: 8193 }, admitted), { code: 'dimensions' });
});

test('image warning cancellation and missing confirmation port remain recognizable before decoding', async () => {
	const bytes = IMAGE_IMPORT_LIMITS.maximumFileInputBytes + 1;
	await assert.rejects(confirmImageImportGesture({ fileByteLengths: [bytes] }), FileSizeWarningRequiredError);
	await assert.rejects(confirmImageImportGesture({ fileByteLengths: [bytes] }, {
		confirmFileSizeWarning: async () => false,
	}), { name: 'AbortError' });
	await assert.rejects(confirmImageImportGesture({ fileByteLengths: [Number.MAX_SAFE_INTEGER + 1] }, {
		confirmFileSizeWarning: async () => { assert.fail('Invalid byte counts cannot be overridden.'); },
	}), { code: 'file-input-bytes' });
	await assert.rejects(confirmImageImportGesture({ fileByteLengths: [Number.MAX_SAFE_INTEGER, 1] }), /safe/u);
});

test('the canonical image body size threshold can be accepted and still requires exact integer bytes', async () => {
	const bytes = IMAGE_IMPORT_LIMITS.maximumCanonicalBodyBytesPerFile + 1;
	assert.deepEqual(await confirmImageCanonicalBody(bytes, {
		confirmFileSizeWarning: async (warning) => { assert.equal(warning.byteLength, bytes); return true; },
	}), { byteLength: bytes });
	await assert.rejects(confirmImageCanonicalBody(bytes, { confirmFileSizeWarning: async () => false }), { name: 'AbortError' });
	await assert.rejects(confirmImageCanonicalBody(1.5), { code: 'canonical-body-bytes' });
});

test('frame-pack assembly honors byte warnings and persisted large-original metadata remains valid', async () => {
	const warnings: string[] = [];
	const publication = await createFramescaperImageFramePackWithWarningsV1({
		original: Uint8Array.of(1, 2), receipt: {}, width: 1, height: 1, timingMode: 'embedded',
		frames: [{ presentationTicks: 0n, durationTicks: 1n, rgba: Uint8Array.of(0, 0, 0, 255) }],
	}, { maximumOriginalBytes: 1, maximumAssetBytes: 1, confirmFileSizeWarning: async (warning) => {
		warnings.push(warning.label); return true;
	} });
	assert.equal(warnings.length, 2);
	const source = {
		schemaVersion: 1 as const, kind: 'image' as const, id: 'image-one', storageKey: 'image-one', name: 'Image',
		mimeType: 'application/vnd.framescaper.image-asset' as const, contentSha256: publication.contentSha256,
		assetByteLength: publication.assetByteLength,
		original: { fileName: 'image.png', mimeType: 'image/png', recognizedFormat: 'png', byteLength: 2, sha256: publication.originalSha256 },
		canonical: { width: 1, height: 1, hasAlpha: false, frameCount: 1, durationTicks: '1', timingMode: 'embedded' as const },
		conversionReceiptSha256: publication.conversionReceiptSha256,
	};
	const reader = await openFramescaperImageFramePackV1({ source, read: (offset, length) => publication.bytes.slice(offset, offset + length) });
	assert.deepEqual(await reader.readOriginal(), Uint8Array.of(1, 2));
	const largeOriginal = IMAGE_IMPORT_LIMITS.maximumFileInputBytes + 1;
	assert.equal(normalizeFramescaperImageSourceV1({ ...source, assetByteLength: largeOriginal + 100,
		original: { ...source.original, byteLength: largeOriginal } }).original.byteLength, largeOriginal);
	await assert.rejects(createFramescaperImageFramePackWithWarningsV1({
		original: Uint8Array.of(1, 2), receipt: {}, width: 1, height: 1, timingMode: 'embedded',
		frames: [{ presentationTicks: 0n, durationTicks: 1n, rgba: Uint8Array.of(0, 0, 0, 255) }],
	}, { maximumOriginalBytes: 1, confirmFileSizeWarning: async () => false }), { name: 'AbortError' });
});
