/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

const OWNER = new URL('../src/common/editor/imaging/image-output-color-profile-v1.ts', import.meta.url);
async function owner() {
	assert.ok(existsSync(OWNER), 'Current output color conversion must have its explicit shared scalar owner.');
	return import('../src/common/editor/imaging/image-output-color-profile-v1.ts');
}
function close(actual: number, expected: number, tolerance = 2e-12): void {
	assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from independent ${expected}`);
}
function matrix(rows: readonly (readonly number[])[], rgb: readonly number[]): number[] {
	return rows.map(row => row.reduce((sum, coefficient, index) => sum + coefficient * rgb[index]!, 0));
}
// Independent CSS Color4 rational D65 reference. Production uses a separate
// scalar owner; this oracle keeps the two XYZ matrix operations explicit.
const SRGB_XYZ = [[506752 / 1228815, 87881 / 245763, 12673 / 70218],
	[87098 / 409605, 175762 / 245763, 12673 / 175545], [7918 / 409605, 87881 / 737289, 1001167 / 1053270]];
const XYZ_P3 = [[446124 / 178915, -333277 / 357830, -72051 / 178915],
	[-14852 / 17905, 63121 / 35810, 423 / 17905], [11844 / 330415, -50337 / 660830, 316169 / 330415]];
const P3_XYZ = [[608311 / 1250200, 189793 / 714400, 198249 / 1000160],
	[35783 / 156275, 247089 / 357200, 198249 / 2500400], [0, 32229 / 714400, 5220557 / 5000800]];
const XYZ_SRGB = [[12831 / 3959, -329 / 214, -1974 / 3959],
	[-851781 / 878810, 1648619 / 878810, 36519 / 878810], [705 / 12673, -2585 / 12673, 705 / 667]];
const forward = (rgb: readonly number[]) => matrix(XYZ_P3, matrix(SRGB_XYZ, rgb));
const inverse = (rgb: readonly number[]) => matrix(XYZ_SRGB, matrix(P3_XYZ, rgb));

test('output profiles admit only explicit sRGB or Display P3 without coercion or accessor evaluation', async () => {
	const api = await owner();
	assert.deepEqual(api.IMAGE_OUTPUT_COLOR_PROFILES_V1, ['srgb', 'display-p3']);
	for (const profile of ['srgb', 'display-p3'] as const) assert.equal(api.normalizeImageOutputColorProfileV1(profile), profile);
	for (const profile of [undefined, null, 'Display P3', 'bt2020', 'pq', {}, 1]) assert.throws(() => api.normalizeImageOutputColorProfileV1(profile));
	let invoked = 0;
	assert.throws(() => api.prepareImageOutputColorProfileV1({ get profile() { invoked++; return 'display-p3'; }, bitDepth: 16, source: 'linear-srgb' }));
	assert.equal(invoked, 0);
	for (const patch of [{ profile: 'bt2020' }, { bitDepth: 10 }, { source: 'encoded-p3' }, { extra: true }]) {
		assert.throws(() => api.prepareImageOutputColorProfileV1({ profile: 'display-p3', bitDepth: 16, source: 'linear-srgb', ...patch }));
	}
});

test('unclipped Display P3 primary conversion agrees with independent rational D65 matrices', async () => {
	const api = await owner(), target = new Float64Array(4);
	for (const rgb of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-.25, 2, .00001], [1e-30, -1e-30, 3e-30]]) {
		api.writeImageOutputColorLinearV1('display-p3', rgb[0]!, rgb[1]!, rgb[2]!, target);
		const expected = forward(rgb); expected.forEach((value, channel) => close(target[channel]!, value));
		const converted = Array.from(target.subarray(0, 3));
		api.writeImageOutputColorWorkingV1('display-p3', converted[0]!, converted[1]!, converted[2]!, target);
		const recovered = inverse(converted); recovered.forEach((value, channel) => close(target[channel]!, value));
		rgb.forEach((value, channel) => close(target[channel]!, value));
	}
	api.writeImageOutputColorLinearV1('display-p3', 1, 0, 0, target);
	close(target[0]!, .8224619687143623); close(target[1]!, .033194198850961615); close(target[2]!, .01708263072112004);
	api.writeImageOutputColorWorkingV1('display-p3', 1, 0, 0, target);
	assert.ok(target[0]! > 1 && target[1]! < 0 && target[2]! < 0, 'Working sRGB retains the signed components of a P3 primary.');
});

test('sRGB identity and neutral axes preserve exact authored values including negative zero', async () => {
	const api = await owner(), target = new Float64Array(4);
	for (const write of [api.writeImageOutputColorLinearV1, api.writeImageOutputColorWorkingV1]) {
		write('srgb', -0, -.25, 2, target);
		assert.equal(Object.is(target[0], -0), true); assert.equal(target[1], -.25); assert.equal(target[2], 2);
		for (const value of [-.5, 0, .0031308, .18, 1, 4]) {
			write('display-p3', value, value, value, target);
			assert.deepEqual(Array.from(target.subarray(0, 3)), [value, value, value]);
		}
	}
});

test('shared output quantization converts before clipping and never applies a byte intermediate', async () => {
	const api = await owner(), target = new Float64Array(4);
	const p3 = api.prepareImageOutputColorProfileV1({ profile: 'display-p3', bitDepth: 16, source: 'linear-srgb' });
	const workingRed = inverse([1, 0, 0]);
	api.writeImageOutputColorPixelV1(p3, workingRed[0]!, workingRed[1]!, workingRed[2]!, .5, target);
	assert.deepEqual(Array.from(target), [65535, 0, 0, 32768]);
	const srgb = api.prepareImageOutputColorProfileV1({ profile: 'srgb', bitDepth: 16, source: 'linear-srgb' });
	api.writeImageOutputColorPixelV1(srgb, 1 / 65535, 2 / 65535, 3 / 65535, 0, target);
	assert.deepEqual(Array.from(target), [13, 26, 39, 0]);
	api.writeImageOutputColorPixelV1(srgb, -.25, .5, 4, .5, target);
	assert.deepEqual(Array.from(target), [0, 48192, 65535, 32768]);
});

test('encoded byte input has exact sRGB identity and independent P3 primary literals at both depths', async () => {
	const api = await owner(), target = new Float64Array(4);
	for (const bitDepth of [8, 16] as const) {
		const identity = api.prepareImageOutputColorProfileV1({ profile: 'srgb', bitDepth, source: 'encoded-srgb8' });
		for (let code = 0; code < 256; code++) {
			api.writeImageOutputColorPixelV1(identity, code, 255 - code, code, code, target);
			assert.deepEqual(Array.from(target), [code, 255 - code, code, code].map(value => value * (bitDepth === 16 ? 257 : 1)));
		}
	}
	const p3 = api.prepareImageOutputColorProfileV1({ profile: 'display-p3', bitDepth: 8, source: 'encoded-srgb8' });
	for (const [rgb, expected] of [[[255, 0, 0], [234, 51, 35]], [[0, 255, 0], [117, 251, 76]], [[0, 0, 255], [0, 0, 245]]] as const) {
		api.writeImageOutputColorPixelV1(p3, rgb[0], rgb[1], rgb[2], 0, target);
		assert.deepEqual(Array.from(target), [...expected, 0], 'Transparent hidden RGB undergoes the same truthful profile transform.');
	}
});

test('scalar pixel writing refuses forged preparations and nonfinite or non-unit source samples', async () => {
	const api = await owner(), target = new Float64Array(4);
	const plan = api.prepareImageOutputColorProfileV1({ profile: 'display-p3', bitDepth: 16, source: 'linear-srgb' });
	assert.equal(Object.isFrozen(plan), true);
	assert.throws(() => api.writeImageOutputColorPixelV1({ ...plan }, 0, 0, 0, 1, target));
	for (const pixel of [[NaN, 0, 0, 1], [0, Infinity, 0, 1], [0, 0, 0, -.1], [0, 0, 0, 1.1]]) {
		assert.throws(() => api.writeImageOutputColorPixelV1(plan, pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]!, target));
	}
	const bytes = api.prepareImageOutputColorProfileV1({ profile: 'display-p3', bitDepth: 8, source: 'encoded-srgb8' });
	for (const code of [-1, .5, 256]) assert.throws(() => api.writeImageOutputColorPixelV1(bytes, code, 0, 0, 255, target));
});
