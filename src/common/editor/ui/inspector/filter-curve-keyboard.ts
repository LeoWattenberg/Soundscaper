/* SPDX-License-Identifier: AGPL-3.0-only */

import { filterCurvePointAt, filterCurvePosition, type FilterCurvePoint,
	type FilterCurveViewport } from '../../audacity-effects/filter-curve.ts';

/** Keyboard edits change authored coordinates; display clipping cannot change the other axis. */
export function moveFilterCurvePointByKey(points: readonly FilterCurvePoint[], index: number,
	key: string, shift: boolean, viewport: FilterCurveViewport): readonly FilterCurvePoint[] {
	const original = points[index];
	if (!original) return points;
	let next: FilterCurvePoint;
	if (key === 'ArrowUp' || key === 'ArrowDown') {
		const delta = (shift ? 1 : 0.1) * (key === 'ArrowUp' ? 1 : -1);
		next = { ...original, gain: Math.max(-120, Math.min(60, original.gain + delta)) };
	} else if (key === 'ArrowLeft' || key === 'ArrowRight') {
		const at = filterCurvePosition(original, viewport);
		const delta = (shift ? 0.025 : 0.005) * (key === 'ArrowRight' ? 1 : -1);
		const frequency = filterCurvePointAt({ ...at, x: Math.max(0, Math.min(1, at.x + delta)) }, viewport).frequency;
		const minimum = points[index - 1]?.frequency;
		const maximum = points[index + 1]?.frequency;
		next = { ...original, frequency: Math.max(minimum === undefined ? 0 : minimum + 1e-6,
			Math.min(maximum === undefined ? viewport.sampleRate / 2 : maximum - 1e-6, frequency)) };
	} else return points;
	if (next.frequency === original.frequency && next.gain === original.gain) return points;
	return points.map((point, entry) => entry === index ? next : point);
}
