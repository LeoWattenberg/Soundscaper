/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import type { VideoColorGradeV1 } from './video-color-management-v27.ts';
import { COLOR_WHEELS_SCALAR_PROCESS_V1, normalizeScalarColorWheelsGradeV1, prepareScalarColorWheelsGradeV1, scalarColorWheelsByteV1, type ScalarColorWheelsGradeV1 } from './video-color-wheels-scalar-v1.ts';

/** Straight encoded UNORM8 sRGB → managed linear Rec.709 LGG → sRGB byte rounding.
 * Shadows/midtones/highlights are overlapping lift/gamma/gain wheels, not hard tonal bands.
 * Scalar half-up rounding is explicitly independent of legacy GradeV1's
 * floating luminance recombination. Only nine authored numbers persist;
 * a private derived 1KiB table is transient. */
export const COLOR_WHEELS_PROCESS_V1 = COLOR_WHEELS_SCALAR_PROCESS_V1;
export const COLOR_WHEELS_EFFECT_TYPE_V1 = 'color-wheels-v1';
export const COLOR_WHEELS_EFFECT_CODE_V1 = 26;
export const COLOR_WHEEL_GROUPS_V1 = Object.freeze(['shadows', 'midtones', 'highlights'] as const);
type Group = typeof COLOR_WHEEL_GROUPS_V1[number];
type Parameter = `${Group}${'Hue' | 'Saturation' | 'Luminance'}`;
export type ColorWheelsParamsV1 = Readonly<Record<Parameter, number>>;
const FIELDS = COLOR_WHEEL_GROUPS_V1.flatMap(group => [`${group}Hue`, `${group}Saturation`, `${group}Luminance`] as const);
const params = Object.fromEntries(COLOR_WHEEL_GROUPS_V1.flatMap(group => {
	const title = group[0]!.toUpperCase() + group.slice(1);
	return [['Hue', -180, 180], ['Saturation', 0, 100], ['Luminance', -100, 100]].map(([name, min, max]) => [`${group}${String(name)}`,
		Object.freeze({ label: `${title} ${String(name).toLowerCase()}`, labelKey: `videoEffectWheel${title}${String(name)}`,
			default: 0, min, max, step: name === 'Hue' ? 1 : 0.1, integer: false, control: 'number' })]);
}));
export const COLOR_WHEELS_VIDEO_EFFECT_DEFINITION_V1 = Object.freeze({
	type: COLOR_WHEELS_EFFECT_TYPE_V1, label: 'Color grading wheels', labelKey: 'videoEffectColorWheels',
	shader: COLOR_WHEELS_EFFECT_TYPE_V1, ffmpegFilter: COLOR_WHEELS_PROCESS_V1, params: Object.freeze(params),
});
export interface PreparedColorWheelsEffectV1 {
	readonly id: string;
	readonly type: typeof COLOR_WHEELS_EFFECT_TYPE_V1;
	readonly enabled: boolean;
	readonly neutral: boolean;
	readonly params: ColorWheelsParamsV1;
	readonly grade: VideoColorGradeV1;
}
interface PreparedState { live: boolean; readonly table: Uint8Array<ArrayBuffer> | null }
const PREPARED = new WeakMap<object, PreparedState>(), PREVIEW = new WeakMap<object, Readonly<ScalarColorWheelsGradeV1>>();
const SLICE = Uint8Array.prototype.slice;

export function normalizeColorWheelsParamsV1(value: unknown): ColorWheelsParamsV1 {
	const input = record(value === undefined ? {} : value, 'color wheel parameters', FIELDS, []), output = {} as Record<Parameter, number>;
	for (const key of FIELDS) {
		const value = Object.hasOwn(input, key) ? field(input, key, 'color wheel parameters') : 0;
		const minimum = key.endsWith('Hue') ? -180 : key.endsWith('Saturation') ? 0 : -100;
		const maximum = key.endsWith('Hue') ? 180 : 100;
		if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
			throw new RangeError(`Color wheel ${key} is outside its numeric bound.`);
		}
		output[key] = Object.is(value, -0) ? 0 : value;
	}
	return Object.freeze(output);
}

export function normalizeColorWheelsEffectV1(value: unknown) {
	const input = record(value, 'color wheel effect', ['id', 'type', 'enabled', 'params']);
	const id = field(input, 'id', 'color wheel effect'), type = field(input, 'type', 'color wheel effect'), enabled = field(input, 'enabled', 'color wheel effect');
	if (typeof id !== 'string' || !id.length || id.length > 128) throw new TypeError('Color wheels require a bounded effect ID.');
	if (type !== COLOR_WHEELS_EFFECT_TYPE_V1) throw new RangeError('Unsupported color wheel process.');
	if (typeof enabled !== 'boolean') throw new TypeError('Color wheel enabled must be boolean.');
	const raw = field(input, 'params', 'color wheel effect'); if (raw === undefined) throw new TypeError('Color wheel parameters are required.');
	return Object.freeze({ id, type, enabled, params: normalizeColorWheelsParamsV1(raw) });
}

/** Hue has the six piecewise-linear HSV primary/secondary knots. Removing
 * Rec.709 luma makes saturation a zero-luma offset before the LGG transform. */
function chroma(params: ColorWheelsParamsV1, group: Group): readonly number[] {
	const position = ((params[`${group}Hue`] + 360) % 360) / 60, sector = Math.floor(position), fraction = position - sector;
	const rgb = [[1, fraction, 0], [1 - fraction, 1, 0], [0, 1, fraction],
		[0, 1 - fraction, 1], [fraction, 0, 1], [1, 0, 1 - fraction]][sector]!;
	const luma = rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722, amount = params[`${group}Saturation`] / 100;
	return rgb.map(value => (value - luma) * amount);
}
function grade(params: ColorWheelsParamsV1): VideoColorGradeV1 {
	const shadows = chroma(params, 'shadows'), midtones = chroma(params, 'midtones'), highlights = chroma(params, 'highlights');
	return normalizeScalarColorWheelsGradeV1({ schemaVersion: 1, exposureStops: 0, contrast: 1, pivot: 0.18,
		lift: shadows.map(value => 0.25 * (params.shadowsLuminance / 100 + value)),
		gamma: midtones.map(value => 2 ** (params.midtonesLuminance / 100 + value)),
		gain: highlights.map(value => 2 ** (params.highlightsLuminance / 100 + value)), saturation: 1, lut: null });
}
export function colorWheelsGradeV1(value: unknown): VideoColorGradeV1 { return grade(normalizeColorWheelsParamsV1(value)); }

function neutral(params: ColorWheelsParamsV1): boolean {
	return COLOR_WHEEL_GROUPS_V1.every(group => params[`${group}Saturation`] === 0 && params[`${group}Luminance`] === 0);
}

export function prepareColorWheelsEffectV1(value: unknown): Readonly<PreparedColorWheelsEffectV1> {
	const effect = normalizeColorWheelsEffectV1(value), prepared = Object.freeze({ ...effect, neutral: neutral(effect.params), grade: grade(effect.params) });
	const table = effect.enabled && !prepared.neutral ? transfer(prepared.grade) : null;
	PREPARED.set(prepared, { live: true, table }); return prepared;
}

function transfer(grade: VideoColorGradeV1): Uint8Array<ArrayBuffer> {
	return scalarTransfer(prepareScalarColorWheelsGradeV1(grade));
}
function scalarTransfer(prepared: ScalarColorWheelsGradeV1): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(1024);
	try {
		// The new scalar process owns exact independent-channel byte rounding.
		for (let byte = 0; byte < 256; byte++) {
			for (const channel of [0, 1, 2] as const) bytes[byte * 4 + channel] = scalarColorWheelsByteV1(prepared, byte, channel);
			bytes[byte * 4 + 3] = 255;
		}
		return bytes;
	} catch (error) { bytes.fill(0); throw error; }
}

function state(value: unknown): PreparedState {
	const own = value && typeof value === 'object' ? PREPARED.get(value) : undefined;
	if (!own?.live) throw new TypeError('Color wheels require their live owning prepared effect.'); return own;
}
/** Pixel-loop callers retire each preparation in their finally path. */
export function releaseColorWheelsEffectV1(value: PreparedColorWheelsEffectV1): void {
	const own = PREPARED.get(value); if (!own) throw new TypeError('Unowned color wheel preparation.');
	if (!own.live) return; own.live = false; own.table?.fill(0);
}
export function colorWheelsByteChannelV1(prepared: PreparedColorWheelsEffectV1, byte: number, channel: 0 | 1 | 2): number {
	const own = state(prepared);
	if (!Number.isInteger(byte) || byte < 0 || byte > 255 || (channel !== 0 && channel !== 1 && channel !== 2)) throw new RangeError('Invalid color wheel byte channel.');
	return own.table ? own.table[byte * 4 + channel]! : byte;
}
export function createColorWheelsTransferV1(value: unknown): Uint8Array<ArrayBuffer> {
	const borrowed = value && typeof value === 'object' && PREPARED.has(value), prepared = borrowed ? value as PreparedColorWheelsEffectV1 : prepareColorWheelsEffectV1(value);
	try {
		const own = state(prepared); if (own.table) return Reflect.apply(SLICE, own.table, []) as Uint8Array<ArrayBuffer>;
		const bytes = new Uint8Array(1024); for (let byte = 0; byte < 256; byte++) bytes.set([byte, byte, byte, 255], byte * 4); return bytes;
	} finally { if (!borrowed) releaseColorWheelsEffectV1(prepared); }
}

export function colorWheelsPreviewPassV1(value: unknown) {
	const effect = normalizeColorWheelsEffectV1(value); if (!effect.enabled || neutral(effect.params)) return null;
	const admitted = prepareScalarColorWheelsGradeV1(grade(effect.params));
	const pass = Object.freeze({ code: COLOR_WHEELS_EFFECT_CODE_V1, params0: Object.freeze([0, 0, 0, 0]),
		params1: Object.freeze([0, 0, 0, 0]), direction: Object.freeze([0, 0]) });
	// Planning retains only immutable admitted numbers; native upload derives
	// and owns the sole transient1KiB table through its finally retirement.
	PREVIEW.set(pass, admitted); return pass;
}
export function copyColorWheelsPreviewLookupV1(value: unknown): Uint8Array<ArrayBuffer> {
	assertColorWheelsPreviewPassV1(value);
	const admitted = value && typeof value === 'object' ? PREVIEW.get(value) : undefined;
	if (!admitted) throw new TypeError('Color wheel transfer requires its owning preview pass.');
	return scalarTransfer(admitted);
}
/** Cached native upload use still requires a live owning recipe identity. */
export function assertColorWheelsPreviewPassV1(value: unknown): void {
	if (!value || typeof value !== 'object' || !PREVIEW.has(value)) throw new TypeError('Color wheels require their live owning preview pass.');
}
/** The preview owner retires its numeric recipe binding after native rendering settles. */
export function releaseColorWheelsPreviewPassV1(value: object): void {
	PREVIEW.delete(value);
}

export function serializeColorWheelsEffectToFfmpegV1(value: unknown): Readonly<{ expression: string; preserveAlpha: true }> | null {
	const prepared = prepareColorWheelsEffectV1(value); let bytes: Uint8Array | undefined;
	try {
		if (!prepared.enabled || prepared.neutral) return null; bytes = createColorWheelsTransferV1(prepared);
		const own = bytes, expression = (['r', 'g', 'b'] as const).map((name, channel) => {
			const sample = `${name}(X,Y)`;
			const lookup = (first: number, last: number): string => {
				if (first === last) return String(own[first * 4 + channel]!);
				const middle = Math.floor((first + last) / 2);
				return `if(lte(${sample},${String(middle)}),${lookup(first, middle)},${lookup(middle + 1, last)})`;
			};
			return `${name}='${lookup(0, 255)}'`;
		});
		return Object.freeze({ expression: `format=pix_fmts=gbrap,geq=${expression.join(':')}:a='alpha(X,Y)':interpolation=nearest,format=pix_fmts=rgba`, preserveAlpha: true });
	} finally { bytes?.fill(0); releaseColorWheelsEffectV1(prepared); }
}
