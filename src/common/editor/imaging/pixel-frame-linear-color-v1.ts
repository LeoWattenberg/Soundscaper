/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { normalizeGlobalDevelopEffectV1 } from '../video-global-develop-v1.ts';
import { normalizeChromaDevelopEffectV1 } from '../video-chroma-develop-v1.ts';
import { normalizeBlackWhiteMixEffectV1 } from '../video-black-white-mix-v1.ts';
import { normalizeHslMixerEffectV1 } from '../video-hsl-mixer-v1.ts';
import { normalizeCurvesEffectV1 } from '../video-curves-v1.ts';
import { colorWheelsGradeV1, normalizeColorWheelsEffectV1 } from '../video-color-wheels-v1.ts';
import { linearGlobalDevelopChannelV1, prepareLinearGlobalEffectsV1, type PreparedLinearGlobalEffectV1 } from './pixel-frame-linear-global-v1.ts';
import { writeLinearChromaEncodedV1, type LinearChromaEffectV1, type LinearColorChannelsV1 } from './pixel-frame-linear-chroma-v1.ts';
import { prepareLinearCurvesV1, writeLinearCurvesEncodedV1, type PreparedLinearCurvesV1 } from './pixel-frame-linear-curves-v1.ts';

type Global = ReturnType<typeof normalizeGlobalDevelopEffectV1>;
type Curves = ReturnType<typeof normalizeCurvesEffectV1>;
type Wheels = ReturnType<typeof normalizeColorWheelsEffectV1>;
type Effect = Global | LinearChromaEffectV1 | Curves | Wheels;
export interface PreparedLinearColorEffectV1 {
	readonly id: string; readonly type: Effect['type']; readonly enabled: true; readonly neutral: false;
}
type State = Readonly<{ kind: 'global'; effect: PreparedLinearGlobalEffectV1 }>
	| Readonly<{ kind: 'chroma'; effect: LinearChromaEffectV1 }>
	| Readonly<{ kind: 'curves'; effect: PreparedLinearCurvesV1 }>
	| Readonly<{ kind: 'wheels'; grade: ReturnType<typeof colorWheelsGradeV1> }>;
const PREPARED = new WeakMap<object, State>();

function normalize(value: unknown): Effect {
	const input = record(value, 'linear color effect', ['id', 'type', 'enabled', 'params']);
	const type = field(input, 'type', 'linear color effect');
	if (type === 'white-balance-v1' || type === 'tone-ladder-v1') return normalizeGlobalDevelopEffectV1(input);
	if (type === 'chroma-v1') return normalizeChromaDevelopEffectV1(input);
	if (type === 'black-white-mix-v1') return normalizeBlackWhiteMixEffectV1(input);
	if (type === 'hsl-mixer-v1') return normalizeHslMixerEffectV1(input);
	if (type === 'point-curves-v1' || type === 'parametric-curves-v1') return normalizeCurvesEffectV1(input);
	if (type === 'color-wheels-v1') return normalizeColorWheelsEffectV1(input);
	throw new RangeError('Unsupported linear color develop family.');
}

/** Full closed metadata, including inactive stages and duplicate IDs, is
 * admitted before any frame pixels. Only detached, immutable prepared identities
 * escape. Foundation V1 and the permanent byte processes remain unchanged. */
export function prepareLinearColorEffectsV1(value: unknown): readonly Readonly<PreparedLinearColorEffectV1>[] {
	const effects = readClosedDomainArray(value, 'linear color develop effects', 0, 256).map(normalize);
	const ids = new Set<string>();
	for (const effect of effects) {
		if (ids.has(effect.id)) throw new RangeError('Linear color develop effects require unique IDs.');
		ids.add(effect.id);
	}
	const result: Readonly<PreparedLinearColorEffectV1>[] = [];
	for (const effect of effects) {
		if (!effect.enabled) continue;
		let state: State;
		switch (effect.type) {
			case 'white-balance-v1': case 'tone-ladder-v1': {
				const global = prepareLinearGlobalEffectsV1([effect])[0]; if (!global) continue;
				state = Object.freeze({ kind: 'global', effect: global }); break;
			}
			case 'point-curves-v1': case 'parametric-curves-v1': {
				const curves = prepareLinearCurvesV1(effect); if (curves.neutral) continue;
				state = Object.freeze({ kind: 'curves', effect: curves }); break;
			}
			case 'color-wheels-v1': {
				if (['shadows', 'midtones', 'highlights'].every(group => effect.params[`${group}Saturation` as keyof typeof effect.params] === 0
					&& effect.params[`${group}Luminance` as keyof typeof effect.params] === 0)) continue;
				state = Object.freeze({ kind: 'wheels', grade: colorWheelsGradeV1(effect.params) }); break;
			}
			default:
				if (effect.type !== 'black-white-mix-v1' && Object.values(effect.params).every(value => value === 0)) continue;
				state = Object.freeze({ kind: 'chroma', effect });
		}
		const prepared = Object.freeze({ id: effect.id, type: effect.type, enabled: true as const, neutral: false as const });
		PREPARED.set(prepared, state); result.push(prepared);
	}
	return Object.freeze(result);
}

function encoded(value: number): number {
	const magnitude = Math.abs(value);
	return Math.sign(value) * (magnitude <= 0.0031308 ? magnitude * 12.92 : 1.055 * magnitude ** (1 / 2.4) - 0.055);
}
function linear(value: number): number {
	const magnitude = Math.abs(value);
	return Math.sign(value) * (magnitude <= 0.04045 ? magnitude / 12.92 : ((magnitude + 0.055) / 1.055) ** 2.4);
}
function wheel(value: number, grade: ReturnType<typeof colorWheelsGradeV1>, channel: 0 | 1 | 2): number {
	const gained = (value + grade.lift[channel]) * grade.gain[channel];
	return grade.gamma[channel] === 1 ? gained : Math.sign(gained) * Math.abs(gained) ** (1 / grade.gamma[channel]);
}

/** One native linear RGB stage, without clipping, transfer quantization or an
 * allocated per-pixel tuple. Encoded-domain families use sign-symmetric extended
 * sRGB transfer. The owner certifies finite Float32 output, stage rounding and
 * alpha; the caller supplies its own mutable scalar target. */
export function writeLinearColorChannelsV1(effect: PreparedLinearColorEffectV1, red: number, green: number, blue: number, target: LinearColorChannelsV1): void {
	const state = PREPARED.get(effect);
	if (!state) throw new TypeError('An owning prepared linear color effect is required.');
	if (typeof red !== 'number' || !Number.isFinite(red) || typeof green !== 'number' || !Number.isFinite(green)
		|| typeof blue !== 'number' || !Number.isFinite(blue)) throw new TypeError('Linear color develop requires finite RGB samples.');
	if (state.kind === 'global') {
		target.red = linearGlobalDevelopChannelV1(state.effect, red, 0);
		target.green = linearGlobalDevelopChannelV1(state.effect, green, 1);
		target.blue = linearGlobalDevelopChannelV1(state.effect, blue, 2); return;
	}
	if (state.kind === 'wheels') {
		target.red = wheel(red, state.grade, 0); target.green = wheel(green, state.grade, 1); target.blue = wheel(blue, state.grade, 2); return;
	}
	const r = encoded(red), g = encoded(green), b = encoded(blue);
	if (state.kind === 'curves') writeLinearCurvesEncodedV1(state.effect, r, g, b, target);
	else writeLinearChromaEncodedV1(state.effect, r, g, b, target);
	// Unchanged channels stay bit-exact instead of making a transfer round trip.
	target.red = target.red === r ? red : linear(target.red);
	target.green = target.green === g ? green : linear(target.green);
	target.blue = target.blue === b ? blue : linear(target.blue);
}
