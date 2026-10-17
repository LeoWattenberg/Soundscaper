/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	decodePinnedJpegRgbFrame,
	decodePinnedVideoRgbFrame,
	readRgbPixel,
} from './browser/helpers/pinned-video-frame-decoder.mjs';
import { videoSourceGeometryMedia } from './browser/fixtures/video-source-geometry-media.js';

const ROTATED_ANAMORPHIC = videoSourceGeometryMedia.find(
	({ id }) => id === 'geometry-rotated-anamorphic-mp4-v1',
);

test('the pinned decoder reads an upright frame without relying on browser compositor readback', async () => {
	assert.ok(ROTATED_ANAMORPHIC);
	const decoded = await decodePinnedVideoRgbFrame(ROTATED_ANAMORPHIC.file.buffer);

	assert.deepEqual({ width: decoded.width, height: decoded.height }, { width: 144, height: 192 });
	assert.equal(decoded.rgb.byteLength, decoded.width * decoded.height * 3);
	assert.deepEqual(readRgbPixel(decoded, { x: 36, y: 48 }), [0, 254, 0]);
	assert.deepEqual(readRgbPixel(decoded, { x: 108, y: 48 }), [253, 253, 253]);
	assert.deepEqual(readRgbPixel(decoded, { x: 36, y: 144 }), [252, 0, 0]);
	assert.deepEqual(readRgbPixel(decoded, { x: 108, y: 144 }), [0, 0, 253]);
});

test('RGB pixel reads reject malformed geometry and out-of-bounds coordinates', () => {
	assert.throws(
		() => readRgbPixel({ rgb: Uint8Array.of(0, 0, 0), width: 0, height: 1 }, { x: 0, y: 0 }),
		/width/u,
	);
	assert.throws(
		() => readRgbPixel({ rgb: Uint8Array.of(0, 0, 0), width: 1, height: 1 }, { x: 1, y: 0 }),
		/coordinates/u,
	);
});

// Captured from the exact native Chromium encoder at quality 0.9: opaque
// one-column 1x2 sRGB red137. Native ImageBitmap readback is red136 for both
// pixels; this independent literal exposes the pinned scaler's narrow-420 path.
const CHROMIUM_ONE_COLUMN_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCFwAJWr//Z', 'base64');

test('one-column native JPEG bytes decode to the independently observed RGB pixels', async () => {
	const decoded = await decodePinnedJpegRgbFrame(CHROMIUM_ONE_COLUMN_JPEG);
	assert.deepEqual({ width: decoded.width, height: decoded.height }, { width: 1, height: 2 });
	assert.deepEqual(Array.from(decoded.rgb), [136, 0, 0, 136, 0, 0]);
});

test('the named JPEG path refuses video input while the video decoder keeps its own recipe', async () => {
	assert.ok(ROTATED_ANAMORPHIC);
	await assert.rejects(decodePinnedJpegRgbFrame(ROTATED_ANAMORPHIC.file.buffer), /requires JPEG bytes/u);
});
