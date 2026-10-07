/* SPDX-License-Identifier: AGPL-3.0-only */

import { scaleCartPostTimers } from './cart-sample-clock.ts';
import { normalizeCartMetadata, type CartMetadata, type CartMetadataInput } from './cart-metadata.ts';

/** Promote source-relative CART timers into the clock and origin of the receiving timeline. */
export function cartMetadataAtImportOrigin(
	input: CartMetadataInput,
	sourceSampleRate: number,
	projectSampleRate: number,
	timelineStartFrame: number,
): CartMetadata {
	if (!Number.isSafeInteger(timelineStartFrame) || timelineStartFrame < 0) {
		throw new RangeError('CART import origin must be a non-negative safe sample frame.');
	}
	const scaled = scaleCartPostTimers(input, sourceSampleRate, projectSampleRate)!;
	const origin = BigInt(timelineStartFrame);
	const postTimers = scaled.postTimers.map(timer => {
		const value = origin + BigInt(timer.value);
		if (value > 0xffff_ffffn) throw new RangeError('Placed CART post timer exceeds unsigned 32-bit samples.');
		return { usage: timer.usage, value: Number(value) };
	});
	return normalizeCartMetadata({ ...scaled, postTimers });
}
