/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionMaximumScene } from './motionscaper-native-maximum-scenes.ts';

type Pixel = readonly [number, number, number, number];
interface Controls {
	readonly shutterSamples?: number; readonly lensSamples?: number;
	readonly omittedPlane?: number; readonly omittedLight?: number; readonly shadows?: boolean;
}
const transparent: Pixel = [0, 0, 0, 0];
const clamp = (value: number) => Math.max(0, Math.min(1, value));
// Constant unit-pixel rectangles: linear reconstruction falls to zero half a pixel outside each edge.
const rectangle = (x: number, y: number, width: number, height: number) => clamp(Math.min(x + .5, width + .5 - x)) * clamp(Math.min(y + .5, height + .5 - y));
const premultiply = (rgb: readonly number[], alpha: number, coverage: number): Pixel => [Math.fround(rgb[0]! * alpha) * coverage, Math.fround(rgb[1]! * alpha) * coverage, Math.fround(rgb[2]! * alpha) * coverage, alpha * coverage];
const over = (front: Pixel, back: Pixel): Pixel => [front[0] + back[0] * (1 - front[3]), front[1] + back[1] * (1 - front[3]), front[2] + back[2] * (1 - front[3]), front[3] + back[3] * (1 - front[3])];

/** Analytic expectations for the three fixed authored scenes. No production camera, depth,
 * lighting, temporal, raster or compositing code is imported. Reduced counts are negative/fast
 * mathematical controls only; the installed maximum-quality case always uses the 64/64 defaults.
 */
export function motionMaximumScenePixel(kind: MotionMaximumScene, frame: number, x: number, y: number, controls: Controls = {}): Pixel {
	const size = kind === 'planes' ? 1024 : kind === 'quality' ? 64 : kind === 'lights' ? 32 : 0;
	if (!size || ![x, y].every(value => Number.isSafeInteger(value) && value >= 0 && value < size)) throw new RangeError('Maximum-scene oracle pixel is outside its fixed picture.');
	if (!Number.isSafeInteger(frame) || frame < 0 || frame >= (kind === 'quality' ? 4 : 1)) throw new RangeError('Maximum-scene oracle frame is outside its fixed range.');
	if (controls.omittedPlane !== undefined && (!Number.isSafeInteger(controls.omittedPlane) || controls.omittedPlane < 0 || controls.omittedPlane >= 64)) throw new RangeError('Invalid omitted maximum-scene plane.');
	if (controls.omittedLight !== undefined && (!Number.isSafeInteger(controls.omittedLight) || controls.omittedLight < 0 || controls.omittedLight >= 32)) throw new RangeError('Invalid omitted maximum-scene light.');
	if (kind === 'quality') return qualityPixel(frame, x, y, controls);
	if (kind === 'planes') {
		let result = transparent;
		const coverage = rectangle((x + .5 - 128) / 128, (y + .5 - 128) / 128, 6, 6);
		for (let plane = 63; plane >= 0; plane--) if (plane !== controls.omittedPlane) result = over(premultiply([(plane % 7 + 1) / 8, (plane % 5 + 1) / 6, (plane % 3 + 1) / 4], 1 / 64, coverage), result);
		return x < 8 && y < 8 ? [.25, .5, .125, 1] : result;
	}
	const rx = x + .5, ry = y + .5;
	// The receiver is z=16; the point lights at z=-32 meet the z=0 caster one third along the light ray.
	const coverage = rectangle(rx - 4, ry - 4, 24, 24);
	const shadow = controls.shadows === false ? 1 : 1 - .5 * rectangle(rx + (8 - rx) / 3 - 12, ry + (16 - ry) / 3 - 12, 8, 8);
	const light = 48 / Math.hypot(rx - 8, ry - 16, 48) * shadow * (controls.omittedLight === undefined ? 1 : 31 / 32);
	const receiver = premultiply([.5 * light, .25 * light, .125 * light], 1, coverage);
	return over(premultiply([.8, .1, .2], .5, rectangle(rx - 12, ry - 12, 8, 8)), receiver);
}

function qualityPixel(frame: number, x: number, y: number, controls: Controls): Pixel {
	const shutter = controls.shutterSamples ?? 64, count = controls.lensSamples ?? 64;
	if (![shutter, count].every(value => Number.isSafeInteger(value) && value >= 1 && value <= 64)) throw new RangeError('Maximum-scene oracle samples must be from one to 64.');
	// Symmetric equal-area paired disk strata. A one-sample control is the pinhole.
	const lenses: Array<readonly [number, number]> = [];
	if (count % 2) lenses.push([0, 0]);
	for (let index = 0; index < Math.floor(count / 2); index++) {
		const radius = 8 * Math.sqrt((index + .5) / Math.floor(count / 2)), angle = index * Math.PI * (3 - Math.sqrt(5));
		const dx = radius * Math.cos(angle), dy = radius * Math.sin(angle); lenses.push([dx, dy], [-dx, -dy]);
	}
	const sum = [0, 0, 0, 0];
	for (let sample = 0; sample < shutter; sample++) {
		const time = frame - .5 + (sample + .5) / shutter, lensSum = [0, 0, 0, 0];
		for (const [dx, dy] of lenses) {
			// z=32 and z=0 rectangles have depths 96 and 64 from the camera at z=-64.
			const worldX = 32 + time * 2 + (x + .5 - 32) * 1.5 - dx / 3;
			const worldY = 32 + (y + .5 - 32) * 1.5 - dy / 3;
			const nearX = x + .5 - 12 - time * 4 + dx / 9, nearY = y + .5 - 20 + dy / 9;
			// The z=32 receiver meets the light at z=-32 through the z=0 caster halfway along the ray.
			const transmission = controls.shadows === false ? 1 : 1 - .5 * rectangle(worldX / 2 - 12 - time * 6, (worldY + 32) / 2 - 20, 10, 24);
			const response = 64 / Math.hypot(worldX, worldY - 32, 64) * transmission;
			const unlit = premultiply([.1, .3, .6], 1, rectangle(worldX - 6, worldY - 12, 40, 32));
			const receiver: Pixel = [unlit[0] * response, unlit[1] * response * .9, unlit[2] * response * .8, unlit[3]];
			const pixel = over(premultiply([.7, .1, .05], .5, rectangle(nearX, nearY, 10, 24)), receiver);
			for (let c = 0; c < 4; c++) lensSum[c]! += pixel[c]!;
		}
		for (let c = 0; c < 4; c++) sum[c]! += Math.fround(lensSum[c]! / count) / shutter;
	}
	return sum.map(Math.fround) as unknown as Pixel;
}
