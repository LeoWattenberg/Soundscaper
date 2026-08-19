/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	VIDEO_KEYFRAME_OFFLINE_MAXIMUM_RGBA_BYTES,
	planVideoKeyframeOfflineRgba,
} from '../src/common/editor/ui/video-keyframe-offline-rgba-admission.ts';
import { VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_BYTES } from '../src/common/editor/video-keyframe-encoder-admission.ts';
import { VIDEO_PREVIEW_MAXIMUM_RENDER_DIMENSION } from '../src/common/editor/ui/video-preview-render-size.js';

test('offline RGBA admission owns the exact bounded frame geometry', () => {
	assert.deepEqual(planVideoKeyframeOfflineRgba({ width: 1_280, height: 720 }), {
		width: 1_280,
		height: 720,
		byteLength: 1_280 * 720 * 4,
	});

	// The renderer answers to the encoder's own 8 MiB frame, not to the automatic
	// canvas. It used to stop at 1280x720 per side, so the vertical delivery this
	// milestone added was admitted by the plan — whose bound is exactly this many
	// bytes — and then refused here, after the delivery report had been written.
	assert.equal(VIDEO_KEYFRAME_OFFLINE_MAXIMUM_RGBA_BYTES, VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_BYTES);
	assert.deepEqual(planVideoKeyframeOfflineRgba({ width: 1_080, height: 1_920 }), {
		width: 1_080,
		height: 1_920,
		byteLength: 1_080 * 1_920 * 4,
	});
	assert.throws(
		() => planVideoKeyframeOfflineRgba({ width: 1_080, height: 1_944 }),
		/exceed the hard limit/u,
		'and the frame the encoder cannot stream is still refused',
	);

	// Each extent still answers to the largest render target a GL context allows.
	assert.throws(
		() => planVideoKeyframeOfflineRgba({ width: VIDEO_PREVIEW_MAXIMUM_RENDER_DIMENSION + 1, height: 2 }),
		/output width.*hard limit/u,
	);
	assert.throws(
		() => planVideoKeyframeOfflineRgba({ width: 2, height: VIDEO_PREVIEW_MAXIMUM_RENDER_DIMENSION + 1 }),
		/output height.*hard limit/u,
	);
	assert.throws(() => planVideoKeyframeOfflineRgba({ width: 0, height: 720 }), /output width.*hard limit/u);
});
