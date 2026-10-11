/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CompiledInterpolationCurve, InterpolationAnchor, InterpolationShape } from './interpolation-curve.ts';
import { approximateBoundedFraction, publicFraction } from './interpolation-curve-math.ts';
import { addRationals, compareRationals, divideRationals, multiplyRationals, subtractRationals, type Rational } from './timeline-time.ts';

export const motionKeyPositionId = (position: Rational): string => `${position.num}/${position.den}`;
export function retimeMotionCurve(curve: CompiledInterpolationCurve, position: (value: Rational) => Rational): CompiledInterpolationCurve {
	return { anchors: curve.anchors.map((anchor) => ({ ...anchor, position: position(anchor.position) })), segments: curve.segments.map((shape) => shape.kind === 'bezier'
		? { kind: 'bezier', control1: { ...shape.control1, position: position(shape.control1.position) }, control2: { ...shape.control2, position: position(shape.control2.position) } } : shape) };
}

export function setMotionCurveKey(curve: CompiledInterpolationCurve | null, key: InterpolationAnchor): CompiledInterpolationCurve {
	if (!curve) return { anchors: [key], segments: [] };
	const found = curve.anchors.findIndex(({ position }) => compareRationals(position, key.position) === 0);
	if (found >= 0) return moveMotionCurveKeys(curve, (anchor, index) => index === found ? key : anchor);
	const after = curve.anchors.findIndex(({ position }) => compareRationals(position, key.position) > 0);
	if (after === 0) return { anchors: [key, ...curve.anchors], segments: [{ kind: 'linear' }, ...curve.segments] };
	if (after === -1) return { anchors: [...curve.anchors, key], segments: [...curve.segments, { kind: 'linear' }] };
	const shapes = splitShape(curve.anchors[after - 1]!, curve.anchors[after]!, curve.segments[after - 1]!, key);
	return { anchors: [...curve.anchors.slice(0, after), key, ...curve.anchors.slice(after)], segments: [...curve.segments.slice(0, after - 1), ...shapes, ...curve.segments.slice(after)] };
}

export function moveMotionCurveKeys(curve: CompiledInterpolationCurve, move: (anchor: InterpolationAnchor, index: number) => InterpolationAnchor): CompiledInterpolationCurve {
	const anchors = curve.anchors.map(move);
	for (let index = 1; index < anchors.length; index++) if (compareRationals(anchors[index - 1]!.position, anchors[index]!.position) >= 0) throw new RangeError('Moving motion keys would cause a collision or change their increasing order.');
	return { anchors, segments: curve.segments.map((shape, index) => {
		if (shape.kind !== 'bezier') return shape;
		const from = curve.anchors[index]!, to = curve.anchors[index + 1]!, nextFrom = anchors[index]!, nextTo = anchors[index + 1]!;
		const position = (value: Rational) => addRationals(nextFrom.position, multiplyRationals(divideRationals(subtractRationals(value, from.position), subtractRationals(to.position, from.position)), subtractRationals(nextTo.position, nextFrom.position)));
		return { kind: 'bezier', control1: { position: position(shape.control1.position), value: shape.control1.value + nextFrom.value - from.value }, control2: { position: position(shape.control2.position), value: shape.control2.value + nextTo.value - to.value } };
	}) };
}

export function selectMotionCurveKeys(curve: CompiledInterpolationCurve | null, selected: (position: Rational) => boolean): CompiledInterpolationCurve | null {
	if (!curve) return null;
	const indexes = curve.anchors.flatMap(({ position }, index) => selected(position) ? [index] : []);
	if (!indexes.length) return null;
	return { anchors: indexes.map((index) => curve.anchors[index]!), segments: indexes.slice(1).map((index, offset) => index === indexes[offset]! + 1 ? curve.segments[index - 1]! : { kind: 'linear' }) };
}
export function mergeMotionCurveKeys(target: CompiledInterpolationCurve | null, source: CompiledInterpolationCurve): CompiledInterpolationCurve {
	let result = target; for (const key of source.anchors) result = setMotionCurveKey(result, key);
	const merged = result!;
	return { anchors: merged.anchors, segments: merged.segments.map((shape, index) => {
		const found = source.anchors.findIndex(({ position }) => compareRationals(position, merged.anchors[index]!.position) === 0);
		return found >= 0 && found < source.segments.length && compareRationals(source.anchors[found + 1]!.position, merged.anchors[index + 1]!.position) === 0 ? source.segments[found]! : shape;
	}) };
}

function splitShape(start: InterpolationAnchor, end: InterpolationAnchor, shape: InterpolationShape, key: InterpolationAnchor): readonly [InterpolationShape, InterpolationShape] {
	if (shape.kind === 'hold' || shape.kind === 'linear') return [shape, shape];
	const point = (anchor: InterpolationAnchor): readonly [number, number] => [anchor.position.num / anchor.position.den, anchor.value];
	const a = point(start), d = point(end); const b = shape.kind === 'bezier' ? point(shape.control1) : [a[0] + (d[0] - a[0]) / 3, a[1]] as const;
	const c = shape.kind === 'bezier' ? point(shape.control2) : [a[0] + (d[0] - a[0]) * 2 / 3, d[1]] as const;
	const target = key.position.num / key.position.den; let low = 0; let high = 1;
	for (let index = 0; index < 64; index++) { const middle = (low + high) / 2; if (lerp(lerp(lerp(a, b, middle), lerp(b, c, middle), middle), lerp(lerp(b, c, middle), lerp(c, d, middle), middle), middle)[0] < target) low = middle; else high = middle; }
	const t = (low + high) / 2; const ab = lerp(a, b, t), bc = lerp(b, c, t), cd = lerp(c, d, t); const abc = lerp(ab, bc, t), bcd = lerp(bc, cd, t);
	const middle = lerp(abc, bcd, t); const delta = key.value - middle[1];
	const anchor = (value: readonly [number, number], offset = 0): InterpolationAnchor => ({ position: boundedPosition(value[0]), value: value[1] + offset });
	return [{ kind: 'bezier', control1: anchor(ab), control2: anchor(abc, delta) }, { kind: 'bezier', control1: anchor(bcd, delta), control2: anchor(cd) }];
}
function lerp(a: readonly [number, number], b: readonly [number, number], amount: number): readonly [number, number] { return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount]; }
function boundedPosition(value: number): Rational {
	// An inserted Bezier key may solve an irrational parameter; use the shared bounded-rational boundary policy.
	const result = approximateBoundedFraction(Math.abs(value)); if (!result) throw new RangeError('Bezier key insertion exceeds the exact coordinate domain.');
	const fraction = publicFraction(result); return value < 0 ? { num: -fraction.num, den: fraction.den } : fraction;
}
