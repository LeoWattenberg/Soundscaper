/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ReviewedImageFormat } from './image-format-signature.ts';

/** The active browser route has no verified high-precision normalization recipe. */
export function assertBrowserNativeImagePrecision(bytes: Uint8Array, format: ReviewedImageFormat): void {
	if (format !== 'png' || bytes.byteLength < 33) return;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) return;
	if (bytes[24] === 16) {
		throw new RangeError('High-precision 16-bit PNG requires a verified image normalization route.');
	}
}
