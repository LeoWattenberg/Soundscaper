/* SPDX-License-Identifier: AGPL-3.0-only */

const MAXIMUM_AUTHORED_SCALE = 100;
const MINIMUM_AUTHORED_SCALE = 0.01;

/** Compare two composed affine scalars, tolerating their round-trip through the matrix. */
export function nearlyEqualVideoFfmpegScalar(left: number, right: number): boolean {
	const scale = Math.max(1, Math.abs(left), Math.abs(right));
	return Math.abs(left - right) <= scale * 1e-9;
}

/**
 * The authored scale bounds are inclusive, and a render description carries the scale
 * only inside its composed affine, so a clip authored exactly at a bound comes back
 * about one unit in the last place outside it once rotation composes in. Admit that,
 * exactly as the orthogonality check admits its own round-trip error, while still
 * refusing a scale that genuinely overshoots.
 */
export function withinAuthoredVideoFfmpegScale(value: number): boolean {
	if (value < MINIMUM_AUTHORED_SCALE
		&& !nearlyEqualVideoFfmpegScalar(value, MINIMUM_AUTHORED_SCALE)) return false;
	return value <= MAXIMUM_AUTHORED_SCALE
		|| nearlyEqualVideoFfmpegScalar(value, MAXIMUM_AUTHORED_SCALE);
}
