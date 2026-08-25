/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	IMAGE_IMPORT_LIMITS,
	ImageImportAdmissionError,
	admitImageCanonicalBody,
	admitImageDecodeWorkload,
	admitImageImportGesture,
} from '../src/common/editor/image-import-admission.ts';

const MIB = 1024 * 1024;

test('the plan hard limits are one immutable admission contract', () => {
	assert.deepEqual(IMAGE_IMPORT_LIMITS, {
		maximumFilesPerGesture: 64,
		maximumGestureInputBytes: 512 * MIB,
		maximumFileInputBytes: 64 * MIB,
		maximumSidePixels: 8_192,
		maximumSdrPixelsPerFrame: 16_777_216,
		maximumHighPrecisionPixelsPerFrame: 8_388_608,
		maximumFramesPerFile: 4_096,
		maximumDecodedRgbaBytesPerFile: 512 * MIB,
		maximumCanonicalBodyBytesPerFile: 512 * MIB,
		maximumIccBytesPerFile: 4 * MIB,
		maximumMetadataBytesPerFile: 8 * MIB,
		maximumDurationMicrosecondsPerFile: 24 * 60 * 60 * 1_000_000,
		maximumDecodeMillisecondsPerFile: 60_000,
	});
	assert.equal(Object.isFrozen(IMAGE_IMPORT_LIMITS), true);
});

test('gesture admission enforces count, individual, and aggregate input boundaries', () => {
	const admitted = admitImageImportGesture({ fileByteLengths: Array(64).fill(8 * MIB) });
	assert.deepEqual(admitted, {
		fileCount: 64,
		totalInputBytes: 512 * MIB,
	});
	assert.equal(Object.isFrozen(admitted), true);

	assertAdmissionCode(
		() => admitImageImportGesture({ fileByteLengths: [] }),
		'file-count',
	);
	assertAdmissionCode(
		() => admitImageImportGesture({ fileByteLengths: Array(65).fill(1) }),
		'file-count',
	);
	assertAdmissionCode(
		() => admitImageImportGesture({ fileByteLengths: [64 * MIB + 1] }),
		'file-input-bytes',
	);
	assertAdmissionCode(
		() => admitImageImportGesture({ fileByteLengths: [0] }),
		'file-input-bytes',
	);
	assertAdmissionCode(
		() => admitImageImportGesture({ fileByteLengths: Array(9).fill(64 * MIB) }),
		'gesture-input-bytes',
	);
});

test('SDR and high-precision metadata admission derives exact RGBA work', () => {
	const sdr = admitImageDecodeWorkload({
		sourceByteLength: 64 * MIB,
		width: 4_096,
		height: 4_096,
		precision: 'sdr',
		frameCount: 8,
		durationMicroseconds: 24 * 60 * 60 * 1_000_000,
		iccBytes: 4 * MIB,
		metadataBytes: 8 * MIB,
	});
	assert.deepEqual(sdr, {
		sourceByteLength: 64 * MIB,
		width: 4_096,
		height: 4_096,
		precision: 'sdr',
		frameCount: 8,
		durationMicroseconds: 24 * 60 * 60 * 1_000_000,
		iccBytes: 4 * MIB,
		metadataBytes: 8 * MIB,
		pixelsPerFrame: 16_777_216,
		rgbaBytesPerFrame: 64 * MIB,
		totalDecodedRgbaBytes: 512 * MIB,
		decodeDeadlineMilliseconds: 60_000,
	});
	assert.equal(Object.isFrozen(sdr), true);

	const highPrecision = admitImageDecodeWorkload({
		sourceByteLength: 1,
		width: 4_096,
		height: 2_048,
		precision: 'high-precision',
		frameCount: 1,
		durationMicroseconds: 1,
		iccBytes: 0,
		metadataBytes: 0,
	});
	assert.equal(highPrecision.pixelsPerFrame, 8_388_608);
	assert.equal(highPrecision.rgbaBytesPerFrame, 32 * MIB);
});

test('decode admission refuses every independent resource ceiling', () => {
	const base = {
		sourceByteLength: 1,
		width: 1,
		height: 1,
		precision: 'sdr' as const,
		frameCount: 1,
		durationMicroseconds: 1,
		iccBytes: 0,
		metadataBytes: 0,
	};
	const cases = [
		[{ ...base, sourceByteLength: 64 * MIB + 1 }, 'file-input-bytes'],
		[{ ...base, width: 8_193 }, 'dimensions'],
		[{ ...base, height: 8_193 }, 'dimensions'],
		[{ ...base, width: 8_192, height: 4_096 }, 'pixels-per-frame'],
		[{ ...base, precision: 'high-precision', width: 4_096, height: 4_096 }, 'pixels-per-frame'],
		[{ ...base, frameCount: 4_097 }, 'frame-count'],
		[{ ...base, width: 4_096, height: 4_096, frameCount: 9 }, 'decoded-rgba-bytes'],
		[{ ...base, iccBytes: 4 * MIB + 1 }, 'icc-bytes'],
		[{ ...base, metadataBytes: 8 * MIB + 1 }, 'metadata-bytes'],
		[{ ...base, durationMicroseconds: 24 * 60 * 60 * 1_000_000 + 1 }, 'duration'],
		[{ ...base, precision: 'float' }, 'precision'],
	] as const;

	for (const [request, code] of cases) {
		assertAdmissionCode(() => admitImageDecodeWorkload(request as never), code);
	}
});

test('canonical body admission has its own post-encode exact boundary', () => {
	assert.deepEqual(admitImageCanonicalBody(512 * MIB), { byteLength: 512 * MIB });
	assertAdmissionCode(() => admitImageCanonicalBody(0), 'canonical-body-bytes');
	assertAdmissionCode(() => admitImageCanonicalBody(512 * MIB + 1), 'canonical-body-bytes');
});

test('admission reads closed data records without invoking accessors', () => {
	let accessed = false;
	const hostile = Object.defineProperty({}, 'fileByteLengths', {
		enumerable: true,
		get() { accessed = true; return [1]; },
	});
	assertAdmissionCode(() => admitImageImportGesture(hostile as never), 'invalid-request');
	assert.equal(accessed, false);
	assertAdmissionCode(
		() => admitImageImportGesture({ fileByteLengths: [1], extra: true } as never),
		'invalid-request',
	);
	assert.deepEqual(admitImageImportGesture(Object.freeze({
		fileByteLengths: Object.freeze([1]),
	})), { fileCount: 1, totalInputBytes: 1 });
});

function assertAdmissionCode(operation: () => unknown, code: string): void {
	assert.throws(operation, (error: unknown) => (
		error instanceof ImageImportAdmissionError && error.code === code
	));
}
