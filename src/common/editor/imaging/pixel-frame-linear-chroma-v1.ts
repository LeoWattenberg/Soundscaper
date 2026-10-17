/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeChromaDevelopEffectV1 } from '../video-chroma-develop-v1.ts';
import { normalizeBlackWhiteMixEffectV1 } from '../video-black-white-mix-v1.ts';
import { normalizeHslMixerEffectV1 } from '../video-hsl-mixer-v1.ts';

type Chroma = ReturnType<typeof normalizeChromaDevelopEffectV1>;
type BlackWhite = ReturnType<typeof normalizeBlackWhiteMixEffectV1>;
type Hsl = ReturnType<typeof normalizeHslMixerEffectV1>;
export type LinearChromaEffectV1 = Chroma | BlackWhite | Hsl;
export interface LinearColorChannelsV1 { red: number; green: number; blue: number; }
const COLORS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;
const CENTERS = [0, 0.5, 1, 2, 3, 4, 4.5, 5, 6] as const;

function luma(red: number, green: number, blue: number): number { return (54 * red + 183 * green + 19 * blue) / 256; }
function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
function hue(red: number, green: number, blue: number, maximum: number, chroma: number): number {
	const position = maximum === red ? (green - blue) / chroma : maximum === green ? (blue - red) / chroma + 2 : (red - green) / chroma + 4;
	return position < 0 ? position + 6 : position;
}
function band(params: Readonly<Record<string, number>>, position: number, suffix = ''): number {
	let left = 0;
	while (left < 7 && position >= CENTERS[left + 1]!) left++;
	const a = params[`${COLORS[left]!}${suffix}`]!, b = params[`${COLORS[(left + 1) % 8]!}${suffix}`]!;
	return a + (b - a) * ((position - CENTERS[left]!) / (CENTERS[left + 1]! - CENTERS[left]!));
}

/** Admitted, owned numbers only. Coordinates are extended encoded sRGB, never
 * bytes. Only chroma/adaptive weights use a bounded domain; RGB remains unclipped. */
export function writeLinearChromaEncodedV1(effect: LinearChromaEffectV1, red: number, green: number, blue: number, target: LinearColorChannelsV1): void {
	target.red = red; target.green = green; target.blue = blue;
	if (effect.type === 'chroma-v1') {
		const saturation = 1 + effect.params.saturation / 100, firstY = luma(red, green, blue);
		if (saturation !== 1) { red = firstY + (red - firstY) * saturation; green = firstY + (green - firstY) * saturation; blue = firstY + (blue - firstY) * saturation; }
		const factor = 1 + effect.params.vibrance / 100 * (1 - clamp(Math.max(red, green, blue) - Math.min(red, green, blue)));
		if (factor !== 1) { const y = luma(red, green, blue); red = y + (red - y) * factor; green = y + (green - y) * factor; blue = y + (blue - y) * factor; }
		target.red = red; target.green = green; target.blue = blue; return;
	}
	const maximum = Math.max(red, green, blue), minimum = Math.min(red, green, blue), chroma = maximum - minimum;
	if (chroma === 0) return;
	const position = hue(red, green, blue, maximum, chroma);
	if (effect.type === 'black-white-mix-v1') {
		const gray = luma(red, green, blue) + chroma * band(effect.params, position) / 100;
		target.red = gray; target.green = gray; target.blue = gray; return;
	}
	const hueControl = band(effect.params, position, 'Hue'), saturationControl = band(effect.params, position, 'Saturation');
	const luminance = band(effect.params, position, 'Luminance') / 100;
	if (hueControl === 0 && saturationControl === 0 && luminance === 0) return;
	// A fixed affine cube extends the ordinary HSL domain without discarding a
	// signed offset or HDR span. Original hue selects all three control bands.
	const offset = Math.min(0, minimum), span = Math.max(1, maximum - offset);
	const low = (minimum - offset) / span, high = (maximum - offset) / span;
	const lightness = (high + low) / 2, domain = 1 - Math.abs(2 * lightness - 1);
	const saturation = clamp((chroma / span) / domain * (1 + saturationControl / 100));
	const nextLightness = lightness + (luminance >= 0 ? 1 - lightness : lightness) * luminance;
	const nextChroma = (1 - Math.abs(2 * nextLightness - 1)) * saturation;
	const turn = hueControl / 60;
	if (turn === 0) {
		const base = nextLightness - nextChroma / 2;
		target.red = offset + span * (base + nextChroma * (red - minimum) / chroma);
		target.green = offset + span * (base + nextChroma * (green - minimum) / chroma);
		target.blue = offset + span * (base + nextChroma * (blue - minimum) / chroma); return;
	}
	const phase = ((position + turn) % 6 + 6) % 6, sector = Math.floor(phase);
	const x = nextChroma * (1 - Math.abs(phase % 2 - 1)), base = nextLightness - nextChroma / 2;
	const r = sector === 0 || sector === 5 ? nextChroma : sector === 1 || sector === 4 ? x : 0;
	const g = sector === 1 || sector === 2 ? nextChroma : sector === 0 || sector === 3 ? x : 0;
	const b = sector === 3 || sector === 4 ? nextChroma : sector === 2 || sector === 5 ? x : 0;
	target.red = offset + span * (base + r); target.green = offset + span * (base + g); target.blue = offset + span * (base + b);
}
