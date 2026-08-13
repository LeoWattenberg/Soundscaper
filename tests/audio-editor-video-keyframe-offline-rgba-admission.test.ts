/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	VIDEO_KEYFRAME_OFFLINE_MAXIMUM_RGBA_BYTES,
	planVideoKeyframeOfflineRgba,
} from '../src/common/editor/ui/video-keyframe-offline-rgba-admission.ts';

test('offline RGBA admission owns the exact bounded frame geometry', () => {
	assert.deepEqual(planVideoKeyframeOfflineRgba({ width: 1_280, height: 720 }), {
		width: 1_280,
		height: 720,
		byteLength: VIDEO_KEYFRAME_OFFLINE_MAXIMUM_RGBA_BYTES,
	});
	assert.throws(
		() => planVideoKeyframeOfflineRgba({ width: 1_281, height: 720 }),
		/output width.*hard limit/u,
	);
	assert.throws(
		() => planVideoKeyframeOfflineRgba({ width: 1_280, height: 721 }),
		/output height.*hard limit/u,
	);
});
