/* SPDX-License-Identifier: AGPL-3.0-only */
import {
	filterCurvePointAt,
	type FilterCurvePoint,
	type FilterCurvePosition,
	type FilterCurveViewport,
} from '../../audacity-effects/filter-curve.ts';

/** A drag edits a snapshot; only completion yields a change to persist. */
export function createFilterCurveGesture() {
	let snapshot: readonly FilterCurvePoint[] | null = null;
	let working: readonly FilterCurvePoint[] = [];
	let source: readonly FilterCurvePoint[] = [];
	let selected = 0;
	let viewport: FilterCurveViewport;
	const move = (at: FilterCurvePosition): readonly FilterCurvePoint[] | null => {
		if (!snapshot) return null;
		if (at.x < 0 || at.x > 1 || at.y < 0 || at.y > 1) {
			working = source.filter((_, index) => index !== selected);
			return working;
		}
		const point = filterCurvePointAt(at, viewport);
		const minimum = source[selected - 1]?.frequency;
		const maximum = source[selected + 1]?.frequency;
		const frequency = Math.max(minimum === undefined ? 0 : minimum + 1e-6,
			Math.min(maximum === undefined ? viewport.sampleRate / 2 : maximum - 1e-6, point.frequency));
		working = source.map((entry, index) => index === selected ? { frequency, gain: point.gain } : entry);
		return working;
	};
	return {
		begin(points: readonly FilterCurvePoint[], index: number | null, at: FilterCurvePosition,
			view: FilterCurveViewport): readonly FilterCurvePoint[] {
			snapshot = points;
			viewport = view;
			const point = filterCurvePointAt(at, view);
			const existing = points.findIndex(({ frequency }) => Math.abs(frequency - point.frequency) < 1e-6);
			selected = index ?? (existing < 0 ? points.length : existing);
			source = index === null && existing < 0 ? [...points, point] : points;
			source = [...source].sort((left, right) => left.frequency - right.frequency);
			if (index === null && existing < 0) selected = source.findIndex((entry) => entry === point);
			working = source;
			return working;
		},
		move,
		complete(): readonly FilterCurvePoint[] | null {
			if (!snapshot) return null;
			snapshot = null;
			return working;
		},
		cancel(): readonly FilterCurvePoint[] | null {
			const original = snapshot;
			snapshot = null;
			return original;
		},
	};
}
