/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAeExpression, MotionAeKey, MotionAeMaskMetadata, MotionAeProperty, MotionAeShape, MotionAeText } from './motion-ae-exchange-types.ts';
import { MOTION_AE_EXCHANGE_LIMITS as limits } from './motion-ae-exchange-types.ts';
import { motionArray, motionBoolean, motionEnum, motionNumber, motionRecord } from './motion-values.ts';
import { motionAeCustodyString as motionString } from './motion-ae-custody-string.ts';
import { normalizeMotionAeTextLayout } from './motion-ae-text-layout.ts';
import { normalizeMotionAeVectorStyle } from './motion-ae-shape-custody.ts';

export interface MotionAeCustodyBudget { properties: number; keys: number }
function mask(value: unknown): MotionAeMaskMetadata {
	const r = motionRecord(value, ['mode', 'inverted', 'rotoBezier', 'featherFalloff', 'motionBlur'], 'AE mask metadata');
	return { mode: motionEnum(r.mode, ['none', 'add', 'subtract', 'intersect', 'lighten', 'darken', 'difference'], 'AE mask mode'),
		inverted: motionBoolean(r.inverted, 'AE inverted mask'), rotoBezier: motionBoolean(r.rotoBezier, 'AE RotoBezier mask'),
		featherFalloff: motionEnum(r.featherFalloff, ['linear', 'smooth'], 'AE mask feather falloff'), motionBlur: motionEnum(r.motionBlur, ['same-as-layer', 'on', 'off'], 'AE mask motion blur') };
}
export function motionAeVector(value: unknown, name: string, length?: number, color = false): readonly number[] {
	return motionArray(value, length ?? 4, name, length ?? 1).map((entry) => motionNumber(entry, name, color ? 0 : -1e12, color ? 1 : 1e12));
}
function shape(value: unknown): MotionAeShape {
	const fields = ['closed', 'vertices', 'inTangents', 'outTangents'];
	const r = motionRecord(value, [...fields, 'feather'], 'AE shape', fields);
	const vertices = motionArray(r.vertices, limits.shapeVertices, 'AE shape vertices', 1).map((v) => motionAeVector(v, 'AE vertex', 2) as readonly [number, number]);
	const tangents = (input: unknown) => motionArray(input, vertices.length, 'AE shape tangents', vertices.length).map((v) => motionAeVector(v, 'AE tangent', 2) as readonly [number, number]);
	let feather: MotionAeShape['feather'];
	if (r.feather !== undefined) {
		const f = motionRecord(r.feather, ['segmentLocations', 'relativeLocations', 'radii', 'interpolations', 'tensions', 'types', 'cornerAngles'], 'AE variable feather');
		const segmentLocations = motionArray(f.segmentLocations, limits.shapeVertices, 'AE feather segments', 1).map(v => motionNumber(v, 'AE feather segment', 0, vertices.length - 1));
		const values = (input: unknown) => motionArray(input, segmentLocations.length, 'AE feather values', segmentLocations.length).map(v => motionNumber(v, 'AE feather value'));
		feather = { segmentLocations, relativeLocations: values(f.relativeLocations), radii: values(f.radii), interpolations: values(f.interpolations), tensions: values(f.tensions), types: values(f.types), cornerAngles: values(f.cornerAngles) };
	}
	return { closed: motionBoolean(r.closed, 'AE shape closed'), vertices, inTangents: tangents(r.inTangents), outTangents: tangents(r.outTangents), ...(feather === undefined ? {} : { feather }) };
}
function text(value: unknown): MotionAeText {
	const fields = ['text', 'font', 'fontSize', 'fillColor', 'applyFill', 'applyStroke', 'strokeColor', 'strokeWidth', 'tracking', 'leading', 'autoLeading', 'justification'];
	const r = motionRecord(value, [...fields, 'styleScope', 'styleSupport', 'layout'], 'AE text', fields);
	return { text: motionString(r.text, 'AE text', 262_144, true), font: motionString(r.font, 'AE font', 512), fontSize: motionNumber(r.fontSize, 'AE font size', 0.01, 1e6),
		fillColor: motionAeVector(r.fillColor, 'AE fill color', 3, true) as readonly [number, number, number], applyFill: motionBoolean(r.applyFill, 'AE apply fill'),
		applyStroke: motionBoolean(r.applyStroke, 'AE apply stroke'), strokeColor: motionAeVector(r.strokeColor, 'AE stroke color', 3, true) as readonly [number, number, number],
		strokeWidth: motionNumber(r.strokeWidth, 'AE stroke width', 0, 1e6), tracking: motionNumber(r.tracking, 'AE tracking'), leading: motionNumber(r.leading, 'AE leading', 0, 1e6),
		autoLeading: motionBoolean(r.autoLeading, 'AE auto leading'), justification: motionEnum(r.justification, ['left', 'center', 'right'], 'AE text justification'),
		...(r.styleScope === undefined ? {} : { styleScope: motionEnum(r.styleScope, ['uniform', 'mixed', 'unavailable'], 'AE text style scope') }),
		...(r.styleSupport === undefined ? {} : { styleSupport: motionEnum(r.styleSupport, ['basic', 'unsupported', 'unavailable'], 'AE text style support') }),
		...(r.layout === undefined ? {} : { layout: normalizeMotionAeTextLayout(r.layout) }) };
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
		const d = motionRecord(value, ['kind', 'matchName', 'name', 'children', 'value', 'keys', 'expression', 'spatial', 'reason', 'samples', 'mask', 'enabled', 'vectorStyle'], 'AE property', ['kind']);
		const kind = motionEnum(d.kind, ['group', 'numeric', 'shape', 'text', 'unsupported'], 'AE property kind');
		const fields = kind === 'group' ? ['children'] : kind === 'unsupported' ? ['reason'] : kind === 'numeric' ? ['value', 'keys', 'expression', 'spatial'] : ['value', 'keys', 'expression'];
		const required = ['kind', 'matchName', 'name', ...fields];
		const r = motionRecord(value, kind === 'numeric' ? [...required, 'samples'] : kind === 'group' ? [...required, 'mask', 'enabled', 'vectorStyle'] : required, 'AE property', required);
		const base = { matchName: motionString(r.matchName, 'AE match name', 256), name: motionString(r.name, 'AE property name', 1024, true) };
		if (kind === 'group') {
			if (r.vectorStyle !== undefined && !base.matchName.startsWith('ADBE Vector ')) throw new TypeError('AE vector style metadata requires a vector group.');
			if (r.enabled !== undefined && !base.matchName.startsWith('ADBE Vector ') && base.matchName !== 'ADBE Gaussian Blur 2') throw new TypeError('AE enabled metadata requires a vector or admitted Gaussian effect group.');
			if (r.mask !== undefined && base.matchName !== 'ADBE Mask Atom') throw new TypeError('AE mask metadata requires a mask atom group.');
			return { ...base, kind, children: normalizeMotionAeProperties(r.children, budget, depth + 1), ...(r.mask === undefined ? {} : { mask: mask(r.mask) }), ...(r.enabled === undefined ? {} : { enabled: motionBoolean(r.enabled, 'AE group enabled') }),
				...(r.vectorStyle === undefined ? {} : { vectorStyle: normalizeMotionAeVectorStyle(r.vectorStyle) }) };
		}
		if (kind === 'unsupported') return { ...base, kind, reason: motionString(r.reason, 'AE unsupported reason', 2048) };
		const expr = expression(r.expression);
		if (kind === 'numeric') {
			const numeric = motionAeVector(r.value, 'AE numeric value'), spatial = motionBoolean(r.spatial, 'AE spatial');
			if (spatial && numeric.length !== 2 && numeric.length !== 3) throw new TypeError('AE spatial value must have two or three dimensions.');
			const authored = keys(r.keys, (v) => motionAeVector(v, 'AE key value', numeric.length), numeric.length, spatial, budget);
			const samples = r.samples === undefined ? undefined : numericSamples(r.samples, numeric.length, budget);
			return { ...base, kind, value: numeric, spatial, keys: authored, expression: expr, ...(samples === undefined ? {} : { samples }) };
		}
		if (kind === 'shape') return { ...base, kind, value: shape(r.value), keys: keys(r.keys, shape, 1, false, budget), expression: expr };
		return { ...base, kind, value: text(r.value), keys: keys(r.keys, text, 1, false, budget), expression: expr };
	});
}
function numericSamples(input: unknown, dimensions: number, budget: MotionAeCustodyBudget) {
	const r = motionRecord(input, ['frameRate', 'firstFrame', 'values'], 'AE samples');
	const frameRate = motionNumber(r.frameRate, 'AE sampling frame rate', 0.001, 1000);
	const firstFrame = motionNumber(r.firstFrame, 'AE first sample frame', 0, 1e9);
	if (!Number.isSafeInteger(firstFrame)) throw new RangeError('AE sample grid must start at an integer frame.');
	const values = motionArray(r.values, limits.keysPerProperty, 'AE samples', 1).map((v) => motionAeVector(v, 'AE sample value', dimensions));
	budget.keys += values.length; if (budget.keys > limits.keys) throw new RangeError('AE exchange sample/key budget exceeded.');
	return { frameRate, firstFrame, values };
}
