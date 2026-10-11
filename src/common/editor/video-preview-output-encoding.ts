/* SPDX-License-Identifier: AGPL-3.0-only */
import { decodeManagedSdrOutputPixelV1 } from './video-color-management-v27.ts';
import { createManagedSdrLinearByteEncoderV1 } from './video-color-byte-encoding.ts';
let rec709Lookup: Uint8Array | null = null;
/** Canvas display consumes sRGB bytes, independently of the retained finishing output encoding. */
export function videoPreviewSrgbBytes(pixels: Uint8Array<ArrayBuffer>, encoding: 'srgb' | 'rec709'): Uint8Array<ArrayBuffer> {
	if (pixels.byteLength % 4 !== 0) throw new RangeError('Preview output requires complete RGBA pixels.');
	if (encoding === 'srgb') return pixels;
	if (encoding !== 'rec709') throw new RangeError('Preview output encoding is unsupported.');
	if (!rec709Lookup) {
		const encode = createManagedSdrLinearByteEncoderV1('srgb'); rec709Lookup = new Uint8Array(256);
		for (let byte = 0; byte < 256; byte++) rec709Lookup[byte] = encode(decodeManagedSdrOutputPixelV1([byte / 255, 0, 0, 1], 'rec709')[0]);
	}
	const output = pixels.slice();
	for (let offset = 0; offset < pixels.byteLength; offset += 4) for (let channel = 0; channel < 3; channel++) output[offset + channel] = rec709Lookup[pixels[offset + channel]!]!;
	return output;
}
