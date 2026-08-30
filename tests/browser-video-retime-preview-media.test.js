/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	decodedRgbaMatchesOracle,
	videoRetimePreviewMedia,
} from './browser/fixtures/video-retime-preview-media.js';

test('the VFR fixture uses a broadly supported 8-bit AVC profile', () => {
	const bytes = videoRetimePreviewMedia.file.buffer;
	const avcConfigurationOffset = bytes.indexOf(Buffer.from('avcC'));
	assert.notEqual(avcConfigurationOffset, -1);
	assert.equal(bytes[avcConfigurationOffset + 4], 1, 'AVCDecoderConfigurationRecord version');
	assert.equal(bytes[avcConfigurationOffset + 5], 66, 'Constrained Baseline profile_idc');

	const arguments_ = videoRetimePreviewMedia.generation.arguments;
	const profileOption = arguments_.indexOf('-profile:v');
	assert.notEqual(profileOption, -1);
	assert.equal(arguments_[profileOption + 1], 'baseline');
	const pixelFormatOption = arguments_.indexOf('-pix_fmt');
	assert.notEqual(pixelFormatOption, -1);
	assert.equal(arguments_[pixelFormatOption + 1], 'yuv420p');
	const crfOption = arguments_.indexOf('-crf');
	assert.notEqual(crfOption, -1);
	assert.notEqual(arguments_[crfOption + 1], '0', 'lossless x264 selects High 4:4:4 Predictive');
});

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
