/* SPDX-License-Identifier: AGPL-3.0-only */

import { admitPixelFrameV1 } from './pixel-frame-admission-v1.ts';
import { readPixelFrameV1, type PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';
import { createManagedSdrLinearByteEncoderV1 } from '../video-color-byte-encoding.ts';
import { decodeManagedSdrOutputPixelV1 } from '../video-color-management-v27.ts';

const CHECK = AbortSignal.prototype.throwIfAborted;
const BUFFER_SIZE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const CHUNK_BYTES = 256 * 1024;

/** Adjusted pixels belong to the enclosing frame stage. Borrow the incoming
 * plane/coverage, interpolate straight linear RGB in place and preserve input
 * alpha. Coverage endpoints retain literal bytes, including hidden RGB. */
export async function blendImageDevelopMaskedAdjustmentV1(sourceValue: unknown, adjustedValue: unknown,
	coverageValue: unknown, limits: PixelFrameLimitsV1, signal?: AbortSignal): Promise<void> {
	const check = () => { if (signal !== undefined) Reflect.apply(CHECK, signal, []); };
	check();
	const source = readPixelFrameV1(sourceValue, limits), adjusted = readPixelFrameV1(adjustedValue, limits);
	admitPixelFrameV1(source.descriptor, { limits }); admitPixelFrameV1(adjusted.descriptor, { limits });
	if (source.descriptor.width !== adjusted.descriptor.width || source.descriptor.height !== adjusted.descriptor.height) throw new RangeError('Masked adjustments require unchanged geometry.');
	if (!(coverageValue instanceof Uint8Array) || Object.getPrototypeOf(coverageValue) !== Uint8Array.prototype
		|| ['buffer', 'byteLength', 'byteOffset', 'length'].some(key => Object.hasOwn(coverageValue, key))
		|| !(coverageValue.buffer instanceof ArrayBuffer) || coverageValue.byteLength !== source.descriptor.width * source.descriptor.height) {
		throw new RangeError('Mask coverage must be one native byte per admitted pixel.');
	}
	const coverage = coverageValue;
	const decoded = new Float64Array(256), encode = createManagedSdrLinearByteEncoderV1('srgb');
	for (let byte = 0; byte < decoded.length; byte++) decoded[byte] = decodeManagedSdrOutputPixelV1([byte / 255, 0, 0, 1], 'srgb')[0];
	const original = source.pixels, output = adjusted.pixels;
	const checkBuffers = () => {
		check(); if (![original.buffer, output.buffer, coverage.buffer].every(buffer => Number(Reflect.apply(BUFFER_SIZE, buffer, [])) > 0)) throw new RangeError('Masked adjustment borrowed storage was detached.');
	};
	try {
		for (let start = 0; start < output.length; start += CHUNK_BYTES) {
			checkBuffers(); const end = Math.min(output.length, start + CHUNK_BYTES);
			for (let offset = start; offset < end; offset += 4) {
				const amount = coverage[offset / 4]!;
				if (amount === 0) { for (let channel = 0; channel < 3; channel++) output[offset + channel] = original[offset + channel]!; }
				else if (amount !== 255) {
					const weight = amount / 255;
					for (let channel = 0; channel < 3; channel++) {
						const before = decoded[original[offset + channel]!]!, after = decoded[output[offset + channel]!]!;
						output[offset + channel] = encode(before + weight * (after - before));
					}
				}
				output[offset + 3] = original[offset + 3]!;
			}
			if (end < output.length) { await new Promise<void>(resolve => { setTimeout(resolve, 0); }); checkBuffers(); }
		}
		checkBuffers();
	} finally { decoded.fill(0); }
}
