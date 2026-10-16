/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FilterCurvePoint } from '../../audacity-effects/filter-curve.ts';

/** The authored gain range is -120..60 dB; its inverse must fit it exactly. */
export function filterCurveCanInvert(points: readonly FilterCurvePoint[]): boolean {
	return points.every(({ gain }) => -gain >= -120 && -gain <= 60);
}

export function invertFilterCurve(points: readonly FilterCurvePoint[]): readonly FilterCurvePoint[] {
	if (!filterCurveCanInvert(points)) throw new RangeError('The curve inverse exceeds the supported gain range.');
	return points.map((point) => ({ ...point, gain: -point.gain }));
}
