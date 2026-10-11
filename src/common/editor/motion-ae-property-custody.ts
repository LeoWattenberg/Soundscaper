/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeExpression, MotionAeKey, MotionAeProperty, MotionAeShape, MotionAeText } from './motion-ae-exchange-types.ts';
import { MOTION_AE_EXCHANGE_LIMITS as limits } from './motion-ae-exchange-types.ts';
import { motionArray, motionBoolean, motionEnum, motionNumber, motionRecord } from './motion-values.ts';
import { motionAeCustodyString as motionString } from './motion-ae-custody-string.ts';

export interface MotionAeCustodyBudget { properties: number; keys: number }
export function motionAeVector(value: unknown, name: string, length?: number, color = false): readonly number[] {
	return motionArray(value, length ?? 4, name, length ?? 1).map((entry) => motionNumber(entry, name, color ? 0 : -1e12, color ? 1 : 1e12));
}
function shape(value: unknown): MotionAeShape {
	const r = motionRecord(value, ['closed', 'vertices', 'inTangents', 'outTangents'], 'AE shape');
	const vertices = motionArray(r.vertices, limits.shapeVertices, 'AE shape vertices', 1).map((v) => motionAeVector(v, 'AE vertex', 2) as readonly [number, number]);
	const tangents = (input: unknown) => motionArray(input, vertices.length, 'AE shape tangents', vertices.length).map((v) => motionAeVector(v, 'AE tangent', 2) as readonly [number, number]);
	return { closed: motionBoolean(r.closed, 'AE shape closed'), vertices, inTangents: tangents(r.inTangents), outTangents: tangents(r.outTangents) };
}
function text(value: unknown): MotionAeText {
	const r = motionRecord(value, ['text', 'font', 'fontSize', 'fillColor', 'applyFill', 'applyStroke', 'strokeColor', 'strokeWidth', 'tracking', 'leading', 'autoLeading', 'justification'], 'AE text');
	return { text: motionString(r.text, 'AE text', 262_144, true), font: motionString(r.font, 'AE font', 512), fontSize: motionNumber(r.fontSize, 'AE font size', 0.01, 1e6),
		fillColor: motionAeVector(r.fillColor, 'AE fill color', 3, true) as readonly [number, number, number], applyFill: motionBoolean(r.applyFill, 'AE apply fill'),
		applyStroke: motionBoolean(r.applyStroke, 'AE apply stroke'), strokeColor: motionAeVector(r.strokeColor, 'AE stroke color', 3, true) as readonly [number, number, number],
		strokeWidth: motionNumber(r.strokeWidth, 'AE stroke width', 0, 1e6), tracking: motionNumber(r.tracking, 'AE tracking'), leading: motionNumber(r.leading, 'AE leading', 0, 1e6),
		autoLeading: motionBoolean(r.autoLeading, 'AE auto leading'), justification: motionEnum(r.justification, ['left', 'center', 'right'], 'AE text justification') };
}
function expression(value: unknown): MotionAeExpression | null {
	if (value === null) return null;
	const r = motionRecord(value, ['source', 'enabled', 'disposition'], 'AE expression');
	return { source: motionString(r.source, 'AE expression source', 65_536, true), enabled: motionBoolean(r.enabled, 'AE expression enabled'),
		disposition: motionEnum(r.disposition, ['translated', 'sampled', 'unsupported'], 'AE expression disposition') };
}
function keys<Value>(input: unknown, read: (v: unknown) => Value, dimensions: number, spatial: boolean, budget: MotionAeCustodyBudget): readonly MotionAeKey<Value>[] {
	const values = motionArray(input, limits.keysPerProperty, 'AE property keys');
	budget.keys += values.length; if (budget.keys > limits.keys) throw new RangeError('AE exchange key budget exceeded.');
	const result = values.map((value) => {
		const r = motionRecord(value, ['time', 'value', 'inInterpolation', 'outInterpolation', 'inEase', 'outEase', 'inSpatialTangent', 'outSpatialTangent', 'roving'], 'AE key');
		const easeDimensions = spatial || dimensions === 4 ? 1 : dimensions;
		const ease = (input: unknown) => motionArray(input, easeDimensions, 'AE temporal ease', easeDimensions).map((entry) => {
			const e = motionRecord(entry, ['speed', 'influence'], 'AE temporal ease'); return { speed: motionNumber(e.speed, 'AE ease speed'), influence: motionNumber(e.influence, 'AE ease influence', 0.1, 100) };
		});
		const tangent = (input: unknown) => spatial ? motionAeVector(input, 'AE spatial tangent', dimensions) : input === null ? null : (() => { throw new TypeError('Non-spatial AE key cannot carry spatial tangents.'); })();
		const roving = motionBoolean(r.roving, 'AE key roving'); if (roving && !spatial) throw new TypeError('AE roving keys require a spatial property.');
		return { time: motionNumber(r.time, 'AE key time', -1e6, 1e6), value: read(r.value),
			inInterpolation: motionEnum(r.inInterpolation, ['hold', 'linear', 'bezier'], 'AE in interpolation'), outInterpolation: motionEnum(r.outInterpolation, ['hold', 'linear', 'bezier'], 'AE out interpolation'),
			inEase: ease(r.inEase), outEase: ease(r.outEase), inSpatialTangent: tangent(r.inSpatialTangent), outSpatialTangent: tangent(r.outSpatialTangent), roving };
	});
	for (let i = 1; i < result.length; i++) if (result[i - 1]!.time >= result[i]!.time) throw new RangeError('AE keys must have strictly increasing times.');
	return result;
}
export function normalizeMotionAeProperties(input: unknown, budget: MotionAeCustodyBudget, depth = 0): readonly MotionAeProperty[] {
	if (depth > limits.propertyDepth) throw new RangeError('AE property depth budget exceeded.');
	return motionArray(input, limits.properties, 'AE properties').map((value): MotionAeProperty => {
		budget.properties++; if (budget.properties > limits.properties) throw new RangeError('AE property budget exceeded.');
		const d = motionRecord(value, ['kind', 'matchName', 'name', 'children', 'value', 'keys', 'expression', 'spatial', 'reason'], 'AE property', ['kind']);
		const kind = motionEnum(d.kind, ['group', 'numeric', 'shape', 'text', 'unsupported'], 'AE property kind');
		const fields = kind === 'group' ? ['children'] : kind === 'unsupported' ? ['reason'] : kind === 'numeric' ? ['value', 'keys', 'expression', 'spatial'] : ['value', 'keys', 'expression'];
		const r = motionRecord(value, ['kind', 'matchName', 'name', ...fields], 'AE property');
		const base = { matchName: motionString(r.matchName, 'AE match name', 256), name: motionString(r.name, 'AE property name', 1024, true) };
		if (kind === 'group') return { ...base, kind, children: normalizeMotionAeProperties(r.children, budget, depth + 1) };
		if (kind === 'unsupported') return { ...base, kind, reason: motionString(r.reason, 'AE unsupported reason', 2048) };
		const expr = expression(r.expression);
		if (kind === 'numeric') {
			const numeric = motionAeVector(r.value, 'AE numeric value'), spatial = motionBoolean(r.spatial, 'AE spatial');
			if (spatial && numeric.length !== 2 && numeric.length !== 3) throw new TypeError('AE spatial value must have two or three dimensions.');
			return { ...base, kind, value: numeric, spatial, keys: keys(r.keys, (v) => motionAeVector(v, 'AE key value', numeric.length), numeric.length, spatial, budget), expression: expr };
		}
		if (kind === 'shape') return { ...base, kind, value: shape(r.value), keys: keys(r.keys, shape, 1, false, budget), expression: expr };
		return { ...base, kind, value: text(r.value), keys: keys(r.keys, text, 1, false, budget), expression: expr };
	});
}
