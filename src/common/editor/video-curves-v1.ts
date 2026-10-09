/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import { pointCurvesTransferV1, parametricCurvesTransferV1, curveTransferExpressionV1 } from './video-curve-transfer-v1.ts';
import type { CurveChannelV1, ParametricCurvesParamsV1, PointCurvesParamsV1, PreparedCurvesEffectV1, VideoCurvePointsV1 } from './video-curve-types-v1.ts';

export const CURVES_EFFECT_TYPES_V1 = Object.freeze(['point-curves-v1', 'parametric-curves-v1'] as const);
export const CURVES_PROCESSES_V1 = Object.freeze({ 'point-curves-v1': 'srgb-point-curves-f64-v1', 'parametric-curves-v1': 'srgb-parametric-curves-q16-v1' });
export const CURVES_EFFECT_CODES_V1 = Object.freeze({ 'point-curves-v1': 24, 'parametric-curves-v1': 25 });
const CHANNELS = Object.freeze(['master', 'red', 'green', 'blue'] as const);
const REGIONS = ['Shadows', 'Darks', 'Lights', 'Highlights'] as const;
const IDENTITY = Object.freeze([Object.freeze({ x: 0, y: 0 }), Object.freeze({ x: 1, y: 1 })]);
const PREPARED = new WeakSet<object>(), PREVIEW = new WeakMap<object, PreparedCurvesEffectV1>();
export function isCurvesEffectTypeV1(value: unknown): value is typeof CURVES_EFFECT_TYPES_V1[number] {
	return value === 'point-curves-v1' || value === 'parametric-curves-v1';
}

function number(label: string, labelKey: string, value = 0, min = -100, max = 100, step = 1) {
	return Object.freeze({ label, labelKey, default: value, min, max, step, integer: false, control: 'number' });
}
const pointParams = Object.fromEntries(CHANNELS.map(channel => [channel, Object.freeze({
	label: channel[0]!.toUpperCase() + channel.slice(1), labelKey: `videoEffectCurve${channel[0]!.toUpperCase() + channel.slice(1)}`,
	default: IDENTITY, control: 'curve', maximumPoints: 32,
})]));
const parametricParams = Object.fromEntries(CHANNELS.flatMap(channel => REGIONS.map(region => [`${channel}${region}`,
	number(`${channel[0]!.toUpperCase() + channel.slice(1)} ${region.toLowerCase()}`, `videoEffectCurve${channel[0]!.toUpperCase() + channel.slice(1)}${region}`)])));
Object.assign(parametricParams, { shadowSplit: number('Shadow split', 'videoEffectCurveShadowSplit', 0.25, 0, 1, 0.01),
	midtoneSplit: number('Midtone split', 'videoEffectCurveMidtoneSplit', 0.5, 0, 1, 0.01),
	highlightSplit: number('Highlight split', 'videoEffectCurveHighlightSplit', 0.75, 0, 1, 0.01) });
export const CURVES_VIDEO_EFFECT_DEFINITIONS_V1 = Object.freeze({
	'point-curves-v1': Object.freeze({ type: 'point-curves-v1', label: 'Point curves', labelKey: 'videoEffectPointCurves', shader: 'point-curves-v1',
		ffmpegFilter: CURVES_PROCESSES_V1['point-curves-v1'], params: Object.freeze(pointParams) }),
	'parametric-curves-v1': Object.freeze({ type: 'parametric-curves-v1', label: 'Parametric curves', labelKey: 'videoEffectParametricCurves', shader: 'parametric-curves-v1',
		ffmpegFilter: CURVES_PROCESSES_V1['parametric-curves-v1'], params: Object.freeze(parametricParams) }),
});

export function normalizePointCurvesParamsV1(value: unknown): PointCurvesParamsV1 {
	const input = record(value === undefined ? {} : value, 'point curve parameters', CHANNELS, []);
	const output = {} as Record<CurveChannelV1, VideoCurvePointsV1>;
	for (const channel of CHANNELS) {
		const points = array(Object.hasOwn(input, channel) ? field(input, channel, 'point curve parameters') : IDENTITY, `${channel} curve`, 2, 32);
		let previous = -1;
		output[channel] = Object.freeze(points.map(value => {
			const point = record(value, 'curve point', ['x', 'y']), x = unit(field(point, 'x', 'curve point')), y = unit(field(point, 'y', 'curve point'));
			if (x <= previous) throw new RangeError('Curve x coordinates must strictly increase.'); previous = x;
			return Object.freeze({ x, y });
		}));
		if (output[channel][0]!.x !== 0 || output[channel].at(-1)!.x !== 1) throw new RangeError('Curve x endpoints must be0 and1.');
	}
	return Object.freeze(output);
}
export function normalizeParametricCurvesParamsV1(value: unknown): ParametricCurvesParamsV1 {
	const input = record(value === undefined ? {} : value, 'parametric curve parameters', Object.keys(parametricParams), []), output: Record<string, number> = {};
	for (const [name, descriptor] of Object.entries(parametricParams)) {
		const value = Object.hasOwn(input, name) ? field(input, name, 'parametric curve parameters') : descriptor.default;
		if (typeof value !== 'number' || !Number.isFinite(value) || value < descriptor.min || value > descriptor.max) throw new RangeError(`Invalid parametric curve ${name}.`);
		output[name] = Object.is(value, -0) ? 0 : value;
	}
	if (!(0 < output.shadowSplit! && output.shadowSplit! < output.midtoneSplit! && output.midtoneSplit! < output.highlightSplit! && output.highlightSplit! < 1)) {
		throw new RangeError('Parametric curve splits must strictly increase inside0 through1.');
	}
	return Object.freeze(output);
}
function unit(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Curve coordinates require finite0 through1 values.');
	return Object.is(value, -0) ? 0 : value;
}
export function normalizeCurvesEffectV1(value: unknown) {
	const input = record(value, 'curve effect', ['id', 'type', 'enabled', 'params']);
	const id = field(input, 'id', 'curve effect'), type = field(input, 'type', 'curve effect'), enabled = field(input, 'enabled', 'curve effect');
	if (typeof id !== 'string' || !id.length || id.length > 128) throw new TypeError('Curve effects require a bounded ID.');
	if (!isCurvesEffectTypeV1(type)) throw new RangeError('Unsupported curve process.');
	if (typeof enabled !== 'boolean') throw new TypeError('Curve enabled must be boolean.');
	const params = field(input, 'params', 'curve effect'); if (params === undefined) throw new TypeError('Curve effect parameters are required.');
	return type === 'point-curves-v1' ? Object.freeze({ id, type, enabled, params: normalizePointCurvesParamsV1(params) })
		: Object.freeze({ id, type, enabled, params: normalizeParametricCurvesParamsV1(params) });
}
export function prepareCurvesEffectV1(value: unknown): PreparedCurvesEffectV1 {
	const effect = normalizeCurvesEffectV1(value);
	const neutral = effect.type === 'point-curves-v1' ? CHANNELS.every(channel => effect.params[channel].every(point => point.x === point.y))
		: CHANNELS.every(channel => REGIONS.every(region => effect.params[`${channel}${region}`] === 0));
	const prepared = Object.freeze({ ...effect, neutral }); PREPARED.add(prepared); return prepared;
}
export function createCurvesTransferV1(value: unknown): Uint8Array<ArrayBuffer> {
	const prepared = value && typeof value === 'object' && PREPARED.has(value) ? value as PreparedCurvesEffectV1 : prepareCurvesEffectV1(value);
	if (!prepared.enabled || prepared.neutral) { const bytes = new Uint8Array(1024);
		for (let n = 0; n < 256; n++) bytes.set([n, n, n, 255], n * 4); return bytes; }
	return prepared.type === 'point-curves-v1' ? pointCurvesTransferV1(prepared.params) : parametricCurvesTransferV1(prepared.params);
}
export function curvesPreviewPassV1(value: unknown) {
	const prepared = prepareCurvesEffectV1(value); if (!prepared.enabled || prepared.neutral) return null;
	const pass = Object.freeze({ code: CURVES_EFFECT_CODES_V1[prepared.type], params0: Object.freeze([0, 0, 0, 0]),
		params1: Object.freeze([0, 0, 0, 0]), direction: Object.freeze([0, 0]) });
	PREVIEW.set(pass, prepared); return pass;
}
export function copyCurvesPreviewLookupV1(value: unknown): Uint8Array<ArrayBuffer> {
	const prepared = value && typeof value === 'object' ? PREVIEW.get(value) : undefined;
	if (!prepared) throw new TypeError('Curve transfer requires its owning prepared pass.'); return createCurvesTransferV1(prepared);
}
export function serializeCurvesEffectToFfmpegV1(value: unknown): Readonly<{ expression: string; preserveAlpha: true }> | null {
	const prepared = prepareCurvesEffectV1(value); if (!prepared.enabled || prepared.neutral) return null;
	const bytes = createCurvesTransferV1(prepared);
	try { const expressions = (['r', 'g', 'b'] as const).map((name, channel) => `${name}='${curveTransferExpressionV1(bytes, channel as 0 | 1 | 2, `${name}(X,Y)`)}'`);
		return Object.freeze({ expression: `format=pix_fmts=gbrap,geq=${expressions.join(':')}:a='alpha(X,Y)':interpolation=nearest,format=pix_fmts=rgba`, preserveAlpha: true });
	} finally { bytes.fill(0); }
}
