/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeCartMetadata, type CartMetadata, type CartMetadataInput } from './cart-metadata.ts';

/** CART post timers count sample periods in the associated audio's current clock. */
export function scaleCartPostTimers(
	input: CartMetadataInput | null | undefined,
	inputSampleRate: number,
	outputSampleRate: number,
): CartMetadata | null {
	if (input == null) return null;
	for (const rate of [inputSampleRate, outputSampleRate]) {
		if (!Number.isSafeInteger(rate) || rate <= 0) throw new RangeError('CART sample rates must be positive safe integers.');
	}
	const metadata = normalizeCartMetadata(input);
	const denominator = BigInt(inputSampleRate);
	const postTimers = metadata.postTimers.map(timer => {
		const numerator = BigInt(timer.value) * BigInt(outputSampleRate);
		const value = (numerator + denominator / 2n) / denominator;
		if (value > 0xffff_ffffn) throw new RangeError('Converted CART post timer exceeds unsigned 32-bit samples.');
		return { usage: timer.usage, value: Number(value) };
	});
	return normalizeCartMetadata({ ...metadata, postTimers });
}
