/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScheduledParameterLinearRampTransform } from './scheduled-parameter-registry.ts';

/** Native decibel ramps interpolate quality geometrically. Subdivide an
 * authored linear quality ramp until its native approximation stays within
 * the descriptor's quality-factor tolerance throughout every interval.
 */
export const qualityFactorLinearRamp: ScheduledParameterLinearRampTransform = (start, end, tolerance, append) => {
	let points = 0;
	const subdivide = (left: number, right: number, from: number, to: number): void => {
		// Linear interpolation error is bounded by max |Q''| / 8; the native
		// segment is Q(t) = from * exp(t * log(to/from)).
		const error = Math.max(from, to) * Math.log(to / from) ** 2 / 8;
		if (error <= tolerance || from === to) {
			if (++points > 2048) throw new RangeError('A native quality ramp exceeds its bounded subdivision.');
			append(20 * Math.log10(to), right);
			return;
		}
		const middle = (left + right) / 2;
		const quality = (from + to) / 2;
		subdivide(left, middle, from, quality);
		subdivide(middle, right, quality, to);
	};
	subdivide(0, 1, start, end);
};
