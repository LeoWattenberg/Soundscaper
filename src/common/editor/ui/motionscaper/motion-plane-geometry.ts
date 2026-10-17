/* SPDX-License-Identifier: AGPL-3.0-only */

import { compileMotionProperty } from '../../motion-property-evaluation.ts';
import { normalizeMotionPath, type MotionPathProperty, type MotionVector2 } from '../../motion-property.ts';
import type { MotionSpatialProperty } from '../../motion-spatial-edit.ts';
import { compareRationals, type Rational } from '../../timeline-time.ts';
import { graphFrame } from './motion-graph-geometry.ts';
import { formatMotionExactInput } from './motion-exact-input.ts';
export type MotionPlaneProperty = MotionPathProperty | MotionSpatialProperty;
export type MotionPlaneAction = { readonly type: 'base' } | { readonly type: 'key'; readonly position: Rational }
	| { readonly type: 'handle'; readonly position: Rational; readonly handle: 1 | 2 }
	| { readonly type: 'vertex'; readonly vertex: number; readonly part: 'point' | 'inTangent' | 'outTangent' };
export interface MotionPlanePoint { readonly id: string; readonly label: string; readonly point: MotionVector2; readonly kind: 'anchor' | 'handle'; readonly connector?: MotionVector2; readonly action: MotionPlaneAction }
export interface MotionPlaneGeometry { readonly path: string; readonly points: readonly MotionPlanePoint[] }
const sum = (a: MotionVector2, b: MotionVector2): MotionVector2 => [a[0] + b[0], a[1] + b[1]];
export function motionPlaneGeometry(property: MotionPlaneProperty, options: { readonly duration: number; readonly position: Rational | null; readonly selected: string; readonly allHandles?: boolean; readonly copy: Readonly<Record<string, string>> }): MotionPlaneGeometry {
	if (property.kind === 'path') {
		const value = options.position === null ? property.value : normalizeMotionPath(compileMotionProperty(property)(options.position));
		const points: MotionPlanePoint[] = [];
		let path = `M${value.vertices[0]!.point.join(',')}`;
		for (let index = 1; index < value.vertices.length + (value.closed ? 1 : 0); index++) {
			const a = value.vertices[index - 1]!, b = value.vertices[index % value.vertices.length]!;
			path += `C${sum(a.point, a.outTangent).join(',')} ${sum(b.point, b.inTangent).join(',')} ${b.point.join(',')}`;
		}
		if (value.closed) path += 'Z';
		for (const [index, vertex] of value.vertices.entries()) {
			if (options.allHandles || options.selected === `vertex:${index}` || options.selected.startsWith(`vertex:${index}:`)) for (const part of ['inTangent', 'outTangent'] as const) points.push({ id: `vertex:${index}:${part}`, label: `${options.copy[`motionscaperPath_${part}`]} ${index + 1}`, point: sum(vertex.point, vertex[part]), kind: 'handle', connector: vertex.point, action: { type: 'vertex', vertex: index, part } });
			points.push({ id: `vertex:${index}`, label: `${options.copy.motionscaperPathPoint} ${index + 1}`, point: vertex.point, kind: 'anchor', action: { type: 'vertex', vertex: index, part: 'point' } });
		}
		return { path, points };
	}
	const evaluate = compileMotionProperty(property), point = (position: Rational) => (evaluate(position) as readonly number[]).slice(0, 2) as unknown as MotionVector2;
	const unique = new Map(property.curves.slice(0, 2).flatMap((curve) => curve?.anchors.map((anchor) => [`${anchor.position.num}/${anchor.position.den}`, anchor.position] as const) ?? []));
	const positions = [...unique.values()].sort(compareRationals); const points: MotionPlanePoint[] = positions.map((position) => ({ id: `key:${position.num}/${position.den}`, label: `${options.copy.motionscaperKeyframe} ${formatMotionExactInput(position)}`, point: point(position), kind: 'anchor', action: { type: 'key', position } }));
	if (points.length === 0) points.push({ id: 'base', label: options.copy.motionscaperBasePosition!, point: [property.value[0], property.value[1]], kind: 'anchor', action: { type: 'base' } });
	const x = property.curves[0], y = property.curves[1];
	for (let index = 0; index < (x?.segments.length ?? 0); index++) {
		const from = x!.anchors[index]!.position, end = x!.anchors[index + 1]!.position, prefix = `${from.num}/${from.den}`;
		if (!options.allHandles && options.selected !== `key:${prefix}` && !options.selected.startsWith(`handle:${prefix}:`)) continue;
		const yi = y?.anchors.findIndex((anchor) => compareRationals(anchor.position, from) === 0) ?? -1;
		const xs = x!.segments[index], ys = y?.segments[yi];
		if (!y || yi < 0 || !y.anchors[yi + 1] || compareRationals(end, y.anchors[yi + 1]!.position) !== 0 || xs?.kind !== 'bezier' || ys?.kind !== 'bezier'
			|| compareRationals(xs.control1.position, ys.control1.position) !== 0 || compareRationals(xs.control2.position, ys.control2.position) !== 0) continue;
		for (const handle of [1, 2] as const) { const key = handle === 1 ? 'control1' : 'control2'; points.unshift({ id: `handle:${prefix}:${handle}`, label: `${options.copy.motionscaperGraphHandle} ${handle}`, point: [xs[key].value, ys[key].value], connector: point(handle === 1 ? from : end), kind: 'handle', action: { type: 'handle', position: from, handle } }); }
	}
	const end = Math.max(options.duration, ...positions.map((position) => position.num / position.den));
	return { path: Array.from({ length: 161 }, (_, index) => `${index === 0 ? 'M' : 'L'}${point(graphFrame(end * index / 160)).join(',')}`).join(''), points };
}
