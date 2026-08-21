/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	decodedRgbaMatchesOracle,
	videoRetimePreviewMedia,
} from './browser/fixtures/video-retime-preview-media.js';

test('the VFR decoder oracle admits only its documented per-channel conversion variance', () => {
	const [red, green, blue, yellow] = videoRetimePreviewMedia.pixelOracle;
	assert.equal(videoRetimePreviewMedia.decoderChannelTolerance, 2);
	assert.equal(decodedRgbaMatchesOracle([239, 16, 16, 255], red.centerRgba), true);
	assert.equal(decodedRgbaMatchesOracle([17, 240, 17, 255], green.centerRgba), true);
	assert.equal(decodedRgbaMatchesOracle([16, 16, 240, 255], blue.centerRgba), true);
	assert.equal(decodedRgbaMatchesOracle([240, 240, 16, 255], yellow.centerRgba), true);

	assert.equal(decodedRgbaMatchesOracle([236, 16, 17, 255], red.centerRgba), false);
	assert.equal(decodedRgbaMatchesOracle([239, 16, 17, 254], red.centerRgba), false);
	assert.equal(decodedRgbaMatchesOracle([239, 16, 17, 252], red.centerRgba), false);
	assert.equal(decodedRgbaMatchesOracle([239, 16, 17], red.centerRgba), false);
	assert.equal(decodedRgbaMatchesOracle([239, 16, Number.NaN, 255], red.centerRgba), false);
});
