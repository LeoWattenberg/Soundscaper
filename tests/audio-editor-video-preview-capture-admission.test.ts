/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	VIDEO_PREVIEW_CAPTURE_MAXIMUM_ENCODED_BYTES,
	VIDEO_PREVIEW_CAPTURE_MAXIMUM_HEIGHT,
	VIDEO_PREVIEW_CAPTURE_MAXIMUM_RGBA_BYTES,
	VIDEO_PREVIEW_CAPTURE_MAXIMUM_SOURCE_HEIGHT,
	VIDEO_PREVIEW_CAPTURE_MAXIMUM_SOURCE_RGBA_BYTES,
	VIDEO_PREVIEW_CAPTURE_MAXIMUM_SOURCE_WIDTH,
	VIDEO_PREVIEW_CAPTURE_MAXIMUM_WIDTH,
	VideoPreviewEncodedPayloadTooLargeError,
	VideoPreviewSourceGeometryTooLargeError,
	assertVideoPreviewEncodedBytes,
	planVideoPreviewCapture,
} from '../src/common/editor/video-preview-capture-admission.ts';

const MIB = 1024 * 1024;

test('video preview capture admission pins its non-raiseable production ceilings', () => {
	assert.equal(VIDEO_PREVIEW_CAPTURE_MAXIMUM_WIDTH, 640);
	assert.equal(VIDEO_PREVIEW_CAPTURE_MAXIMUM_HEIGHT, 360);
	assert.equal(VIDEO_PREVIEW_CAPTURE_MAXIMUM_RGBA_BYTES, 921_600);
	assert.equal(VIDEO_PREVIEW_CAPTURE_MAXIMUM_ENCODED_BYTES, 4 * MIB);
	assert.equal(VIDEO_PREVIEW_CAPTURE_MAXIMUM_SOURCE_WIDTH, 16_384);
	assert.equal(VIDEO_PREVIEW_CAPTURE_MAXIMUM_SOURCE_HEIGHT, 16_384);
	assert.equal(VIDEO_PREVIEW_CAPTURE_MAXIMUM_SOURCE_RGBA_BYTES, 256 * MIB);
});

test('video preview capture admission reports exact immutable RGBA geometry', () => {
	const plan = planVideoPreviewCapture({ sourceWidth: 1_920, sourceHeight: 1_080 });

	assert.deepEqual(plan, {
		sourceWidth: 1_920,
		sourceHeight: 1_080,
		maximumWidth: 640,
		maximumHeight: 360,
		outputWidth: 640,
		outputHeight: 360,
		maximumEncodedBytes: 4 * MIB,
		sourceRgbaUsefulBinary: {
			bytes: 1_920 * 1_080 * Uint32Array.BYTES_PER_ELEMENT,
			certainty: 'exact',
			scope: 'video-preview-source-rgba-useful-binary',
		},
		rgbaUsefulBinary: {
			bytes: 640 * 360 * Uint32Array.BYTES_PER_ELEMENT,
			certainty: 'exact',
			scope: 'video-preview-capture-rgba-useful-binary',
		},
		browserHeapBytes: null,
		processResidentSetBytes: null,
		garbageCollectionHeadroomBytes: null,
	});
	assert.equal(Object.isFrozen(plan), true);
	assert.equal(Object.isFrozen(plan.sourceRgbaUsefulBinary), true);
	assert.equal(Object.isFrozen(plan.rgbaUsefulBinary), true);
});

test('video preview capture admission preserves ordinary source geometry without upscaling', () => {
	assert.deepEqual(
		planVideoPreviewCapture({ sourceWidth: 320, sourceHeight: 180 }),
		{
			sourceWidth: 320,
			sourceHeight: 180,
			maximumWidth: 640,
			maximumHeight: 360,
			outputWidth: 320,
			outputHeight: 180,
			maximumEncodedBytes: 4 * MIB,
			sourceRgbaUsefulBinary: {
				bytes: 320 * 180 * Uint32Array.BYTES_PER_ELEMENT,
				certainty: 'exact',
				scope: 'video-preview-source-rgba-useful-binary',
			},
			rgbaUsefulBinary: {
				bytes: 320 * 180 * Uint32Array.BYTES_PER_ELEMENT,
				certainty: 'exact',
				scope: 'video-preview-capture-rgba-useful-binary',
			},
			browserHeapBytes: null,
			processResidentSetBytes: null,
			garbageCollectionHeadroomBytes: null,
		},
	);
});

test('lower-only seams use bounded aspect-fit geometry and normalize the encoded cap', () => {
	const square = planVideoPreviewCapture(
		{ sourceWidth: 1_000, sourceHeight: 1_000 },
		{ maximumWidth: 320, maximumHeight: 180, maximumEncodedBytes: 1_024 },
	);
	assert.deepEqual({
		outputWidth: square.outputWidth,
		outputHeight: square.outputHeight,
		maximumWidth: square.maximumWidth,
		maximumHeight: square.maximumHeight,
		maximumEncodedBytes: square.maximumEncodedBytes,
		bytes: square.rgbaUsefulBinary.bytes,
	}, {
		outputWidth: 180,
		outputHeight: 180,
		maximumWidth: 320,
		maximumHeight: 180,
		maximumEncodedBytes: 1_024,
		bytes: 180 * 180 * Uint32Array.BYTES_PER_ELEMENT,
	});

	const extreme = planVideoPreviewCapture({
		sourceWidth: VIDEO_PREVIEW_CAPTURE_MAXIMUM_SOURCE_WIDTH,
		sourceHeight: 1,
	});
	assert.deepEqual(
		[extreme.outputWidth, extreme.outputHeight, extreme.rgbaUsefulBinary.bytes],
		[640, 2, 640 * 2 * Uint32Array.BYTES_PER_ELEMENT],
	);
});

test('video preview capture admission bounds source-frame geometry before decode-seeking', () => {
	const admitted8k = planVideoPreviewCapture({ sourceWidth: 8_192, sourceHeight: 4_320 });
	assert.deepEqual(admitted8k.sourceRgbaUsefulBinary, {
		bytes: 8_192 * 4_320 * Uint32Array.BYTES_PER_ELEMENT,
		certainty: 'exact',
		scope: 'video-preview-source-rgba-useful-binary',
	});
	assert.equal(
		planVideoPreviewCapture({ sourceWidth: 8_192, sourceHeight: 8_192 })
			.sourceRgbaUsefulBinary.bytes,
		VIDEO_PREVIEW_CAPTURE_MAXIMUM_SOURCE_RGBA_BYTES,
	);
	for (const source of [
		{ sourceWidth: VIDEO_PREVIEW_CAPTURE_MAXIMUM_SOURCE_WIDTH + 1, sourceHeight: 1 },
		{ sourceWidth: 1, sourceHeight: VIDEO_PREVIEW_CAPTURE_MAXIMUM_SOURCE_HEIGHT + 1 },
		{ sourceWidth: 8_192, sourceHeight: 8_193 },
	]) {
		assert.throws(
			() => planVideoPreviewCapture(source),
			(error: unknown) => error instanceof VideoPreviewSourceGeometryTooLargeError
				&& /video preview capture source.*(?:maximum|hard limit)/iu.test(error.message),
		);
	}
});

test('video preview capture admission rejects invalid source geometry', () => {
	for (const source of [
		{ sourceWidth: 0, sourceHeight: 1 },
		{ sourceWidth: 1, sourceHeight: 0 },
		{ sourceWidth: 1.5, sourceHeight: 1 },
		{ sourceWidth: Number.MAX_SAFE_INTEGER + 1, sourceHeight: 1 },
		{ sourceWidth: '640', sourceHeight: 360 },
	]) {
		assert.throws(
			() => planVideoPreviewCapture(source as never),
			/video preview capture source/iu,
		);
	}
});

test('video preview capture admission seams cannot raise or invalidate hard limits', () => {
	for (const options of [
		{ maximumWidth: 1 },
		{ maximumWidth: 641 },
		{ maximumWidth: 320.5 },
		{ maximumWidth: null },
		{ maximumHeight: 1 },
		{ maximumHeight: 361 },
		{ maximumHeight: Number.NaN },
		{ maximumEncodedBytes: -1 },
		{ maximumEncodedBytes: 1.5 },
		{ maximumEncodedBytes: 4 * MIB + 1 },
		{ maximumEncodedBytes: null },
		{ maximumEncodedBytes: '1024' },
	]) {
		assert.throws(
			() => planVideoPreviewCapture(
				{ sourceWidth: 640, sourceHeight: 360 },
				options as never,
			),
			/video preview capture maximum/iu,
		);
	}

	assert.equal(
		planVideoPreviewCapture(
			{ sourceWidth: 640, sourceHeight: 360 },
			{ maximumEncodedBytes: 0 },
		).maximumEncodedBytes,
		0,
	);
});

test('encoded preview admission returns an immutable normalized byte result', () => {
	const accepted = assertVideoPreviewEncodedBytes(1_024, 1_024);
	assert.deepEqual(accepted, { byteLength: 1_024, maximumEncodedBytes: 1_024 });
	assert.equal(Object.isFrozen(accepted), true);
	assert.deepEqual(
		assertVideoPreviewEncodedBytes(0, 0),
		{ byteLength: 0, maximumEncodedBytes: 0 },
	);
	assert.deepEqual(
		assertVideoPreviewEncodedBytes(4 * MIB),
		{ byteLength: 4 * MIB, maximumEncodedBytes: 4 * MIB },
	);
});

test('encoded preview admission rejects oversized and malformed byte counts', () => {
	assert.throws(
		() => assertVideoPreviewEncodedBytes(1_025, 1_024),
		(error: unknown) => error instanceof VideoPreviewEncodedPayloadTooLargeError
			&& /exceeds.*1024.*byte/iu.test(error.message),
	);
	assert.throws(
		() => assertVideoPreviewEncodedBytes(1, 0),
		/exceeds.*0.*byte/iu,
	);
	for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '1']) {
		assert.throws(
			() => assertVideoPreviewEncodedBytes(value as never),
			/video preview encoded byte length/iu,
		);
	}
	assert.throws(
		() => assertVideoPreviewEncodedBytes(0, 4 * MIB + 1),
		/video preview capture maximum encoded bytes/iu,
	);
	assert.throws(
		() => assertVideoPreviewEncodedBytes(0, null as never),
		/video preview capture maximum encoded bytes/iu,
	);
});
