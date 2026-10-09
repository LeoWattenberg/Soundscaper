/* SPDX-License-Identifier: AGPL-3.0-only */

/** Unmodified sharp/libvips PNG writer output for an ordinary 16-bit RGB gradient.
 * sharp(Uint16Array samples, {raw:{width:16,height:16,channels:3}})
 *   .toColourspace('rgb16').png(): samples[i] = 10000 + (i % 11) * 73.
 * The owning writer reports ushort/rgb16/16 bits; decoding retains those samples.
 */
export function ordinaryHighPrecisionPng(): Buffer {
	return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQEAIAAADAAbR1AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAXklEQVQ4je3UMRXAIABDwThoXSTZEQNiKgbEIIaa6IKEZunr+ocMNwQ82Th4q+jS9OHq7vVeRWpYuyI17F2RBVJBFsgVWSA2ZIF0IQvkjiwQB7JAmsgCeeG/Cn/+Kh5sZ+59oCpe9QAAAABJRU5ErkJggg==', 'base64');
}
