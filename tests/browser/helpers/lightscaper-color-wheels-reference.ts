/* SPDX-License-Identifier: AGPL-3.0-only */

import { CURVE_PNG_BASE64, CURVE_SOURCE } from './lightscaper-curve-reference.ts';

/** The same literal two-row RGBA8 PNG; no stored facts, profile or recipe is injected. */
export const WHEEL_PNG_BASE64 = CURVE_PNG_BASE64;
export const WHEEL_SOURCE = CURVE_SOURCE;
const NEUTRAL = Object.freeze({ shadowsHue: 0, shadowsSaturation: 0, shadowsLuminance: 0,
	midtonesHue: 0, midtonesSaturation: 0, midtonesLuminance: 0, highlightsHue: 0, highlightsSaturation: 0, highlightsLuminance: 0 });

/** Literal independent sRGB→linear LGG→sRGB half-up references. Shadow red
 * lift is exactly [0.19685,-0.05315,-0.05315]; highlight gain is exactly2.
 * Browser expectations never invoke the production scalar/table evaluator. */
export const WHEEL_REFERENCES = Object.freeze([
	Object.freeze({ name: 'red shadow lift', params: Object.freeze({ ...NEUTRAL, shadowsSaturation: 100 }),
		pixels: Object.freeze([123,0,0,255,136,112,183,255,172,112,112,255,255,217,0,255]), low: 2, high: 1,
		bins: Object.freeze({ red: pairs([[123,1],[136,1],[172,1],[255,1]]), green: pairs([[0,1],[112,2],[217,1]]), blue: pairs([[0,2],[112,1],[183,1]]) }) }),
	Object.freeze({ name: 'highlight gain two', params: Object.freeze({ ...NEUTRAL, highlightsLuminance: 100 }),
		pixels: Object.freeze([0,47,90,255,90,176,255,255,176,176,176,255,255,255,26,255]), low: 1, high: 2,
		bins: Object.freeze({ red: pairs([[0,1],[90,1],[176,1],[255,1]]), green: pairs([[47,1],[176,2],[255,1]]), blue: pairs([[26,1],[90,1],[176,1],[255,1]]) }) }),
]);
function pairs(values: readonly (readonly [number, number])[]): readonly (readonly [number, number])[] {
	return Object.freeze(values.map(value => Object.freeze([value[0], value[1]] as const)));
}
