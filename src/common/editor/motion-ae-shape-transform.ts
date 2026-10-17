/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeProperty } from './motion-ae-exchange-types.ts';
import { motionPropertyOfKind, type MotionPathProperty } from './motion-property.ts';
export type ShapeGroup = Extract<MotionAeProperty, { kind: 'group' }>;
export type ShapeNumeric = Extract<MotionAeProperty, { kind: 'numeric' }>;
export class UnsupportedAeShape extends Error {}
export function shapeFields(group: ShapeGroup, allowed: readonly string[]): ReadonlyMap<string, MotionAeProperty> {
	const fields = new Map(group.children.map(value => [value.matchName, value]));
	if (fields.size !== group.children.length || group.children.some(value => !allowed.includes(value.matchName))) throw new UnsupportedAeShape('Unknown or duplicated vector properties require an AE-rendered fallback.');
	return fields;
}
export function shapeNumber(fields: ReadonlyMap<string, MotionAeProperty>, name: string, dimensions = 1): ShapeNumeric {
	const value = fields.get(name);
	if (value?.kind !== 'numeric' || value.value.length !== dimensions || value.samples || value.expression?.enabled) throw new UnsupportedAeShape(`Captured authored ${name} is required; expressions/samples remain in custody.`);
	return value;
}
export function shapeStatic(fields: ReadonlyMap<string, MotionAeProperty>, name: string, dimensions = 1): readonly number[] {
	const value = shapeNumber(fields, name, dimensions); if (value.keys.length) throw new UnsupportedAeShape(`Animated ${name} requires a separate mapping.`); return value.value;
}
export function shapeGroup(value: MotionAeProperty | undefined, name: string): ShapeGroup {
	if (value?.kind !== 'group' || value.matchName !== name || value.enabled === false) throw new UnsupportedAeShape(`Captured active ${name} group is required.`); return value;
}
export const shapeNumeric = (matchName: string, value: readonly number[]): ShapeNumeric => ({ kind: 'numeric', matchName, name: matchName, value, spatial: false, keys: [], expression: null });
export const shapeGroupRecord = (matchName: string, children: readonly MotionAeProperty[], enabled?: boolean): ShapeGroup => ({ kind: 'group', matchName, name: matchName, children, ...(enabled === undefined ? {} : { enabled }) });
const transformNames = ['ADBE Vector Anchor', 'ADBE Vector Position', 'ADBE Vector Scale', 'ADBE Vector Rotation', 'ADBE Vector Skew', 'ADBE Vector Skew Axis', 'ADBE Vector Group Opacity'];
export function identityAeShapeTransform(): ShapeGroup {
	return shapeGroupRecord('ADBE Vector Transform Group', transformNames.map((name, index) => shapeNumeric(name, index < 2 ? [0, 0] : index === 2 ? [100, 100] : [index === 6 ? 100 : 0])));
}
/** Static positive uniform scale preserves stroke width; other affine maps need an explicit stroke policy. */
export function convertAeShapeTransform(group: ShapeGroup): Readonly<{ scale: number; changed: boolean; path: (path: MotionPathProperty) => MotionPathProperty }> {
	const fields = shapeFields(group, transformNames), anchor = shapeStatic(fields, transformNames[0]!, 2), position = shapeStatic(fields, transformNames[1]!, 2), scale = shapeStatic(fields, transformNames[2]!, 2);
	const rotation = shapeStatic(fields, transformNames[3]!)[0]!, skew = shapeStatic(fields, transformNames[4]!)[0]!, opacity = shapeStatic(fields, transformNames[6]!)[0]!;
	shapeStatic(fields, transformNames[5]!);
	if (skew !== 0 || scale[0] !== scale[1] || scale[0]! <= 0 || opacity !== 100) throw new UnsupportedAeShape('Skew, nonuniform/reflected scale or group opacity cannot be flattened into independent Motion paint paths.');
	const factor = scale[0]! / 100, angle = rotation * Math.PI / 180, c = Math.cos(angle) * factor, s = Math.sin(angle) * factor;
	const vector = ([x, y]: readonly [number, number]): readonly [number, number] => [c * x - s * y, s * x + c * y];
	const changed = factor !== 1 || rotation !== 0 || anchor.some(value => value !== 0) || position.some(value => value !== 0);
	return { scale: factor, changed, path(input) {
		if (!changed) return input;
		const transform = (value: MotionPathProperty['value']) => ({ ...value, vertices: value.vertices.map(vertex => {
			const offset = vector([vertex.point[0] - anchor[0]!, vertex.point[1] - anchor[1]!]);
			return { point: [offset[0] + position[0]!, offset[1] + position[1]!] as const, inTangent: vector(vertex.inTangent), outTangent: vector(vertex.outTangent) };
		}) });
		return motionPropertyOfKind({ ...input, value: transform(input.value), keyframes: input.keyframes.map(key => ({ ...key, value: transform(key.value) })) }, 'path');
	} };
}
