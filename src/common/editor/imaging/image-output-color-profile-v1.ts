/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';

export const IMAGE_OUTPUT_COLOR_PROFILES_V1 = Object.freeze(['srgb', 'display-p3'] as const);
export type ImageOutputColorProfileV1 = (typeof IMAGE_OUTPUT_COLOR_PROFILES_V1)[number];
export interface PreparedImageOutputColorProfileV1 {
	readonly profile: ImageOutputColorProfileV1;
	readonly bitDepth: 8 | 16;
	readonly source: 'linear-srgb' | 'encoded-srgb8';
}
const prepared = new WeakMap<object, Readonly<PreparedImageOutputColorProfileV1>>();
const TYPED = Object.getPrototypeOf(Float64Array.prototype) as object;
const BUFFER = Object.getOwnPropertyDescriptor(TYPED, 'buffer')!.get!;
const LENGTH = Object.getOwnPropertyDescriptor(TYPED, 'byteLength')!.get!;
const RESIZABLE = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;

export function normalizeImageOutputColorProfileV1(value: unknown): ImageOutputColorProfileV1 {
	if (value !== 'srgb' && value !== 'display-p3') throw new RangeError('Image output requires an explicit sRGB or Display P3 profile.');
	return value;
}

/** Source samples retain their declared working basis. Output selection does
 * not reinterpret a P3 input or promote a byte Develop recipe to float math. */
export function prepareImageOutputColorProfileV1(value: unknown): Readonly<PreparedImageOutputColorProfileV1> {
	const input = record(value, 'image output color profile', ['profile', 'bitDepth', 'source']);
	const profile = normalizeImageOutputColorProfileV1(field(input, 'profile', 'image output color profile'));
	const bitDepth = field(input, 'bitDepth', 'image output color profile'), source = field(input, 'source', 'image output color profile');
	if (bitDepth !== 8 && bitDepth !== 16) throw new RangeError('Image output color depth must be eight or sixteen bits.');
	if (source !== 'linear-srgb' && source !== 'encoded-srgb8') throw new RangeError('Image output color source is not admitted.');
	const result = Object.freeze({ profile, bitDepth, source }); prepared.set(result, result); return result;
}

/** Unclipped linear sRGB/BT709-D65 to target-primary RGB. Coefficients are the
 * composed CSS Color4 rational sRGB→XYZ-D65→Display P3 matrices; both whites
 * are D65, so no chromatic adaptation belongs in this conversion.
 * https://www.w3.org/TR/css-color/#color-conversion-code */
export function writeImageOutputColorLinearV1(profile: ImageOutputColorProfileV1, red: number, green: number, blue: number,
	target: Float64Array<ArrayBuffer>): void {
	const admitted = normalizeImageOutputColorProfileV1(profile); channels(red, green, blue); storage(target, 3);
	forward(admitted, red, green, blue, target);
}

/** Target-primary linear RGB back to unclipped linear sRGB working values.
 * A proof owner can use this after target gamut/depth simulation; these
 * derived samples never replace the authenticated Original or saved recipe. */
export function writeImageOutputColorWorkingV1(profile: ImageOutputColorProfileV1, red: number, green: number, blue: number,
	target: Float64Array<ArrayBuffer>): void {
	const admitted = normalizeImageOutputColorProfileV1(profile); channels(red, green, blue); storage(target, 3);
	if (admitted === 'srgb' || red === green && green === blue) { target[0] = red; target[1] = green; target[2] = blue; return; }
	write(target, red * 1.2249401762805598 - green * .2249401762805598,
		red * -.04205695470968816 + green * 1.0420569547096883,
		red * -.019637554590334432 - green * .07863604555063189 + blue * 1.0982736001409663);
}

/** One reusable caller-owned four-code scratch. RGB converts before the only
 * target clipping/transfer/quantization; straight alpha receives no color
 * transform. There is no tuple allocation or byte working plane per pixel. */
export function writeImageOutputColorPixelV1(plan: Readonly<PreparedImageOutputColorProfileV1>, red: number, green: number, blue: number,
	alpha: number, target: Float64Array<ArrayBuffer>): void {
	const state = typeof plan === 'object' && plan !== null ? prepared.get(plan) : undefined;
	if (!state) throw new TypeError('Image output color writing requires its original prepared profile.');
	channels(red, green, blue); storage(target, 4);
	const maximum = state.bitDepth === 8 ? 255 : 65535;
	if (state.source === 'encoded-srgb8') {
		if (!byte(red) || !byte(green) || !byte(blue) || !byte(alpha)) throw new RangeError('Encoded output samples require native byte codes.');
		const scale = state.bitDepth === 8 ? 1 : 257;
		if (state.profile === 'srgb') { target[0] = red * scale; target[1] = green * scale; target[2] = blue * scale; target[3] = alpha * scale; return; }
		forward(state.profile, decoded(red / 255), decoded(green / 255), decoded(blue / 255), target);
		target[3] = alpha * scale;
	} else {
		if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new RangeError('Linear output alpha must remain finite and within the unit interval.');
		forward(state.profile, red, green, blue, target); target[3] = Math.round(alpha * maximum);
	}
	target[0] = quantize(target[0]!, maximum); target[1] = quantize(target[1]!, maximum); target[2] = quantize(target[2]!, maximum);
}

function forward(profile: ImageOutputColorProfileV1, red: number, green: number, blue: number, target: Float64Array<ArrayBuffer>): void {
	// Neutral axes are exact, including signed zero. sRGB selection is an exact
	// identity; it must not accumulate an unnecessary matrix roundtrip.
	if (profile === 'srgb' || red === green && green === blue) { target[0] = red; target[1] = green; target[2] = blue; return; }
	write(target, red * .8224619687143623 + green * .17753803128563767,
		red * .033194198850961615 + green * .9668058011490384,
		red * .01708263072112004 + green * .07239744066396311 + blue * .9105199286149168);
}
function write(target: Float64Array<ArrayBuffer>, red: number, green: number, blue: number): void {
	channels(red, green, blue); target[0] = red; target[1] = green; target[2] = blue;
}
function channels(red: number, green: number, blue: number): void {
	if (!Number.isFinite(red) || !Number.isFinite(green) || !Number.isFinite(blue)) throw new RangeError('Image output RGB samples must remain finite.');
}
function storage(target: Float64Array<ArrayBuffer>, count: number): void {
	if (Object.getPrototypeOf(target) !== Float64Array.prototype) throw new TypeError('Image output requires native Float64 scratch.');
	const backing = Reflect.apply(BUFFER, target, []) as ArrayBuffer;
	if (Object.getPrototypeOf(backing) !== ArrayBuffer.prototype || RESIZABLE && Reflect.apply(RESIZABLE, backing, []) === true
		|| Number(Reflect.apply(LENGTH, target, [])) < count * 8) throw new TypeError('Image output scratch must remain fixed and large enough.');
}
function decoded(value: number): number { return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }
function byte(value: number): boolean { return Number.isInteger(value) && value >= 0 && value <= 255; }
function quantize(value: number, maximum: number): number {
	const bounded = Math.max(0, Math.min(1, value));
	return Math.round(maximum * (bounded <= .0031308 ? bounded * 12.92 : 1.055 * bounded ** (1 / 2.4) - .055));
}
