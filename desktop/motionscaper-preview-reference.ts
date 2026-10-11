/* SPDX-License-Identifier: AGPL-3.0-only */
/** Test-only native delivery to canvas boundary; native analytical checks keep their output encoding. */
import { decodeMotionChannel, encodeMotionChannel } from '../src/common/editor/motion-surface.ts';
import { videoPreviewSrgbBytes } from '../src/common/editor/video-preview-output-encoding.ts';
export function motionNativePreviewMattePixel(rgba: readonly number[], outputSpace: 'srgb' | 'rec709'): Uint8Array<ArrayBuffer> {
	if (rgba.length !== 4 || rgba.some(value => !Number.isFinite(value)) || rgba[3]! < 0 || rgba[3]! > 1) throw new RangeError('Native preview pixel is invalid.');
	const matte = new Uint8Array(4); matte[3] = 255;
	for (let channel = 0; channel < 3; channel++) {
		const linear = decodeMotionChannel(rgba[channel]!, outputSpace) * rgba[3]!;
		matte[channel] = Math.round(Math.min(1, Math.max(0, encodeMotionChannel(linear, outputSpace))) * 255);
	}
	return videoPreviewSrgbBytes(matte, outputSpace);
}
