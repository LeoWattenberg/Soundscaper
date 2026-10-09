/* SPDX-License-Identifier: AGPL-3.0-only */

/** A literal untagged, non-interlaced RGBA8 PNG. Eight identical rows repeat
 * gray40/100/160 at full width2052, exceeding the fit-screen width2048. */
export const RESOLUTION_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAACAQAAAAICAYAAABk8L9AAAAAuElEQVR4nO3aMQ0AMAwEscIJsAAL05REh+rlzeMBuFNV2907M8vMzMzMzMzMzMzMzMzMzMwZPj9EMDMzMzMzMzMzMzMzMzMz81sbApiZmZmZmZmZmZmZmZmZmQNtCGBmZmZmZmZmZmZmZmZmZg60IYCZmZmZmZmZmZmZmZmZmTnQhgBmZmZmZmZmZmZmZmZmZuZAGwKYmZmZmZmZmZmZmZmZmZkDbQhgZmZmZmZmZmZmZmZmZmYO9AX5+A2G25XsDQAAAABJRU5ErkJggg==';
export const RESOLUTION_WIDTH = 2052, RESOLUTION_HEIGHT = 8;

/** These references never invoke production geometry, sharpening or curve
 * evaluation. At amount50 the 3:1 edge blur yields33/168; interior 1:2:1
 * blur yields18/100/183. Alpha is255 throughout. */
export function resolutionPixels(developed = false): Uint8Array<ArrayBuffer> {
	const pixels = new Uint8Array(RESOLUTION_WIDTH * RESOLUTION_HEIGHT * 4);
	for (let y = 0; y < RESOLUTION_HEIGHT; y++) for (let x = 0; x < RESOLUTION_WIDTH; x++) {
		const value = developed ? x === 0 ? 33 : x === RESOLUTION_WIDTH - 1 ? 168 : [18,100,183][x % 3]!
			: [40,100,160][x % 3]!;
		pixels.set([value,value,value,255], 4 * (y * RESOLUTION_WIDTH + x));
	}
	return pixels;
}
export function resolutionBins(developed = false): readonly number[] {
	const counts = new Array<number>(256).fill(0);
	for (const [value, count] of developed ? [[33,8],[18,5464],[100,5472],[183,5464],[168,8]] : [[40,5472],[100,5472],[160,5472]]) counts[value!] = count!;
	return Object.freeze(counts);
}
