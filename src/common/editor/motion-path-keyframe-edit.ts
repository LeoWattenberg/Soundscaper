/* SPDX-License-Identifier: AGPL-3.0-only */

import { compileInterpolationCurve, evaluateInterpolationCurveAtExactPosition, type InterpolationShape } from './interpolation-curve.ts';
import type { MotionPathProperty, MotionPath } from './motion-property.ts';
import { motionKeyPositionId, setMotionCurveKey } from './motion-keyframe-curve-edit.ts';
import { addRationals, compareRationals, divideRationals, multiplyRationals, subtractRationals, type Rational } from './timeline-time.ts';

export function retimeMotionPathKeys(property: MotionPathProperty, position: (value: Rational) => Rational): MotionPathProperty {
	return { ...property, keyframes: property.keyframes.map((key) => ({ ...key, position: position(key.position) })), segments: property.segments.map((shape) => typeof shape === 'string' ? shape
		: { ...shape, control1: { ...shape.control1, position: position(shape.control1.position) }, control2: { ...shape.control2, position: position(shape.control2.position) } }) };
}
export function moveMotionPathKeys(property: MotionPathProperty, position: (value: Rational) => Rational): MotionPathProperty {
	const keyframes = property.keyframes.map((key) => ({ ...key, position: position(key.position) }));
	return { ...property, keyframes, segments: property.segments.map((shape, index) => {
		if (typeof shape === 'string') return shape;
		const from = property.keyframes[index]!.position, to = property.keyframes[index + 1]!.position;
		const nextFrom = keyframes[index]!.position, nextTo = keyframes[index + 1]!.position;
		const move = (at: Rational) => addRationals(nextFrom, multiplyRationals(divideRationals(subtractRationals(at, from), subtractRationals(to, from)), subtractRationals(nextTo, nextFrom)));
		return { ...shape, control1: { ...shape.control1, position: move(shape.control1.position) }, control2: { ...shape.control2, position: move(shape.control2.position) } };
	}) };
}
export function setMotionPathKey(property: MotionPathProperty, key: Readonly<{ position: Rational; value: MotionPath }>): MotionPathProperty {
	const existing = property.keyframes.findIndex(({ position }) => compareRationals(position, key.position) === 0);
	if (existing >= 0) return { ...property, keyframes: property.keyframes.map((current, index) => index === existing ? key : current) };
	if (!property.keyframes.length) return { ...property, keyframes: [key], segments: [] };
	const after = property.keyframes.findIndex(({ position }) => compareRationals(position, key.position) > 0);
	if (after === 0) return { ...property, keyframes: [key, ...property.keyframes], segments: ['linear', ...property.segments] };
	if (after === -1) return { ...property, keyframes: [...property.keyframes, key], segments: [...property.segments, 'linear'] };
	const shape = property.segments[after - 1]!; const start = property.keyframes[after - 1]!, end = property.keyframes[after]!;
	const curve = compileInterpolationCurve({ anchors: [{ position: start.position, value: 0 }, { position: end.position, value: 1 }], segments: [typeof shape === 'string' ? { kind: shape } : shape] });
	const amount = evaluateInterpolationCurveAtExactPosition(curve, key.position); const split = setMotionCurveKey(curve, { position: key.position, value: amount });
	const normalize = (part: InterpolationShape, begin: number, finish: number): MotionPathProperty['segments'][number] => {
		if (part.kind !== 'bezier') return part.kind;
		if (Math.abs(finish - begin) < 1e-14) {
			if (Math.abs(part.control1.value - begin) > 1e-14 || Math.abs(part.control2.value - begin) > 1e-14) throw new RangeError('A path morph cannot split a returning progress loop into equal path endpoints; choose a different key time.');
			return 'linear';
		}
		return { ...part, control1: { ...part.control1, value: (part.control1.value - begin) / (finish - begin) }, control2: { ...part.control2, value: (part.control2.value - begin) / (finish - begin) } };
	};
	return { ...property, keyframes: [...property.keyframes.slice(0, after), key, ...property.keyframes.slice(after)],
		segments: [...property.segments.slice(0, after - 1), normalize(split.segments[0]!, 0, amount), normalize(split.segments[1]!, amount, 1), ...property.segments.slice(after)] };
}
export function mergeMotionPathKeys(target: MotionPathProperty, source: MotionPathProperty): MotionPathProperty {
	let merged = target; for (const key of source.keyframes) merged = setMotionPathKey(merged, key);
	const sourceIndexes = new Map(source.keyframes.map((key, index) => [motionKeyPositionId(key.position), index]));
	return { ...merged, segments: merged.segments.map((shape, index) => {
		const start = sourceIndexes.get(motionKeyPositionId(merged.keyframes[index]!.position));
		return start !== undefined && start < source.segments.length && compareRationals(source.keyframes[start + 1]!.position, merged.keyframes[index + 1]!.position) === 0 ? source.segments[start]! : shape;
	}) };
}
