/* SPDX-License-Identifier: GPL-3.0-only */
/* Audacity EQ presentation adaptations; source attribution remains in the owning editors. */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { filterCurvePointAt, filterCurvePosition, filterCurvePolyline, type FilterCurvePoint, type FilterCurveViewport } from '../../audacity-effects/filter-curve.ts';

export function useGraphicEqGrid(minimum: number, maximum: number) {
	return useMemo(() => {
		const ticks = [];
		for (let gain = Math.ceil(minimum / 6) * 6; gain <= maximum; gain += 6) ticks.push({ gain, top: `${String((maximum - gain) / (maximum - minimum) * 100)}%` });
		return ticks;
	}, [minimum, maximum]);
}

export function useFilterEqGrid(viewport: FilterCurveViewport) {
	return useMemo(() => {
		const nyquist = viewport.sampleRate / 2;
		const candidates = viewport.linearFrequencyScale ? Array.from({ length: 7 }, (_, index) => index * nyquist / 6)
			: [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].filter(frequency => frequency < nyquist).concat(nyquist);
		const ticks = candidates.reduceRight<number[]>((kept, frequency) => {
			const x = filterCurvePosition({ frequency, gain: 0 }, viewport).x;
			const next = kept.length ? filterCurvePosition({ frequency: kept[0]!, gain: 0 }, viewport).x : 2;
			if (next - x >= 0.08) kept.unshift(frequency);
			return kept;
		}, []);
		const frequencies = ticks.map(frequency => ({ frequency, x: 56 + filterCurvePosition({ frequency, gain: 0 }, viewport).x * 568,
			label: frequency >= 1000 ? `${String(Number((frequency / 1000).toFixed(1)))}k` : String(Math.round(frequency)) }));
		const gains = Array.from({ length: 7 }, (_, index) => {
			const gain = viewport.maximumDb - index * (viewport.maximumDb - viewport.minimumDb) / 6;
			return { gain, y: 16 + filterCurvePosition({ frequency: 20, gain }, viewport).y * 244 };
		});
		return { frequencies, gains, zeroY: 16 + filterCurvePosition({ frequency: 20, gain: 0 }, viewport).y * 244 };
	}, [viewport]);
}

export function useFilterEqPolyline(points: readonly FilterCurvePoint[], viewport: FilterCurveViewport) {
	return useMemo(() => filterCurvePolyline(points, viewport).split(' ').map(pair => {
		const [x, y] = pair.split(',').map(Number);
		return `${String(56 + x! * 568)},${String(16 + y! * 244)}`;
	}).join(' '), [points, viewport]);
}

export function useFilterResponseFrequencies(sampleRate: number, linearFrequencyScale: boolean) {
	return useMemo(() => Array.from({ length: 257 }, (_, index) => filterCurvePointAt({ x: index / 256, y: 0 }, {
		sampleRate, linearFrequencyScale, minimumDb: -30, maximumDb: 30,
	}).frequency), [sampleRate, linearFrequencyScale]);
}

/** Gestures consume every raw sample; only their React draft publication is coalesced. */
export function useEqDraftFrame<Value>(setDraft: (value: Value) => void) {
	const pending = useRef<{ value: Value; frame: number } | null>(null);
	const setter = useRef(setDraft); setter.current = setDraft;
	const cancel = useCallback(() => {
		if (pending.current) cancelAnimationFrame(pending.current.frame);
		pending.current = null;
	}, []);
	useEffect(() => cancel, [cancel]);
	const publish = useCallback((value: Value) => {
		if (typeof requestAnimationFrame !== 'function') { setter.current(value); return; }
		if (pending.current) { pending.current.value = value; return; }
		const frame = requestAnimationFrame(() => {
			const sample = pending.current; pending.current = null;
			if (sample) setter.current(sample.value);
		});
		pending.current = { value, frame };
	}, []);
	return { publish, cancel };
}
