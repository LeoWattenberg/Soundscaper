/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeKey, MotionAeShape } from './motion-ae-exchange-types.ts';
export interface MotionAeImportPath { readonly value: MotionAeShape; readonly keys: readonly MotionAeKey<MotionAeShape>[] }
function record(input: unknown): Record<string, unknown> {
	if (input === null || typeof input !== 'object' || Object.prototype.toString.call(input) === '[object Array]') throw new Error('AE path expected a record.'); return input as Record<string, unknown>;
}
function array(input: unknown, maximum: number): readonly unknown[] {
	if (Object.prototype.toString.call(input) !== '[object Array]' || (input as unknown[]).length > maximum) throw new Error('AE path array budget exceeded.'); return input as unknown[];
}
function boolean(input: unknown): boolean { if (typeof input !== 'boolean') throw new Error('AE path boolean is invalid.'); return input; }
function number(input: unknown): number { if (typeof input !== 'number' || !isFinite(input) || Math.abs(input) > 1e12) throw new Error('AE path number is invalid.'); return input; }
function shape(input: unknown): MotionAeShape {
	const r = record(input), vertices = array(r.vertices, 4096), closed = boolean(r.closed);
	if (r.feather !== undefined) throw new Error('Variable path feather is not an editable import capability. Use the retained original or rendered fallback.');
	if (vertices.length < (closed ? 3 : 2)) throw new Error('AE path has too few vertices.');
	const points = (value: unknown) => {
		const values = array(value, vertices.length), result: (readonly [number, number])[] = [];
		if (values.length !== vertices.length) throw new Error('AE path tangent topology differs.');
		for (let index = 0; index < values.length; index++) { const point = array(values[index], 2); if (point.length !== 2) throw new Error('AE path points need two dimensions.'); result.push([number(point[0]), number(point[1])]); } return result;
	};
	return { closed, vertices: points(vertices), inTangents: points(r.inTangents), outTangents: points(r.outTangents) };
}
export function readMotionAeImportPath(input: unknown, budget: { properties: number; keys: number }): MotionAeImportPath {
	const rawPath = record(input); if (rawPath.kind !== 'shape') throw new Error('AE path must contain captured Shape values.');
	const value = shape(rawPath.value), rawKeys = array(rawPath.keys, 4096), keys: MotionAeKey<MotionAeShape>[] = [];
	budget.keys += rawKeys.length; if (budget.keys > 262_144) throw new Error('AE import key budget exceeded.');
	if (rawPath.expression !== null && boolean(record(rawPath.expression).enabled)) throw new Error('AE path expressions require rendered fallback.');
	for (let keyIndex = 0; keyIndex < rawKeys.length; keyIndex++) {
		const key = record(rawKeys[keyIndex]), time = number(key.time), keyValue = shape(key.value);
		if (Math.abs(time) > 1e6 || (keyIndex > 0 && time <= keys[keyIndex - 1]!.time)) throw new Error('AE path key times must increase within the host bound.');
		if (keyValue.closed !== value.closed || keyValue.vertices.length !== value.vertices.length) throw new Error('AE editable path topology changes.');
		if ((key.inInterpolation !== 'hold' && key.inInterpolation !== 'linear') || (key.outInterpolation !== 'hold' && key.outInterpolation !== 'linear') || boolean(key.roving)) throw new Error('AE path temporal easing requires an explicit bake.');
		keys.push({ time, value: keyValue, inInterpolation: key.inInterpolation, outInterpolation: key.outInterpolation,
			inEase: [{ speed: 0, influence: 100 / 3 }], outEase: [{ speed: 0, influence: 100 / 3 }], inSpatialTangent: null, outSpatialTangent: null, roving: false });
	}
	return { value, keys };
}
