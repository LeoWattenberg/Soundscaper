/* SPDX-License-Identifier: AGPL-3.0-only */

import { evaluateInterpolationCurveAtExactPosition } from './interpolation-curve.ts';
import { compareRationals, divideRationals, subtractRationals, type Rational } from './timeline-time.ts';
import { normalizeMotionProperty, type MotionPath, type MotionPathProperty, type MotionProperty, type MotionScalarProperty, type MotionVector2, type MotionVector3, type MotionColor } from './motion-property.ts';
import { freezeMotionValue } from './motion-values.ts';

export type MotionPropertyValue = number | MotionVector2 | MotionVector3 | MotionColor | MotionPath;
export type EvaluatedMotionState<T> = T extends MotionScalarProperty ? number
	: T extends { readonly kind: 'vector2' } ? MotionVector2
		: T extends { readonly kind: 'vector3' } ? MotionVector3
			: T extends { readonly kind: 'color' } ? MotionColor
				: T extends MotionPathProperty ? MotionPath
					: T extends object ? { readonly [Key in keyof T]: EvaluatedMotionState<T[Key]> } : T;

export function compileMotionProperty(value: unknown): (position: Rational) => MotionPropertyValue {
	const property = normalizeMotionProperty(value);
	return (position) => {
		if (property.expression?.enabled) throw new Error('Motion expression evaluation is unavailable until the expression engine is installed.');
		if (property.kind === 'scalar') return property.curve === null ? property.value : evaluateInterpolationCurveAtExactPosition(property.curve, position);
		if (property.kind === 'path') return evaluatePath(property, position);
		const channels = property.value.map((channel, index) => {
			const curve = property.curves[index];
			const result = curve == null ? channel : evaluateInterpolationCurveAtExactPosition(curve, position);
			return property.kind === 'color' ? Math.min(1, Math.max(0, result)) : result;
		});
		return Object.freeze(channels) as unknown as MotionVector2 | MotionVector3 | MotionColor;
	};
}

/** Compile normalized intent once; every consumer receives the same renderer-neutral values. */
export function compileMotionState<T>(value: T): (position: Rational) => EvaluatedMotionState<T> {
	const evaluate = compileValue(value);
	return (position) => freezeMotionValue(evaluate(position)) as EvaluatedMotionState<T>;
}

function compileValue(value: unknown): (position: Rational) => unknown {
	if (!value || typeof value !== 'object') return () => value;
	if (Array.isArray(value)) {
		const children = value.map((item: unknown) => compileValue(item));
		return (position) => children.map((child) => child(position));
	}
	const record = value as Readonly<Record<string, unknown>>;
	if (isProperty(record)) return compileMotionProperty(record);
	const children = Object.entries(record).map(([key, item]) => ({ key, evaluate: compileValue(item) }));
	return (position) => Object.fromEntries(children.map(({ key, evaluate }) => [key, evaluate(position)]));
}

function isProperty(value: Readonly<Record<string, unknown>>): value is MotionProperty & Readonly<Record<string, unknown>> {
	return ['scalar', 'vector2', 'vector3', 'color', 'path'].includes(String(value.kind)) && Object.hasOwn(value, 'expression');
}

function evaluatePath(property: MotionPathProperty, position: Rational): MotionPath {
	const first = property.keyframes[0];
	const last = property.keyframes.at(-1);
	if (!first || !last) return property.value;
	if (compareRationals(position, first.position) <= 0) return first.value;
	if (compareRationals(position, last.position) >= 0) return last.value;
	const endIndex = property.keyframes.findIndex((key) => compareRationals(key.position, position) > 0);
	const start = property.keyframes[endIndex - 1]!;
	const end = property.keyframes[endIndex]!;
	const kind = property.segments[endIndex - 1]!;
	if (kind === 'hold') return start.value;
	const fraction = divideRationals(subtractRationals(position, start.position), subtractRationals(end.position, start.position));
	const linear = fraction.num / fraction.den;
	const amount = kind === 'eased' ? linear * linear * (3 - 2 * linear) : linear;
	const point = (a: MotionVector2, b: MotionVector2): MotionVector2 => [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount];
	return freezeMotionValue({ closed: start.value.closed, vertices: start.value.vertices.map((vertex, index) => {
		const target = end.value.vertices[index]!;
		return { point: point(vertex.point, target.point), inTangent: point(vertex.inTangent, target.inTangent), outTangent: point(vertex.outTangent, target.outTangent) };
	}) });
}
