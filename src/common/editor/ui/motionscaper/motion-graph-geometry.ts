/* SPDX-License-Identifier: AGPL-3.0-only */

import { compileMotionCurveMetrics } from '../../motion-curve-metrics.ts';
import { compareRationals, normalizeRational, type Rational } from '../../timeline-time.ts';
import { motionPropertyChannel, type MotionNumericProperty } from './motion-property-ui.ts';
export type MotionGraphMode = 'value' | 'speed';
export const graphNumber = (value: Rational): number => value.num / value.den;
export const graphFrame = (value: number): Rational => normalizeRational({ num: Math.round(value * 1000), den: 1000 });
export interface MotionGraphPoint { readonly frame: number; readonly value: number | null }
export interface MotionGraphHandle { readonly segment: number; readonly handle: 1 | 2; readonly position: Rational; readonly frame: number; readonly value: number; readonly anchorFrame: number; readonly anchorValue: number }
export function motionGraphGeometry(property: MotionNumericProperty, channel: number, duration: number, frameRate: Rational, mode: MotionGraphMode) {
	const { curve, value } = motionPropertyChannel(property, channel); const metrics = compileMotionCurveMetrics(curve, value);
	const maximumFrame = Math.max(duration, ...curve?.anchors.map((anchor) => graphNumber(anchor.position)) ?? []);
	const key = (position: Rational) => `${position.num}/${position.den}`;
	const positions = [...new Map([...Array.from({ length: 161 }, (_, index) => graphFrame(maximumFrame * index / 160)), ...curve?.anchors.map((anchor) => anchor.position) ?? []].map((position) => [key(position), position])).values()].sort(compareRationals);
	const sample = (position: Rational): number | null => { const slope = mode === 'speed' ? metrics.slopeAt(position) : null; return mode === 'value' ? metrics.valueAt(position) : slope === null ? null : slope * graphNumber(frameRate); };
	const points: MotionGraphPoint[] = positions.flatMap((position) => {
		const frame = graphNumber(position), index = curve?.anchors.findIndex((anchor) => compareRationals(anchor.position, position) === 0) ?? -1;
		const jump = mode === 'value' && index > 0 && curve?.segments[index - 1]?.kind === 'hold' ? [{ frame, value: curve.anchors[index - 1]!.value }] : [];
		return [...jump, { frame, value: sample(position) }];
	});
	const handles: MotionGraphHandle[] = curve?.segments.flatMap((shape, segment) => shape.kind !== 'bezier' ? [] : ([1, 2] as const).flatMap((handle) => {
		const control = handle === 1 ? shape.control1 : shape.control2; const anchor = curve.anchors[segment + (handle === 1 ? 0 : 1)]!;
		const frame = graphNumber(control.position), anchorFrame = graphNumber(anchor.position); const distance = frame - anchorFrame;
		if (mode === 'speed' && distance === 0) return [];
		const ordinate = mode === 'value' ? control.value : (control.value - anchor.value) / distance * graphNumber(frameRate);
		return [{ segment, handle, position: control.position, frame, value: ordinate, anchorFrame, anchorValue: mode === 'value' ? anchor.value : ordinate }];
	})) ?? [];
	const values = [...points.flatMap((point) => point.value === null ? [] : [point.value]), ...handles.map((handle) => handle.value)];
	const minimum = Math.min(0, ...values), maximum = Math.max(0, ...values); const padding = Math.max(1, (maximum - minimum) * .1);
	return { curve, points, handles, maximumFrame, minimumValue: minimum - padding, maximumValue: maximum + padding };
}
