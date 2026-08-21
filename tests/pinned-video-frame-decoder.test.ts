/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
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

	assert.deepEqual({ width: decoded.width, height: decoded.height }, { width: 24, height: 32 });
	assert.equal(decoded.rgb.byteLength, decoded.width * decoded.height * 3);
	assert.deepEqual(readRgbPixel(decoded, { x: 6, y: 8 }), [0, 253, 0]);
	assert.deepEqual(readRgbPixel(decoded, { x: 18, y: 8 }), [253, 253, 253]);
	assert.deepEqual(readRgbPixel(decoded, { x: 6, y: 24 }), [252, 0, 0]);
	assert.deepEqual(readRgbPixel(decoded, { x: 18, y: 24 }), [0, 0, 253]);
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
