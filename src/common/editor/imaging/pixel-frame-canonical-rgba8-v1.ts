/* SPDX-License-Identifier: AGPL-3.0-only */

import { readPixelFrameV1 } from './pixel-frame-contract-v1.ts';

/** Own native RGBA8 bytes and retain the existing zero-RGB convention at alpha zero. */
export function snapshotCanonicalRgba8V1(value: unknown, width: number, height: number): Uint8Array<ArrayBuffer> {
	const frame = readPixelFrameV1({ descriptor: { schemaVersion: 1, width, height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: value });
	if (frame.descriptor.sampleFormat !== 'unorm8') throw new TypeError('Canonical RGBA8 requires UNORM8 samples.');
	const output = new Uint8Array(new Uint8Array(frame.pixels.buffer, frame.pixels.byteOffset, frame.pixels.byteLength));
	for (let offset = 0; offset < output.byteLength; offset += 4) {
		if (output[offset + 3] !== 0) continue;
		output[offset] = 0; output[offset + 1] = 0; output[offset + 2] = 0;
	}
	return output;
}
