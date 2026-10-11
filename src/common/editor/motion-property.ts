/* SPDX-License-Identifier: AGPL-3.0-only */

import { compileInterpolationCurve, type CompiledInterpolationCurve, type InterpolationShape } from './interpolation-curve.ts';
import { compareRationals, type Rational } from './timeline-time.ts';
import { freezeMotionValue, motionArray, motionBoolean, motionEnum, motionId, motionNumber, motionRational, motionRecord, motionString } from './motion-values.ts';

export type MotionVector2 = readonly [number, number];
export type MotionVector3 = readonly [number, number, number];
export type MotionColor = readonly [number, number, number, number];
export interface MotionExpression {
	readonly source: string;
	readonly enabled: boolean;
	readonly references: readonly { readonly id: string; readonly layerId: string; readonly propertyPath: string }[];
}
interface PropertyBase { readonly expression: MotionExpression | null }
export interface MotionScalarProperty extends PropertyBase {
	readonly kind: 'scalar'; readonly value: number; readonly curve: CompiledInterpolationCurve | null;
}
export interface MotionVector2Property extends PropertyBase {
	readonly kind: 'vector2'; readonly value: MotionVector2;
	readonly curves: readonly [CompiledInterpolationCurve | null, CompiledInterpolationCurve | null];
}
export interface MotionVector3Property extends PropertyBase {
	readonly kind: 'vector3'; readonly value: MotionVector3;
	readonly curves: readonly [CompiledInterpolationCurve | null, CompiledInterpolationCurve | null, CompiledInterpolationCurve | null];
}
export interface MotionColorProperty extends PropertyBase {
	readonly kind: 'color'; readonly value: MotionColor;
	readonly curves: readonly [CompiledInterpolationCurve | null, CompiledInterpolationCurve | null, CompiledInterpolationCurve | null, CompiledInterpolationCurve | null];
}
export interface MotionPathVertex {
	readonly point: MotionVector2; readonly inTangent: MotionVector2; readonly outTangent: MotionVector2;
}
export interface MotionPath { readonly closed: boolean; readonly vertices: readonly MotionPathVertex[] }
export interface MotionPathProperty extends PropertyBase {
	readonly kind: 'path'; readonly value: MotionPath;
	readonly keyframes: readonly { readonly position: Rational; readonly value: MotionPath }[];
	readonly segments: readonly ('hold' | 'linear' | 'eased' | Extract<InterpolationShape, { kind: 'bezier' }>)[];
}
export type MotionProperty = MotionScalarProperty | MotionVector2Property | MotionVector3Property | MotionColorProperty | MotionPathProperty;

export function motionScalar(value: number): MotionScalarProperty {
	return normalizeMotionProperty({ kind: 'scalar', value, curve: null, expression: null }) as MotionScalarProperty;
}
export function motionVector(value: MotionVector2): MotionVector2Property;
export function motionVector(value: MotionVector3): MotionVector3Property;
export function motionVector(value: MotionVector2 | MotionVector3): MotionVector2Property | MotionVector3Property {
	return normalizeMotionProperty({ kind: value.length === 2 ? 'vector2' : 'vector3', value,
		curves: value.map(() => null), expression: null }) as MotionVector2Property | MotionVector3Property;
}
export function motionColor(value: MotionColor): MotionColorProperty {
	return normalizeMotionProperty({ kind: 'color', value, curves: [null, null, null, null], expression: null }) as MotionColorProperty;
}

export function normalizeMotionProperty(value: unknown): MotionProperty {
	const discriminator = motionRecord(value, ['kind', 'value', 'curve', 'curves', 'keyframes', 'segments', 'expression'], 'motion property', ['kind']);
	return normalizePropertyRecord(discriminator);
}

function normalizePropertyRecord(value: Readonly<Record<string, unknown>>): MotionProperty {
	const kind = motionEnum(value.kind, ['scalar', 'vector2', 'vector3', 'color', 'path'], 'motion property kind');
	const fields = kind === 'scalar' ? ['curve'] : kind === 'path' ? ['keyframes', 'segments'] : ['curves'];
	const record = motionRecord(value, ['kind', 'value', 'expression', ...fields], 'motion property');
	const expression = normalizeExpression(record.expression);
	if (kind === 'scalar') return freezeMotionValue({ kind, value: motionNumber(record.value, 'scalar value'), curve: normalizeCurve(record.curve), expression });
	if (kind === 'path') return normalizePathProperty(record, expression);
	const length = kind === 'vector2' ? 2 : kind === 'vector3' ? 3 : 4;
	const vector = motionArray(record.value, length, `${kind} value`, length).map((item) => motionNumber(item, `${kind} channel`, kind === 'color' ? 0 : -1e12, kind === 'color' ? 1 : 1e12));
	const curves = motionArray(record.curves, length, `${kind} curves`, length).map(normalizeCurve);
	if (kind === 'vector2') return freezeMotionValue({ kind, value: [vector[0]!, vector[1]!] as const, curves: [curves[0]!, curves[1]!] as const, expression });
	if (kind === 'vector3') return freezeMotionValue({ kind, value: [vector[0]!, vector[1]!, vector[2]!] as const, curves: [curves[0]!, curves[1]!, curves[2]!] as const, expression });
	return freezeMotionValue({ kind, value: [vector[0]!, vector[1]!, vector[2]!, vector[3]!] as const, curves: [curves[0]!, curves[1]!, curves[2]!, curves[3]!] as const, expression });
}

function normalizeCurve(value: unknown): CompiledInterpolationCurve | null {
	if (value === null) return null;
	const record = motionRecord(value, ['anchors', 'segments'], 'motion curve');
	const anchors = motionArray(record.anchors, 4096, 'motion curve anchors', 1);
	if (anchors.length === 1) {
		const anchor = motionRecord(anchors[0], ['position', 'value'], 'motion curve anchor');
		const position = motionRational(anchor.position, 'motion keyframe position');
		if (position.num < 0) throw new RangeError('Motion keyframe positions must be non-negative.');
		motionArray(record.segments, 0, 'single motion keyframe segments');
		return freezeMotionValue({ anchors: [{ position, value: motionNumber(anchor.value, 'motion keyframe value', -Number.MAX_VALUE, Number.MAX_VALUE) }], segments: [] });
	}
	return compileInterpolationCurve(record);
}

export function normalizeMotionPath(value: unknown): MotionPath {
	const record = motionRecord(value, ['closed', 'vertices'], 'motion path');
	const closed = motionBoolean(record.closed, 'path closed');
	const vertices = motionArray(record.vertices, 4096, 'path vertices', closed ? 3 : 2).map((item) => {
		const vertex = motionRecord(item, ['point', 'inTangent', 'outTangent'], 'path vertex');
		return { point: vector2(vertex.point), inTangent: vector2(vertex.inTangent), outTangent: vector2(vertex.outTangent) };
	});
	return freezeMotionValue({ closed, vertices });
}

function normalizePathProperty(record: Readonly<Record<string, unknown>>, expression: MotionExpression | null): MotionPathProperty {
	const value = normalizeMotionPath(record.value);
	const keyframes = motionArray(record.keyframes, 4096, 'path keyframes').map((item) => {
		const key = motionRecord(item, ['position', 'value'], 'path keyframe');
		const position = motionRational(key.position, 'path keyframe position');
		if (position.num < 0) throw new RangeError('Path keyframe positions must be non-negative.');
		const path = normalizeMotionPath(key.value);
		if (path.closed !== value.closed || path.vertices.length !== value.vertices.length) throw new RangeError('Animated path topology must match its base path.');
		return { position, value: path };
	});
	for (let index = 1; index < keyframes.length; index += 1) {
		if (compareRationals(keyframes[index - 1]!.position, keyframes[index]!.position) >= 0) throw new RangeError('Path keyframes must have increasing positions.');
	}
	const values = motionArray(record.segments, 4095, 'path segments');
	if (values.length !== Math.max(0, keyframes.length - 1)) throw new RangeError('Path segments must connect every pair of keyframes.');
	const segments = values.map((item, index) => {
		if (typeof item === 'string') return motionEnum(item, ['hold', 'linear', 'eased'], 'path segment');
		const curve = compileInterpolationCurve({ anchors: [{ position: keyframes[index]!.position, value: 0 }, { position: keyframes[index + 1]!.position, value: 1 }], segments: [item] });
		const shape = curve.segments[0]!; if (shape.kind !== 'bezier') throw new TypeError('Non-Bezier path segments use their canonical string name.');
		motionNumber(shape.control1.value, 'path control progress'); motionNumber(shape.control2.value, 'path control progress');
		return shape;
	});
	return freezeMotionValue({ kind: 'path' as const, value, keyframes, segments, expression });
}

function normalizeExpression(value: unknown): MotionExpression | null {
	if (value === null) return null;
	const record = motionRecord(value, ['source', 'enabled', 'references'], 'motion expression');
	const references = motionArray(record.references, 256, 'expression references').map((item) => {
		const reference = motionRecord(item, ['id', 'layerId', 'propertyPath'], 'expression reference');
		return { id: motionId(reference.id), layerId: motionId(reference.layerId), propertyPath: motionString(reference.propertyPath, 'property path', 1024) };
	});
	if (new Set(references.map(({ id }) => id)).size !== references.length) throw new RangeError('Expression references contain duplicate identity.');
	return freezeMotionValue({ source: motionString(record.source, 'expression source', 16_384, true), enabled: motionBoolean(record.enabled, 'expression enabled'), references });
}
function vector2(value: unknown): MotionVector2 {
	return motionArray(value, 2, 'path vector', 2).map((item) => motionNumber(item, 'path coordinate')) as unknown as MotionVector2;
}

export function motionPropertyOfKind<Kind extends MotionProperty['kind']>(value: unknown, kind: Kind): Extract<MotionProperty, { kind: Kind }> {
	const property = normalizeMotionProperty(value);
	if (property.kind !== kind) throw new TypeError(`Expected ${kind} motion property.`);
	return property as Extract<MotionProperty, { kind: Kind }>;
}
