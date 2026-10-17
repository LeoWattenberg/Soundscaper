/* SPDX-License-Identifier: AGPL-3.0-only */

import { compileInterpolationCurve, evaluateInterpolationCurveAtExactPosition, type CompiledInterpolationCurve } from './interpolation-curve.ts';
import { compareRationals, type Rational } from './timeline-time.ts';
import { normalizeMotionProperty, type MotionPath, type MotionPathProperty, type MotionProperty, type MotionScalarProperty, type MotionVector2, type MotionVector3, type MotionColor } from './motion-property.ts';
import { freezeMotionValue } from './motion-values.ts';

export type MotionStatePropertyResolver = (property: MotionProperty, path: string, position: Rational, base: (position: Rational) => MotionPropertyValue) => MotionPropertyValue;
export type MotionPropertyValue = number | MotionVector2 | MotionVector3 | MotionColor | MotionPath;
export type EvaluatedMotionState<T> = T extends MotionScalarProperty ? number
	: T extends { readonly kind: 'vector2' } ? MotionVector2
		: T extends { readonly kind: 'vector3' } ? MotionVector3
			: T extends { readonly kind: 'color' } ? MotionColor
				: T extends MotionPathProperty ? MotionPath
					: T extends object ? { readonly [Key in keyof T]: EvaluatedMotionState<T[Key]> } : T;

export function compileMotionProperty(value: unknown): (position: Rational) => MotionPropertyValue {
	const property = normalizeMotionProperty(value);
	const pathCurves = property.kind === 'path' ? property.segments.map((shape, index) => compileInterpolationCurve({ anchors: [{ position: property.keyframes[index]!.position, value: 0 }, { position: property.keyframes[index + 1]!.position, value: 1 }], segments: [typeof shape === 'string' ? { kind: shape } : shape] })) : [];
	return (position) => {
		if (property.expression?.enabled) throw new Error('Motion expression evaluation is unavailable until the expression engine is installed.');
		if (property.kind === 'scalar') return property.curve === null ? property.value : evaluateCurve(property.curve, position);
		if (property.kind === 'path') return evaluatePath(property, position, pathCurves);
		const channels = property.value.map((channel, index) => {
			const curve = property.curves[index];
			const result = curve == null ? channel : evaluateCurve(curve, position);
			return property.kind === 'color' ? Math.min(1, Math.max(0, result)) : result;
		});
		return Object.freeze(channels) as unknown as MotionVector2 | MotionVector3 | MotionColor;
	};
}

/** Compile normalized intent once; every consumer receives the same renderer-neutral values. */
export function compileMotionState<T>(value: T): (position: Rational, resolver?: MotionStatePropertyResolver) => EvaluatedMotionState<T> {
	const evaluate = compileValue(value, '');
	return (position, resolver) => freezeMotionValue(evaluate(position, resolver)) as EvaluatedMotionState<T>;
}

function compileValue(value: unknown, path: string): (position: Rational, resolver?: MotionStatePropertyResolver) => unknown {
	if (!value || typeof value !== 'object') return () => value;
	if (Array.isArray(value)) {
		const children = value.map((item: unknown, index: number) => compileValue(item, path ? `${path}.${index}` : String(index)));
		return (position, resolver) => children.map((child) => child(position, resolver));
	}
	const record = value as Readonly<Record<string, unknown>>;
	if (isProperty(record)) {
		const evaluate = compileMotionProperty(record);
		const base = record.expression?.enabled ? compileMotionProperty({ ...record, expression: null }) : evaluate;
		return (position, resolver) => record.expression?.enabled && resolver ? resolver(record, path, position, base) : evaluate(position);
	}
	const children = Object.entries(record).map(([key, item]) => ({ key, evaluate: compileValue(item, path ? `${path}.${key}` : key) }));
	return (position, resolver) => Object.fromEntries(children.map(({ key, evaluate }) => [key, evaluate(position, resolver)]));
}

function isProperty(value: Readonly<Record<string, unknown>>): value is MotionProperty & Readonly<Record<string, unknown>> {
	return ['scalar', 'vector2', 'vector3', 'color', 'path'].includes(String(value.kind)) && Object.hasOwn(value, 'expression');
}

function evaluatePath(property: MotionPathProperty, position: Rational, curves: readonly CompiledInterpolationCurve[]): MotionPath {
	const first = property.keyframes[0];
	const last = property.keyframes.at(-1);
	if (!first || !last) return property.value;
	if (compareRationals(position, first.position) <= 0) return first.value;
	if (compareRationals(position, last.position) >= 0) return last.value;
	const endIndex = property.keyframes.findIndex((key) => compareRationals(key.position, position) > 0);
	const start = property.keyframes[endIndex - 1]!;
	const end = property.keyframes[endIndex]!;
	const amount = evaluateInterpolationCurveAtExactPosition(curves[endIndex - 1]!, position);
	const point = (a: MotionVector2, b: MotionVector2): MotionVector2 => [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount];
	return freezeMotionValue({ closed: start.value.closed, vertices: start.value.vertices.map((vertex, index) => {
		const target = end.value.vertices[index]!;
		return { point: point(vertex.point, target.point), inTangent: point(vertex.inTangent, target.inTangent), outTangent: point(vertex.outTangent, target.outTangent) };
	}) });
}

function evaluateCurve(curve: CompiledInterpolationCurve, position: Rational): number {
	return curve.anchors.length === 1 ? curve.anchors[0]!.value : evaluateInterpolationCurveAtExactPosition(curve, position);
}
