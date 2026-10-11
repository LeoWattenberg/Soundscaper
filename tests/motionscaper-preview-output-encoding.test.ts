/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { videoPreviewSrgbBytes } from '../src/common/editor/video-preview-output-encoding.ts';
test('finishing preview converts declared Rec709 midtones to sRGB without changing straight alpha or retained output', () => {
	const original = new Uint8Array([74, 29, 138, 128, 0, 255, 0, 255]); const retained = original.slice();
	assert.deepEqual(videoPreviewSrgbBytes(original, 'rec709'), new Uint8Array([89, 45, 149, 128, 0, 255, 0, 255]));
	assert.deepEqual(original, retained); assert.equal(videoPreviewSrgbBytes(original, 'srgb'), original);
	assert.throws(() => videoPreviewSrgbBytes(new Uint8Array(3), 'rec709'), /RGBA/u);
});
