/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionLayer } from './motion-composition.ts';
import { motionLayerProperties } from './motion-project-graph.ts';
import { normalizeMotionLayer } from './motion-layer-validation.ts';
import { normalizeMotionProperty, type MotionProperty } from './motion-property.ts';
import { retimeMotionPathKeys } from './motion-path-keyframe-edit.ts';
import { retimeMotionCurve } from './motion-keyframe-curve-edit.ts';
import { addRationals, multiplyRationals, type Rational } from './timeline-time.ts';
import { motionRational } from './motion-values.ts';

/** Convert a containing composition's frame units once, preserving local values and source seconds. */
export function retimeMotionLayer(layer: MotionLayer, frameRatio: Rational, offsetFrames: Rational = { num: 0, den: 1 }): MotionLayer {
	const ratio = motionRational(frameRatio, 'layer frame-rate ratio', true); const offset = motionRational(offsetFrames, 'layer offset');
	const scale = (at: Rational) => multiplyRationals(at, ratio); const move = (at: Rational) => addRationals(scale(at), offset);
	const properties = new Map(motionLayerProperties(layer).map(({ path, property }) => [path, retimeProperty(property, scale)]));
	const walk = (value: unknown, path: string): unknown => {
		const property = properties.get(path); if (property) return property;
		if (Array.isArray(value)) return value.map((item: unknown, index) => walk(item, `${path}.${index}`));
		if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item, path ? `${path}.${key}` : key)]));
		return value;
	};
	const mapped = walk(layer, '') as MotionLayer;
	return normalizeMotionLayer({ ...mapped, startFrame: move(layer.startFrame), inFrame: move(layer.inFrame), outFrame: move(layer.outFrame) });
}
function retimeProperty(property: MotionProperty, scale: (at: Rational) => Rational): MotionProperty {
	if (property.kind === 'path') return normalizeMotionProperty(retimeMotionPathKeys(property, scale));
	if (property.kind === 'scalar') return normalizeMotionProperty({ ...property, curve: property.curve === null ? null : retimeMotionCurve(property.curve, scale) });
	return normalizeMotionProperty({ ...property, curves: property.curves.map((curve) => curve === null ? null : retimeMotionCurve(curve, scale)) });
}
