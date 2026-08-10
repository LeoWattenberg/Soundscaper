/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyVideoPreviewDisplaySize,
	type VideoPreviewDisplaySizeCache,
} from '../src/common/editor/ui/workspace/video-preview-display-size.ts';
import { normalizeVideoSourceCharacteristics } from '../src/common/editor/video-source-characteristics.ts';

const PAL = Object.freeze({ num: 25, den: 1 });

function anamorphicSource() {
	return {
		kind: 'video',
		id: 'source-1',
		width: 720,
		height: 576,
		frameRate: PAL,
		characteristics: normalizeVideoSourceCharacteristics({
			codedWidth: 720,
			codedHeight: 576,
			pixelAspectRatio: { num: 64, den: 45 },
		}, { rate: PAL }),
	};
}

function entry() {
	return { displayWidth: 0, displayHeight: 0 };
}

test('a decoder that ignored the pixel aspect ratio still presents display geometry', () => {
	const cache: VideoPreviewDisplaySizeCache = new Map();
	const target = entry();
	applyVideoPreviewDisplaySize(cache, anamorphicSource(), target, { videoWidth: 720, videoHeight: 576 });
	assert.deepEqual(target, { displayWidth: 1_024, displayHeight: 576 });
});

test('a decoder that already stretched is not stretched again', () => {
	const cache: VideoPreviewDisplaySizeCache = new Map();
	const target = entry();
	applyVideoPreviewDisplaySize(cache, anamorphicSource(), target, { videoWidth: 1_024, videoHeight: 576 });
	assert.deepEqual(target, { displayWidth: 1_024, displayHeight: 576 });
});

test('an undecoded or unknown entry presents nothing rather than a guess', () => {
	const cache: VideoPreviewDisplaySizeCache = new Map();
	const target = { displayWidth: 7, displayHeight: 9 };
	applyVideoPreviewDisplaySize(cache, anamorphicSource(), target, { videoWidth: 0, videoHeight: 0 });
	assert.deepEqual(target, { displayWidth: 0, displayHeight: 0 });
	applyVideoPreviewDisplaySize(cache, null, target, { videoWidth: 720, videoHeight: 576 });
	assert.deepEqual(target, { displayWidth: 0, displayHeight: 0 });
	applyVideoPreviewDisplaySize(cache, anamorphicSource(), target, null);
	assert.deepEqual(target, { displayWidth: 0, displayHeight: 0 });
});

test('the cache keys on the decoded size and stays bounded', () => {
	const cache: VideoPreviewDisplaySizeCache = new Map();
	const target = entry();
	const source = anamorphicSource();
	applyVideoPreviewDisplaySize(cache, source, target, { videoWidth: 720, videoHeight: 576 });
	applyVideoPreviewDisplaySize(cache, source, target, { videoWidth: 1_024, videoHeight: 576 });
	assert.equal(cache.size, 2);
	applyVideoPreviewDisplaySize(cache, source, target, { videoWidth: 720, videoHeight: 576 });
	assert.equal(cache.size, 2, 'a repeated question is answered from the cache');
	for (let index = 0; index < 70; index += 1) {
		applyVideoPreviewDisplaySize(cache, { ...source, id: `source-${index}` }, target, {
			videoWidth: 720,
			videoHeight: 576,
		});
	}
	assert.ok(cache.size <= 64);
});
