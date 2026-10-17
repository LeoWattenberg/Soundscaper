/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	applyPreparedManagedSdrGradeStackLinearChannelsV1,
	encodeManagedSdrLinearChannelsV1,
	type PreparedManagedSdrGradeStackV1,
	type VideoColorOutputSpaceV1,
} from './video-color-management-v27.ts';

/** Prepare the canonical scalar transfer once, without allocating a tuple per pixel. */
export function createManagedSdrLinearByteEncoderV1(
	output: VideoColorOutputSpaceV1,
): (channel: number) => number {
	const transfer = output === 'linear-rec709-d65' ? (value: number) => value
		: output === 'srgb' ? (value: number) => (value <= 0.0031308
			? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055)
			: output === 'rec709' ? (value: number) => (value < 0.018
				? value * 4.5 : 1.099 * value ** 0.45 - 0.099) : null;
	if (!transfer) throw new RangeError('The managed SDR output space is unsupported.');
	return (channel) => {
		if (!Number.isFinite(channel) || channel < 0 || channel > 1) {
			throw new RangeError('The managed SDR channel must be between zero and one.');
		}
		return Math.round(transfer(channel) * 255);
	};
}

/** Ungraded byte channels are independent: evaluate each through the oracle once per frame. */
export function createManagedSdrUngradedByteLookupV1(
	prepared: PreparedManagedSdrGradeStackV1,
	output: VideoColorOutputSpaceV1,
): Uint8Array<ArrayBuffer> | null {
	if (prepared.grades.length !== 0) return null;
	const lookup = new Uint8Array(256);
	for (let byte = 0; byte <= 255; byte += 1) {
		const value = byte / 255;
		const linear = applyPreparedManagedSdrGradeStackLinearChannelsV1(prepared, value, value, value, 1);
		lookup[byte] = Math.round(encodeManagedSdrLinearChannelsV1(
			linear[0], linear[1], linear[2], linear[3], output,
		)[0] * 255);
	}
	return lookup;
}

/** Apply an admitted frame's byte channels with exactly the prepared SDR color semantics. */
export function applyPreparedManagedSdrByteFrameV1(
	prepared: PreparedManagedSdrGradeStackV1,
	frame: Readonly<{ width: number; height: number; pixels: Uint8Array }>,
	output: VideoColorOutputSpaceV1,
	signal?: AbortSignal,
): Uint8Array<ArrayBuffer> {
	const lookup = createManagedSdrUngradedByteLookupV1(prepared, output);
	const pixels = new Uint8Array(frame.pixels.byteLength);
	try {
		for (let y = 0; y < frame.height; y += 1) {
			if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason
				: new DOMException('The V13 finishing operation was aborted.', 'AbortError');
			for (let x = 0; x < frame.width; x += 1) {
				const offset = (y * frame.width + x) * 4;
				if (lookup) {
					pixels[offset] = lookup[frame.pixels[offset]!]!;
					pixels[offset + 1] = lookup[frame.pixels[offset + 1]!]!;
					pixels[offset + 2] = lookup[frame.pixels[offset + 2]!]!;
					pixels[offset + 3] = frame.pixels[offset + 3]!;
					continue;
				}
				const linear = applyPreparedManagedSdrGradeStackLinearChannelsV1(prepared,
					frame.pixels[offset]! / 255, frame.pixels[offset + 1]! / 255,
					frame.pixels[offset + 2]! / 255, frame.pixels[offset + 3]! / 255);
				const value = output === 'linear-rec709-d65' ? linear : encodeManagedSdrLinearChannelsV1(
					linear[0], linear[1], linear[2], linear[3], output,
				);
				for (let channel = 0; channel < 4; channel += 1) {
					pixels[offset + channel] = Math.round(value[channel]! * 255);
				}
			}
		}
		return pixels;
	} catch (error) {
		pixels.fill(0);
		throw error;
	}
}
