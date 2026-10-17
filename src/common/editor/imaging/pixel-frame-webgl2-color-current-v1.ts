/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray as array, readClosedDomainField as field, readClosedDomainRecord as record } from '../closed-domain-value.ts';
import { normalizeGlobalDevelopEffectV1 } from '../video-global-develop-v1.ts';
import { normalizeChromaDevelopEffectV1 } from '../video-chroma-develop-v1.ts';
import { normalizeBlackWhiteMixEffectV1 } from '../video-black-white-mix-v1.ts';
import { normalizeHslMixerEffectV1 } from '../video-hsl-mixer-v1.ts';
import { normalizeCurvesEffectV1 } from '../video-curves-v1.ts';
import { colorWheelsGradeV1, normalizeColorWheelsEffectV1 } from '../video-color-wheels-v1.ts';
import { prepareLinearColorEffectsV1, writeLinearColorChannelsV1, type PreparedLinearColorEffectV1 } from './pixel-frame-linear-color-v1.ts';
import type { LinearColorChannelsV1 } from './pixel-frame-linear-chroma-v1.ts';
import { prepareLinearCurveMetadataCurrentV1, type LinearCurveMetadataCurrentV1 } from './linear-curve-metadata-current-v1.ts';
import { preparePixelFrameWebGl2GlobalsCurrentV1, readPixelFrameWebGl2GlobalCurrentV1,
	pixelFrameWebGl2GlobalChannelCurrentV1, type PreparedPixelFrameWebGl2GlobalCurrentV1 } from './pixel-frame-webgl2-global-current-v1.ts';

type Tuple = readonly [number, number, number, number];
type Bands = readonly [Tuple, Tuple, Tuple, Tuple, Tuple, Tuple, Tuple, Tuple];
type Effect = ReturnType<typeof normalizeGlobalDevelopEffectV1> | ReturnType<typeof normalizeChromaDevelopEffectV1>
	| ReturnType<typeof normalizeBlackWhiteMixEffectV1> | ReturnType<typeof normalizeHslMixerEffectV1>
	| ReturnType<typeof normalizeCurvesEffectV1> | ReturnType<typeof normalizeColorWheelsEffectV1>;
export interface PreparedPixelFrameWebGl2ColorCurrentV1 {
	readonly id: string;
	readonly type: Effect['type'];
	readonly kind: 1 | 2 | 3 | 4 | 5 | 6 | 7;
	readonly params0: Tuple;
	readonly params1: Tuple;
	readonly params2: Tuple;
	readonly bands: Bands;
	readonly curveCounts: Tuple;
	readonly curvePoints: readonly number[];
	readonly supported: boolean;
}
export const PIXEL_FRAME_WEBGL2_COLOR_SCRATCH_BYTES_CURRENT_V1 = 4096;
type State = Readonly<{ kind: 'native'; effect: Readonly<PreparedLinearColorEffectV1> }>
	| Readonly<{ kind: 'global'; effect: Readonly<PreparedPixelFrameWebGl2GlobalCurrentV1> }>;
type Data = Omit<PreparedPixelFrameWebGl2ColorCurrentV1, 'supported'>;
const PREPARED = new WeakMap<object, State>();
const OLD = new WeakMap<object, Readonly<PreparedPixelFrameWebGl2ColorCurrentV1>>();
const COLORS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;
const CHANNELS = ['master', 'red', 'green', 'blue'] as const;
const tuple = (a = 0, b = 0, c = 0, d = 0): Tuple => Object.freeze([a, b, c, d]);
const ZERO = tuple(), ZERO_BANDS: Bands = Object.freeze([ZERO, ZERO, ZERO, ZERO, ZERO, ZERO, ZERO, ZERO]);
const ZERO_POINTS = Object.freeze(Array<number>(256).fill(0));

function normalize(value: unknown): Effect {
	const input = record(value, 'native GPU color effect', ['id', 'type', 'enabled', 'params']);
	const own = Object.freeze({ id: field(input, 'id', 'native GPU color effect'), type: field(input, 'type', 'native GPU color effect'),
		enabled: field(input, 'enabled', 'native GPU color effect'), params: field(input, 'params', 'native GPU color effect') });
	switch (own.type) {
		case 'white-balance-v1': case 'tone-ladder-v1': return normalizeGlobalDevelopEffectV1(own);
		case 'chroma-v1': return normalizeChromaDevelopEffectV1(own);
		case 'black-white-mix-v1': return normalizeBlackWhiteMixEffectV1(own);
		case 'hsl-mixer-v1': return normalizeHslMixerEffectV1(own);
		case 'point-curves-v1': case 'parametric-curves-v1': return normalizeCurvesEffectV1(own);
		case 'color-wheels-v1': return normalizeColorWheelsEffectV1(own);
		default: throw new RangeError('Unsupported native GPU color family.');
	}
}
function base(effect: Pick<Effect, 'id' | 'type'>, kind: Data['kind']): Data {
	return { id: effect.id, type: effect.type, kind, params0: ZERO, params1: ZERO, params2: ZERO,
		bands: ZERO_BANDS, curveCounts: ZERO, curvePoints: ZERO_POINTS };
}
function own(data: Data, state: State, supported = true): Readonly<PreparedPixelFrameWebGl2ColorCurrentV1> {
	const numbers = [...data.params0, ...data.params1, ...data.params2, ...data.bands.flat(), ...data.curveCounts, ...data.curvePoints];
	const pass = Object.freeze({ ...data, supported: supported && numbers.every(value => Number.isFinite(value) && Number.isFinite(Math.fround(value))) });
	PREPARED.set(pass, Object.freeze(state)); return pass;
}
function bands(read: (color: typeof COLORS[number]) => Tuple): Bands {
	return Object.freeze([read('red'), read('orange'), read('yellow'), read('green'), read('aqua'), read('blue'), read('purple'), read('magenta')]);
}

function curves(effect: Effect & { type: 'point-curves-v1' | 'parametric-curves-v1' }) {
	const metadata = prepareLinearCurveMetadataCurrentV1(effect), values = Array<number>(256).fill(0);
	let supported = true;
	for (const [channelIndex, name] of CHANNELS.entries()) {
		const points = metadata.channels[name].points;
		for (const [index, point] of points.entries()) {
			values[channelIndex * 64 + index * 2] = point.x; values[channelIndex * 64 + index * 2 + 1] = point.y;
			if (index === 0) continue;
			const previous = points[index - 1]!;
			if (point.x === previous.x) continue;
			const slope = (point.y - previous.y) / (point.x - previous.x);
			if (Math.fround(point.x) === Math.fround(previous.x) || !Number.isFinite(slope) || !Number.isFinite(Math.fround(slope))) supported = false;
		}
	}
	const flags = (name: keyof LinearCurveMetadataCurrentV1['channels']) => metadata.channels[name].identity ? 1 : 0;
	return { supported, params0: tuple(flags('master'), flags('red'), flags('green'), flags('blue')),
		curveCounts: tuple(metadata.channels.master.points.length, metadata.channels.red.points.length,
			metadata.channels.green.points.length, metadata.channels.blue.points.length), curvePoints: Object.freeze(values) };
}

/** Capture every closed family once from caller metadata, including inactive
 * effects. The normative CPU preparation then decides activity from that owned
 * immutable snapshot. Uniform rounding never decides authored identity. */
export function preparePixelFrameWebGl2ColorsCurrentV1(value: unknown): readonly Readonly<PreparedPixelFrameWebGl2ColorCurrentV1>[] {
	const effects = array(value, 'native GPU color effects', 0, 256).map(normalize);
	const active = prepareLinearColorEffectsV1(effects), byId = new Map(effects.map(effect => [effect.id, effect] as const));
	return Object.freeze(active.map(native => {
		const effect = byId.get(native.id)!;
		let data: Data, supported = true;
		switch (effect.type) {
			case 'white-balance-v1': case 'tone-ladder-v1': {
				const global = preparePixelFrameWebGl2GlobalsCurrentV1([effect])[0]!;
				data = { ...base(effect, effect.type === 'white-balance-v1' ? 1 : 2), params0: global.params0, params1: global.params1 }; break;
			}
			case 'chroma-v1': data = { ...base(effect, 3), params0: tuple(effect.params.saturation, effect.params.vibrance) }; break;
			case 'black-white-mix-v1': data = { ...base(effect, 4), bands: bands(color => tuple(effect.params[color])) }; break;
			case 'hsl-mixer-v1': data = { ...base(effect, 5), bands: bands(color => tuple(effect.params[`${color}Hue`], effect.params[`${color}Saturation`], effect.params[`${color}Luminance`])) }; break;
			case 'point-curves-v1': case 'parametric-curves-v1': {
				const curve = curves(effect); supported = curve.supported;
				data = { ...base(effect, 6), params0: curve.params0, curveCounts: curve.curveCounts, curvePoints: curve.curvePoints }; break;
			}
			case 'color-wheels-v1': {
				const grade = colorWheelsGradeV1(effect.params);
				data = { ...base(effect, 7), params0: tuple(...grade.lift), params1: tuple(...grade.gain), params2: tuple(...grade.gamma) }; break;
			}
		}
		return own(data, { kind: 'native', effect: native }, supported);
	}));
}

/** An old owning global remains admissible without exposing or reflecting its
 * scalar authority. Its expanded descriptor is private and cached once. */
export function readPixelFrameWebGl2ColorCurrentV1(value: unknown): Readonly<PreparedPixelFrameWebGl2ColorCurrentV1> {
	if (typeof value === 'object' && value !== null && PREPARED.has(value)) return value as Readonly<PreparedPixelFrameWebGl2ColorCurrentV1>;
	const global = readPixelFrameWebGl2GlobalCurrentV1(value);
	let pass = OLD.get(global);
	if (!pass) {
		pass = own({ ...base(global, global.type === 'white-balance-v1' ? 1 : 2), params0: global.params0, params1: global.params1 }, { kind: 'global', effect: global });
		OLD.set(global, pass);
	}
	return pass;
}

/** Normative Double channels are retained for streamed GPU conformance checks;
 * the caller alone owns its mutable result tuple and Float32 stage store. */
export function writePixelFrameWebGl2ColorChannelsCurrentV1(value: unknown, red: number, green: number, blue: number, target: LinearColorChannelsV1): void {
	const pass = readPixelFrameWebGl2ColorCurrentV1(value), state = PREPARED.get(pass)!;
	if (typeof red !== 'number' || !Number.isFinite(red) || typeof green !== 'number' || !Number.isFinite(green)
		|| typeof blue !== 'number' || !Number.isFinite(blue)) throw new TypeError('Native GPU color requires finite RGB samples.');
	if (state.kind === 'native') { writeLinearColorChannelsV1(state.effect, red, green, blue, target); return; }
	target.red = pixelFrameWebGl2GlobalChannelCurrentV1(state.effect, red, 0);
	target.green = pixelFrameWebGl2GlobalChannelCurrentV1(state.effect, green, 1);
	target.blue = pixelFrameWebGl2GlobalChannelCurrentV1(state.effect, blue, 2);
}
