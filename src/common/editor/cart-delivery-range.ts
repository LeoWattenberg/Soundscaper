/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeCartMetadata, type CartMetadata, type CartMetadataInput } from './cart-metadata.ts';
import { scaleCartPostTimers } from './cart-sample-clock.ts';

interface CartDeliveryRange {
	readonly startFrame: number;
	readonly endFrame: number;
}

/** CART cues count samples from this delivered file's head, not the project's head. */
export function cartForDeliveryRange(
	input: CartMetadataInput | null | undefined,
	range: CartDeliveryRange,
	inputSampleRate: number,
	outputSampleRate: number,
): CartMetadata | null {
	if (input == null) return null;
	if (!Number.isSafeInteger(range.startFrame) || range.startFrame < 0
		|| !Number.isSafeInteger(range.endFrame) || range.endFrame < range.startFrame) {
		throw new RangeError('The CART delivery range must contain ordered non-negative sample frames.');
	}
	const metadata = normalizeCartMetadata(input);
	const postTimers = metadata.postTimers
		// End-of-data cues can legitimately name the boundary at the file's end.
		.filter(timer => timer.value >= range.startFrame && timer.value <= range.endFrame)
		.map(timer => ({ usage: timer.usage, value: timer.value - range.startFrame }));
	return scaleCartPostTimers({ ...metadata, postTimers }, inputSampleRate, outputSampleRate);
}
