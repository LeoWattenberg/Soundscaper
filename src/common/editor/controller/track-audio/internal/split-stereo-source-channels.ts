/* SPDX-License-Identifier: AGPL-3.0-only */

/** Extract the audible stereo channels, including a mono clip's equal-power upmix. */
export function splitStereoSourceChannels(channels: readonly Float32Array[]): readonly [Float32Array, Float32Array] {
	const left = channels[0];
	if (!left) throw new RangeError('Stereo channel extraction requires source audio.');
	if (channels.length > 1) return [left, channels[1]!];
	const centered = Float32Array.from(left, sample => sample * Math.SQRT1_2);
	return [centered, centered];
}
