/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Browser adaptation of EqualizationCurvesList.cpp and EqualizationPanel.cpp,
 * Audacity 5ef610ed23260d6d648175735bb16b32536eb30b (GPL-2.0-or-later,
 * version 3 selected). Authors: Mitch Golden, Vaughan Johnson, Martyn Shaw,
 * Paul Licameli. Adapted for kw.media in 2026.
 */

export interface FilterCurvePoint { readonly frequency: number; readonly gain: number }
export interface FilterCurvePosition { readonly x: number; readonly y: number }
export interface FilterCurveViewport {
	readonly sampleRate: number;
	readonly linearFrequencyScale: boolean;
	readonly minimumDb: number;
	readonly maximumDb: number;
}

/** Audacity interpolates dB in envelope coordinates and holds the end values. */
export function filterCurveGain(
	points: readonly FilterCurvePoint[], frequency: number, linearFrequencyScale = false,
): number {
	if (!points.length) return 0;
	const first = points[0]!;
	const last = points.at(-1)!;
	const at = linearFrequencyScale ? frequency : Math.max(20, frequency);
	if (at <= first.frequency) return first.gain;
	if (at >= last.frequency) return last.gain;
	let low = 0;
	let high = points.length - 1;
	while (high - low > 1) {
		const middle = (low + high) >> 1;
		if (points[middle]!.frequency <= at) low = middle;
		else high = middle;
	}
	const left = points[low]!;
	const right = points[high]!;
	const coordinate = (value: number): number => linearFrequencyScale ? value : Math.log(Math.max(1, value));
	const amount = (coordinate(at) - coordinate(left.frequency))
		/ (coordinate(right.frequency) - coordinate(left.frequency));
	return left.gain + (right.gain - left.gain) * amount;
}

export function filterCurvePosition(point: FilterCurvePoint, viewport: FilterCurveViewport): FilterCurvePosition {
	const nyquist = viewport.sampleRate / 2;
	return {
		x: viewport.linearFrequencyScale ? point.frequency / nyquist
			: Math.log(Math.max(1, point.frequency) / 20) / Math.log(nyquist / 20),
		y: (viewport.maximumDb - point.gain) / (viewport.maximumDb - viewport.minimumDb),
	};
}

export function filterCurvePointAt(at: FilterCurvePosition, viewport: FilterCurveViewport): FilterCurvePoint {
	const nyquist = viewport.sampleRate / 2;
	return {
		frequency: viewport.linearFrequencyScale ? at.x * nyquist : 20 * (nyquist / 20) ** at.x,
		gain: viewport.maximumDb - at.y * (viewport.maximumDb - viewport.minimumDb),
	};
}

/** Preserve slopes outside the dB view; the renderer clips the polyline. */
export function filterCurvePolyline(points: readonly FilterCurvePoint[], viewport: FilterCurveViewport): string {
	const start = viewport.linearFrequencyScale ? 0 : 20;
	const end = viewport.sampleRate / 2;
	const visible = [
		{ frequency: start, gain: filterCurveGain(points, start, viewport.linearFrequencyScale) },
		...points.filter(({ frequency }) => frequency > start && frequency < end),
		{ frequency: end, gain: filterCurveGain(points, end, viewport.linearFrequencyScale) },
	];
	return visible.map((point) => {
		const at = filterCurvePosition(point, viewport);
		return `${at.x.toFixed(6)},${at.y.toFixed(6)}`;
	}).join(' ');
}
