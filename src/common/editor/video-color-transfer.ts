/* SPDX-License-Identifier: AGPL-3.0-only */

/** Shared SDR transfer functions for encoded video channels and linear compositing. */
export function decodeVideoChannel(value: number, space: 'srgb' | 'rec709'): number {
	return space === 'srgb' ? (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
		: (value < 0.081 ? value / 4.5 : ((value + 0.099) / 1.099) ** (1 / 0.45));
}
export function encodeVideoChannel(value: number, space: 'srgb' | 'rec709'): number {
	return space === 'srgb' ? (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055)
		: (value < 0.018 ? value * 4.5 : 1.099 * value ** 0.45 - 0.099);
}
