/* SPDX-License-Identifier: AGPL-3.0-only */

import { addRationals, multiplyRationals } from '../../timeline-time.ts';
import type { InterpolationAnchor } from '../../interpolation-curve.ts';

/** Seed handles on the existing line, preserving its values and exact time span. */
export function linearVideoKeyframeBezierControls(start: InterpolationAnchor, end: InterpolationAnchor): Readonly<{
	control1: InterpolationAnchor; control2: InterpolationAnchor;
}> {
	const control = (weight: number): InterpolationAnchor => ({
		position: addRationals(
			multiplyRationals(start.position, { num: 3 - weight, den: 3 }),
			multiplyRationals(end.position, { num: weight, den: 3 }),
		),
		value: start.value + (end.value - start.value) * weight / 3,
	});
	return { control1: control(1), control2: control(2) };
}
