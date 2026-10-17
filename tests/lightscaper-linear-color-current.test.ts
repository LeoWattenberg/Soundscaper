/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareLinearColorEffectsV1, writeLinearColorChannelsV1,
	type PreparedLinearColorEffectV1 } from '../src/common/editor/imaging/pixel-frame-linear-color-v1.ts';
import { applyChromaDevelopPixelV1, prepareChromaDevelopEffectV1 } from '../src/common/editor/video-chroma-develop-v1.ts';
import { applyBlackWhiteMixPixelV1, prepareBlackWhiteMixEffectV1 } from '../src/common/editor/video-black-white-mix-v1.ts';
import { applyHslMixerPixelV1, prepareHslMixerEffectV1 } from '../src/common/editor/video-hsl-mixer-v1.ts';
import { createCurvesTransferV1 } from '../src/common/editor/video-curves-v1.ts';
import { colorWheelsByteChannelV1, prepareColorWheelsEffectV1, releaseColorWheelsEffectV1 } from '../src/common/editor/video-color-wheels-v1.ts';

type Rgb = readonly [number, number, number];
function effect(type: string, params: Record<string, unknown> = {}, id = type, enabled = true) {
	return { id, type, enabled, params };
}
function prepared(type: string, params: Record<string, unknown> = {}): PreparedLinearColorEffectV1 {
	const operation = prepareLinearColorEffectsV1([effect(type, params)])[0];
	assert.ok(operation); return operation;
}
function sample(operation: PreparedLinearColorEffectV1, rgb: Rgb): Rgb {
	const target = { red: NaN, green: NaN, blue: NaN };
	writeLinearColorChannelsV1(operation, ...rgb, target);
	return [target.red, target.green, target.blue];
}
function close(actual: number, expected: number): void {
	assert.ok(Math.abs(actual - expected) <= 2e-12 * Math.max(1, Math.abs(expected)), `${String(actual)} != ${String(expected)}`);
}
function closeRgb(actual: Rgb, expected: Rgb): void {
	for (const channel of [0, 1, 2] as const) close(actual[channel], expected[channel]);
}
// Independent extended sRGB boundary: odd extension of the ordinary positive transfer.
function decode(value: number): number {
	const magnitude = Math.abs(value);
	return Math.sign(value) * (magnitude <= 0.04045 ? magnitude / 12.92 : ((magnitude + 0.055) / 1.055) ** 2.4);
}
function encode(value: number): number {
	const magnitude = Math.abs(value);
	return Math.sign(value) * (magnitude <= 0.0031308 ? magnitude * 12.92 : 1.055 * magnitude ** (1 / 2.4) - 0.055);
}
function linear(rgb: Rgb): Rgb { return [decode(rgb[0]), decode(rgb[1]), decode(rgb[2])]; }
function byte(value: number): number { return Math.floor(Math.max(0, Math.min(1, encode(value))) * 255 + 0.5); }

test('continuous color admits every current separable family while retaining permanent linear WB and full tone', () => {
	const stages = prepareLinearColorEffectsV1([
		effect('white-balance-v1', { temperature: 100 }, 'wb'),
		effect('tone-ladder-v1', { exposure: 1 }, 'tone'),
		effect('chroma-v1', { saturation: 1 }), effect('black-white-mix-v1'),
		effect('hsl-mixer-v1', { redHue: 1 }),
		effect('point-curves-v1', { master: [{ x: 0, y: 0 }, { x: 1, y: 0.5 }] }),
		effect('parametric-curves-v1', { masterShadows: 1 }),
		effect('color-wheels-v1', { highlightsLuminance: 100 }),
	]);
	assert.equal(stages.length, 8);
	assert.ok(stages.every(stage => stage.enabled && !stage.neutral));
	assert.deepEqual(sample(stages[0]!, [-0.25, 0.125, 2]), [-0.5, 0.125, 1]);
	assert.deepEqual(sample(stages[1]!, [-1e-30, 2 ** -149, 2]), [-2e-30, 2 ** -148, 4]);
	const full = prepared('tone-ladder-v1', { exposure: 1, contrast: -50, highlights: -100, shadows: 100, whites: -100, blacks: 100 });
	closeRgb(sample(full, [0.16, 0.785, 4]), [0.375, 0.5390625, 3.59]);
});

test('chroma uses continuous encoded coordinates and bounds only adaptive vibrance weight', () => {
	const gray = prepared('chroma-v1', { saturation: -100 });
	closeRgb(sample(gray, [1, 0, 0]), linear([54 / 256, 54 / 256, 54 / 256]));
	// Signed/HDR encoded values remain part of the luma, rather than being clipped at transfer admission.
	closeRgb(sample(gray, linear([-0.25, 0.5, 1.5])), linear([106.5 / 256, 106.5 / 256, 106.5 / 256]));
	const vibrant = prepared('chroma-v1', { vibrance: -100 });
	closeRgb(sample(vibrant, linear([0.25, 0.5, 0.75])), linear([0.35791015625, 0.48291015625, 0.60791015625]));
	const saturated = prepared('chroma-v1', { saturation: 100 });
	closeRgb(sample(saturated, [1, 0, 0]), linear([1.7890625, -0.2109375, -0.2109375]));
	// Chroma range above one makes the adaptive weight zero; it does not clip the samples.
	closeRgb(sample(prepared('chroma-v1', { vibrance: 100 }), linear([-1, 0.25, 2])), linear([-1, 0.25, 2]));
});

test('black-and-white is active at zero controls and hue controls interpolate without byte quantization', () => {
	closeRgb(sample(prepared('black-white-mix-v1'), [1, 0, 0]), linear([54 / 256, 54 / 256, 54 / 256]));
	const raised = prepared('black-white-mix-v1', { red: 100 });
	closeRgb(sample(raised, [1, 0, 0]), linear([1.2109375, 1.2109375, 1.2109375]));
	// Encoded orange is the exact midpoint between the 0° red and 30° orange control centers.
	const interpolated = prepared('black-white-mix-v1', { red: 0, orange: 100 });
	const y = (54 + 183 * 0.25) / 256;
	closeRgb(sample(interpolated, linear([1, 0.25, 0])), linear([y + 0.5, y + 0.5, y + 0.5]));
	closeRgb(sample(raised, [-0.25, -0.25, -0.25]), [-0.25, -0.25, -0.25]);
});

test('HSL uses original continuous hue bands, ordered saturation/lightness/hue and an affine extended cube', () => {
	closeRgb(sample(prepared('hsl-mixer-v1', { redHue: 60 }), linear([0.75, 0.25, 0.25])), linear([0.75, 0.75, 0.25]));
	closeRgb(sample(prepared('hsl-mixer-v1', { redSaturation: 100 }), linear([0.75, 0.25, 0.25])), [1, 0, 0]);
	closeRgb(sample(prepared('hsl-mixer-v1', { redLuminance: 50 }), linear([0.75, 0.25, 0.25])), linear([0.875, 0.625, 0.625]));
	closeRgb(sample(prepared('hsl-mixer-v1', { redSaturation: 100, redLuminance: 50, redHue: 60 }), linear([0.75, 0.25, 0.25])), linear([1, 1, 0.5]));
	// [-1,3,-1] normalizes to green [0,1,0] in the affine cube; a 60° turn yields cyan.
	closeRgb(sample(prepared('hsl-mixer-v1', { greenHue: 60 }), linear([-1, 3, -1])), linear([-1, 3, 3]));
	assert.deepEqual(sample(prepared('hsl-mixer-v1', { redHue: 60 }), [-2, -2, -2]), [-2, -2, -2]);
});

test('point curves evaluate authored segments at full precision, master before channel, with endpoint extrapolation', () => {
	const operation = prepared('point-curves-v1', {
		master: [{ x: 0, y: 0 }, { x: 0.5, y: 0.25 }, { x: 1, y: 1 }],
		red: [{ x: 0, y: 0 }, { x: 1, y: 0.5 }],
	});
	closeRgb(sample(operation, linear([0.75, 0.25, 0.75])), linear([0.3125, 0.125, 0.625]));
	closeRgb(sample(operation, linear([-1, 2, 2])), linear([-0.25, 2.5, 2.5]));
	const fine = prepared('point-curves-v1', { master: [{ x: 0, y: 0 }, { x: 1, y: 0.5 }] });
	const a = 1024 / 65535, b = 1025 / 65535;
	const first = sample(fine, [a, a, a])[0], second = sample(fine, [b, b, b])[0];
	assert.ok(second > first); assert.ok(second - first < 1 / 65535);
	assert.ok(Math.abs(sample(fine, [-1e-30, 0, 0])[0] + 5e-31) < 1e-44);
});

test('parametric curves retain Q16 authored gains but interpolate continuous region-center knots', () => {
	const operation = prepared('parametric-curves-v1', { masterShadows: 100 });
	closeRgb(sample(operation, linear([0.125, 0.25, 0.375])), linear([0.25, 0.3125, 0.375]));
	closeRgb(sample(operation, linear([-0.25, 2, 0])), linear([-0.5, 2, 0]));
	const q16 = prepared('parametric-curves-v1', { masterShadows: 33.333 });
	const knot = 0.125 + 0.125 * (21845 / 65536);
	closeRgb(sample(q16, linear([0.125, 0.125, 0.125])), linear([knot, knot, knot]));
});

test('wheels apply native linear lift/gain/sign-preserving gamma without a byte lookup', () => {
	assert.deepEqual(sample(prepared('color-wheels-v1', { highlightsLuminance: 100 }), [-4, -0.25, 2]), [-8, -0.5, 4]);
	closeRgb(sample(prepared('color-wheels-v1', { midtonesLuminance: 100 }), [-4, 0.25, 2]), [-2, 0.5, Math.SQRT2]);
	assert.deepEqual(sample(prepared('color-wheels-v1', { shadowsLuminance: 100 }), [-0.5, 0, 2]), [-0.25, 0.25, 2.25]);
	const red = prepared('color-wheels-v1', { shadowsHue: 0, shadowsSaturation: 100 });
	closeRgb(sample(red, [0, 0, 0]), [0.19685, -0.05315, -0.05315]);
});

test('chroma retains out-of-gamut saturation headroom that the permanent byte substep clips', () => {
	const value = effect('chroma-v1', { saturation: 25, vibrance: -30 });
	const actual = sample(prepareLinearColorEffectsV1([value])[0]!, linear([230 / 255, 70 / 255, 40 / 255]));
	// Continuous code-domain Y=101.5234375; saturation produces
	// [262.119140625,62.119140625,24.619140625]. Range237.5 makes
	// vibrance factor333/340. These exact fractions retain the red overshoot.
	closeRgb(actual, linear([45054125 / 44390400, 10954925 / 44390400, 4561325 / 44390400]));
	assert.ok(actual[0] > 1); assert.deepEqual(actual.map(byte), [255, 63, 26]);
	const permanent = new Uint8Array([230, 70, 40, 73]);
	applyChromaDevelopPixelV1(prepareChromaDevelopEffectV1(value), permanent, 0);
	// Byte luma rounds to102 and the first saturation step clips red to255;
	// subsequent vibrance reduces that already-clipped red to250.
	assert.deepEqual([...permanent], [250, 63, 27, 73]);
});

test('continuous encoded families remain close to permanent byte processes when intermediate results stay in gamut', () => {
	const baselineInputs = [[64, 128, 192], [230, 70, 40], [22, 33, 80], [128, 128, 128]] as const;
	const cases = [
		{ value: effect('chroma-v1', { saturation: 25, vibrance: -30 }), tolerance: 2,
			inputs: [[64, 128, 192], [180, 70, 40], [22, 33, 80], [128, 128, 128]] as const,
			apply: (pixels: Uint8Array) => { applyChromaDevelopPixelV1(prepareChromaDevelopEffectV1(effect('chroma-v1', { saturation: 25, vibrance: -30 })), pixels, 0); } },
		{ value: effect('black-white-mix-v1', { red: 20, orange: -15, green: 30, blue: -20 }), tolerance: 2, inputs: baselineInputs,
			apply: (pixels: Uint8Array) => { applyBlackWhiteMixPixelV1(prepareBlackWhiteMixEffectV1(effect('black-white-mix-v1', { red: 20, orange: -15, green: 30, blue: -20 })), pixels, 0); } },
		{ value: effect('hsl-mixer-v1', { redHue: 20, greenSaturation: -15, blueLuminance: 20 }), tolerance: 3, inputs: baselineInputs,
			apply: (pixels: Uint8Array) => { applyHslMixerPixelV1(prepareHslMixerEffectV1(effect('hsl-mixer-v1', { redHue: 20, greenSaturation: -15, blueLuminance: 20 })), pixels, 0); } },
	];
	for (const { value, tolerance, inputs, apply } of cases) {
		const operation = prepareLinearColorEffectsV1([value])[0]!;
		for (const rgb of inputs) {
			const pixels = new Uint8Array([...rgb, 73]); apply(pixels);
			const actual = sample(operation, linear([rgb[0] / 255, rgb[1] / 255, rgb[2] / 255]));
			for (const channel of [0, 1, 2] as const) assert.ok(Math.abs(byte(actual[channel]) - pixels[channel]!) <= tolerance,
				`${value.type} input=${rgb.join(',')} channel=${String(channel)} deep=${String(byte(actual[channel]))} byte=${String(pixels[channel])}`);
			assert.equal(pixels[3], 73);
		}
	}
});

test('continuous curves and wheels keep byte baseline transfer untouched', () => {
	for (const value of [effect('point-curves-v1', { master: [{ x: 0, y: 0 }, { x: 0.5, y: 0.3 }, { x: 1, y: 1 }] }),
		effect('parametric-curves-v1', { masterShadows: 35, redHighlights: -20 })]) {
		const operation = prepareLinearColorEffectsV1([value])[0]!, table = createCurvesTransferV1(value);
		try { for (let code = 0; code < 256; code++) {
			const actual = sample(operation, linear([code / 255, code / 255, code / 255]));
			for (const channel of [0, 1, 2] as const) assert.ok(Math.abs(byte(actual[channel]) - table[code * 4 + channel]!) <= 1);
		} } finally { table.fill(0); }
	}
	const value = effect('color-wheels-v1', { shadowsLuminance: 10, midtonesLuminance: 30, highlightsLuminance: -20 });
	const operation = prepareLinearColorEffectsV1([value])[0]!, permanent = prepareColorWheelsEffectV1(value);
	try { for (let code = 0; code < 256; code++) {
		const actual = sample(operation, linear([code / 255, code / 255, code / 255]));
		for (const channel of [0, 1, 2] as const) assert.equal(byte(actual[channel]), colorWheelsByteChannelV1(permanent, code, channel));
	} } finally { releaseColorWheelsEffectV1(permanent); }
});

test('admission captures immutable owned metadata, bounded order and complete inactive stages', () => {
	const input = effect('point-curves-v1', { master: [{ x: 0, y: 0 }, { x: 1, y: 0.5 }] }, 'authored');
	const operations = prepareLinearColorEffectsV1([effect('chroma-v1'), input, effect('black-white-mix-v1', {}, 'inactive', false)]);
	assert.equal(operations.length, 1); assert.ok(Object.isFrozen(operations)); assert.ok(Object.isFrozen(operations[0]));
	input.params.master = []; input.id = 'changed'; input.enabled = false;
	assert.equal(operations[0]!.id, 'authored'); closeRgb(sample(operations[0]!, linear([0.5, 0.5, 0.5])), linear([0.25, 0.25, 0.25]));
	assert.deepEqual(prepareLinearColorEffectsV1(['chroma-v1', 'hsl-mixer-v1', 'point-curves-v1', 'parametric-curves-v1', 'color-wheels-v1', 'white-balance-v1', 'tone-ladder-v1']
		.map(type => effect(type))), []);
	const bounded = Array.from({ length: 256 }, (_, index) => effect('black-white-mix-v1', {}, String(index)));
	assert.equal(prepareLinearColorEffectsV1(bounded).length, 256);
	assert.throws(() => prepareLinearColorEffectsV1([...bounded, effect('black-white-mix-v1', {}, '257')]));
	let reads = 0;
	const accessor = Object.defineProperty({}, 'saturation', { enumerable: true, get() { reads++; return 0; } });
	for (const value of [new Array(1), [effect('chroma-v1', accessor, 'getter', false)],
		[effect('hsl-mixer-v1', { redHue: 181 }, 'invalid', false)],
		[effect('point-curves-v1', { master: [{ x: 0, y: 0 }, { x: 0, y: 1 }] }, 'invalid', false)],
		[effect('parametric-curves-v1', { shadowSplit: 0.5, midtoneSplit: 0.5 }, 'invalid', false)],
		[effect('color-wheels-v1', { midtonesLuminance: Infinity }, 'invalid', false)],
		[effect('chroma-v1', {}, 'duplicate'), effect('black-white-mix-v1', {}, 'duplicate', false)],
		[effect('grain-v1', {}, 'unsupported', false)], [{ ...effect('chroma-v1'), future: true }]]) {
		assert.throws(() => prepareLinearColorEffectsV1(value));
	}
	assert.equal(reads, 0);
});

test('scalar calls reject forged preparations and malformed samples before observing forged metadata', () => {
	const owned = prepared('chroma-v1', { saturation: 1 }); let reads = 0;
	const forged = new Proxy(owned, { get() { reads++; throw new Error('unowned metadata read'); } });
	for (const value of [{ ...owned }, Object.create(owned) as object, forged, null]) {
		assert.throws(() => sample(value as PreparedLinearColorEffectV1, [0.25, 0.5, 0.75]), /owning/u);
	}
	for (const value of [NaN, Infinity, -Infinity, '0.5']) {
		assert.throws(() => sample(owned, [value as number, 0, 0]));
	}
	assert.equal(reads, 0);
});
