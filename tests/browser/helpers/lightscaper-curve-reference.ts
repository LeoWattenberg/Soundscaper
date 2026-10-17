/* SPDX-License-Identifier: AGPL-3.0-only */

/** Literal 2×2 RGBA8 PNG: no profile transform, palette, metadata or seeded database. */
export const CURVE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAG0lEQVR4nGNgUHD479Bw4D9DQ0PD//8PBP4DAEZwCUy0Nz76AAAAAElFTkSuQmCC';
export const CURVE_SOURCE = Object.freeze([0, 32, 64, 255, 64, 128, 192, 255, 128, 128, 128, 255, 255, 224, 16, 255]);
const IDENTITY = Object.freeze([Object.freeze({ x: 0, y: 0 }), Object.freeze({ x: 1, y: 1 })]);
const POINT_PARAMS = Object.freeze({ master: Object.freeze([Object.freeze({ x: 0, y: 1 }), Object.freeze({ x: 1, y: 0 })]),
	red: Object.freeze([Object.freeze({ x: 0, y: 0 }), Object.freeze({ x: 1, y: 0.5 })]), green: IDENTITY, blue: IDENTITY });
const PARAMETRIC_PARAMS = Object.freeze({ masterShadows: 100, masterDarks: 0, masterLights: 0, masterHighlights: 0,
	redShadows: 0, redDarks: 0, redLights: 0, redHighlights: 0, greenShadows: 0, greenDarks: 0, greenLights: 0, greenHighlights: 0,
	blueShadows: 0, blueDarks: 0, blueLights: 0, blueHighlights: 0, shadowSplit: 0.25, midtoneSplit: 0.5, highlightSplit: 0.75 });

/** Independent encoded-byte references, not computed by the browser or owning curve kernel. */
export const CURVE_REFERENCES = Object.freeze([
	Object.freeze({ type: 'point-curves-v1', params: POINT_PARAMS,
		pixels: Object.freeze([128, 223, 191, 255, 96, 127, 63, 255, 64, 127, 127, 255, 0, 31, 239, 255]), low: 1, high: 0,
		bins: Object.freeze({ red: pairs([[0, 1], [64, 1], [96, 1], [128, 1]]), green: pairs([[31, 1], [127, 2], [223, 1]]),
			blue: pairs([[63, 1], [127, 1], [191, 1], [239, 1]]) }) }),
	Object.freeze({ type: 'parametric-curves-v1', params: PARAMETRIC_PARAMS,
		pixels: Object.freeze([0, 64, 80, 255, 80, 128, 192, 255, 128, 128, 128, 255, 255, 224, 32, 255]), low: 1, high: 1,
		bins: Object.freeze({ red: pairs([[0, 1], [80, 1], [128, 1], [255, 1]]), green: pairs([[64, 1], [128, 2], [224, 1]]),
			blue: pairs([[32, 1], [80, 1], [128, 1], [192, 1]]) }) }),
]);
function pairs(values: readonly (readonly [number, number])[]): readonly (readonly [number, number])[] {
	return Object.freeze(values.map(value => Object.freeze([value[0], value[1]] as const)));
}
