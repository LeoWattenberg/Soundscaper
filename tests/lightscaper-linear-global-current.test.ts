/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { linearGlobalDevelopChannelV1, prepareLinearGlobalEffectsV1,
	type PreparedLinearGlobalEffectV1 } from '../src/common/editor/imaging/pixel-frame-linear-global-v1.ts';
import { globalDevelopByteChannelV1, prepareGlobalDevelopEffectV1 } from '../src/common/editor/video-global-develop-v1.ts';

function effect(type: string, params: Record<string, unknown> = {}, id = type, enabled = true) {
	return { id, type, enabled, params };
}
function prepared(type: string, params: Record<string, unknown>) {
	const result = prepareLinearGlobalEffectsV1([effect(type, params)])[0];
	assert.ok(result); return result;
}
function close(actual: number, expected: number): void {
	assert.ok(Math.abs(actual - expected) <= 1e-12 * Math.max(1, Math.abs(expected)), `${String(actual)} != ${String(expected)}`);
}
function sample(operation: PreparedLinearGlobalEffectV1, value: number): number {
	return linearGlobalDevelopChannelV1(operation, value, 0);
}

test('linear white balance uses the owning gains without transfer encoding, clipping or integer rounding', () => {
	const warm = prepared('white-balance-v1', { temperature: 100 });
	for (const [value, expected] of [[-0.25, [-0.5, -0.25, -0.125]], [0.125, [0.25, 0.125, 0.0625]],
		[2, [4, 2, 1]]] as const) {
		for (const channel of [0, 1, 2] as const) assert.equal(linearGlobalDevelopChannelV1(warm, value, channel), expected[channel]);
	}
	// Temperature 50 and tint 100 produce exact gains [2, 1/2, 1].
	const combined = prepared('white-balance-v1', { temperature: 50, tint: 100 });
	assert.deepEqual(([0, 1, 2] as const).map(channel => linearGlobalDevelopChannelV1(combined, 0.375, channel)), [0.75, 0.1875, 0.375]);
	const tint = prepared('white-balance-v1', { tint: 100 });
	close(linearGlobalDevelopChannelV1(tint, 0.5, 0), Math.SQRT1_2);
	assert.equal(linearGlobalDevelopChannelV1(tint, 0.5, 1), 0.25);
	close(linearGlobalDevelopChannelV1(tint, 0.5, 2), Math.SQRT1_2);
});

test('opposite exposure and white-balance gains recover signed HDR samples before outer storage rounding', () => {
	for (const [up, down] of [
		[prepared('tone-ladder-v1', { exposure: 5 }), prepared('tone-ladder-v1', { exposure: -5 })],
		[prepared('white-balance-v1', { temperature: 100 }), prepared('white-balance-v1', { temperature: -100 })],
	] as const) {
		for (const value of [-8, -0.25, 0, 0.125, 0.5, 2, 16]) for (const channel of [0, 1, 2] as const) {
			const lifted = linearGlobalDevelopChannelV1(up, value, channel);
			close(linearGlobalDevelopChannelV1(down, lifted, channel), value);
		}
	}
	assert.equal(sample(prepared('tone-ladder-v1', { exposure: 1 }), 0.25), 0.5);
	assert.equal(sample(prepared('tone-ladder-v1', { exposure: 1 }), 4), 8);
});

test('exposure retains signed native Float32 tiny samples without cancellation at the contrast pivot', () => {
	for (const stops of [1, 5]) {
		const up = prepared('tone-ladder-v1', { exposure: stops });
		const down = prepared('tone-ladder-v1', { exposure: -stops });
		for (const value of [1e-30, -1e-30, 2 ** -126, -(2 ** -126), 2 ** -149, -(2 ** -149)]) {
			const lifted = sample(up, value);
			assert.equal(lifted, value * 2 ** stops);
			assert.equal(sample(down, lifted), value);
		}
	}
});

test('contrast is affine about linear 0.18 and retains both extended ends', () => {
	const expanded = prepared('tone-ladder-v1', { contrast: 50 });
	for (const [input, expected] of [[0.18, 0.18], [0.09, 0], [1, 1.82], [-1, -2.18], [4, 7.82]]) {
		close(sample(expanded, input!), expected!);
	}
	const compressed = prepared('tone-ladder-v1', { contrast: -50 });
	for (const [input, expected] of [[0, 0.09], [0.18, 0.18], [1, 0.59], [-1, -0.41], [4, 2.09]]) {
		close(sample(compressed, input!), expected!);
	}
});

test('each tonal region uses its fixed smooth weight with independent positive and negative literals', () => {
	// Smoothstep at quarter, half and three-quarter domain positions is 5/32, 1/2 and 27/32.
	const cases = [
		['highlights', [[-0.25, -0.25, -0.25], [0.5, 0.5, 0.5], [0.625, 0.6640625, 0.5859375],
			[0.75, 0.875, 0.625], [0.875, 1.0859375, 0.6640625], [1, 1.25, 0.75], [2, 2.25, 1.75]]],
		['shadows', [[-1, -0.75, -1.25], [0, 0.25, -0.25], [0.125, 0.3359375, -0.0859375],
			[0.25, 0.375, 0.125], [0.375, 0.4140625, 0.3359375], [0.5, 0.5, 0.5], [2, 2, 2]]],
		['whites', [[-0.25, -0.25, -0.25], [0.75, 0.75, 0.75], [0.8125, 0.8515625, 0.7734375],
			[0.875, 1, 0.75], [0.9375, 1.1484375, 0.7265625], [1, 1.25, 0.75], [2, 2.25, 1.75]]],
		['blacks', [[-0.25, 0, -0.5], [0, 0.25, -0.25], [0.0625, 0.2734375, -0.1484375],
			[0.125, 0.25, 0], [0.1875, 0.2265625, 0.1484375], [0.25, 0.25, 0.25], [2, 2, 2]]],
	] as const;
	for (const [control, values] of cases) {
		const positive = prepared('tone-ladder-v1', { [control]: 100 });
		const negative = prepared('tone-ladder-v1', { [control]: -100 });
		for (const [input, raised, lowered] of values) {
			close(sample(positive, input), raised); close(sample(negative, input), lowered);
		}
	}
});

test('complete tone recipes evaluate every region from the exposed and contrasted sample and preserve operation order', () => {
	const complete = prepared('tone-ladder-v1', { exposure: 1, contrast: -50, highlights: -100, shadows: 100, whites: -100, blacks: 100 });
	// The affine stage maps these inputs to 1/4, 7/8, -0.09 and 4.09, respectively.
	for (const [input, expected] of [[0.16, 0.375], [0.785, 0.5390625], [-0.18, 0.41], [4, 3.59]]) {
		close(sample(complete, input!), expected!);
	}
	const exposure = prepared('tone-ladder-v1', { exposure: 1 });
	const shadows = prepared('tone-ladder-v1', { shadows: 100 });
	close(sample(shadows, sample(exposure, 0.125)), 0.375);
	close(sample(exposure, sample(shadows, 0.125)), 0.671875);
});

test('bounded single-stage results agree with the permanent byte process after explicit sRGB presentation', () => {
	function decode(byte: number): number {
		const encoded = byte / 255; return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
	}
	function encode(value: number): number {
		const bounded = Math.max(0, Math.min(1, value));
		const encoded = bounded <= 0.0031308 ? 12.92 * bounded : 1.055 * bounded ** (1 / 2.4) - 0.055;
		return Math.floor(Math.max(0, Math.min(1, encoded)) * 255 + 0.5);
	}
	const cases = [effect('white-balance-v1', { temperature: 80, tint: -60 }),
		effect('tone-ladder-v1', { exposure: 1 }), effect('tone-ladder-v1', { contrast: 50 }),
		...['highlights', 'shadows', 'whites', 'blacks'].map(key => effect('tone-ladder-v1', { [key]: -70 })),
		effect('tone-ladder-v1', { contrast: -25, highlights: 40, shadows: -30, whites: -40, blacks: 20 })];
	for (const value of cases) {
		const linear = prepareLinearGlobalEffectsV1([value])[0]!;
		const baseline = prepareGlobalDevelopEffectV1(value);
		for (let byte = 0; byte < 256; byte++) for (const channel of [0, 1, 2] as const) {
			assert.equal(encode(linearGlobalDevelopChannelV1(linear, decode(byte), channel)), globalDevelopByteChannelV1(baseline, byte, channel));
		}
	}
});

test('preparation owns detached immutable identities and removes only admitted neutral or disabled stages', () => {
	const input = effect('tone-ladder-v1', { exposure: 1 }, 'authored');
	const prepared = prepareLinearGlobalEffectsV1([effect('white-balance-v1'), input,
		effect('tone-ladder-v1', { exposure: 5 }, 'disabled', false)]);
	assert.equal(prepared.length, 1); const owned = prepared[0]!;
	assert.equal(owned.id, 'authored'); assert.equal(Object.isFrozen(prepared), true);
	assert.equal(Object.isFrozen(owned), true); assert.equal(Object.isFrozen(owned.params0), true); assert.equal(Object.isFrozen(owned.params1), true);
	input.params.exposure = -5; input.id = 'changed'; input.enabled = false;
	assert.equal(owned.id, 'authored'); assert.equal(sample(owned, 0.25), 0.5);
	assert.deepEqual(prepareLinearGlobalEffectsV1([]), []);
	const bounded = Array.from({ length: 256 }, (_, index) => effect('tone-ladder-v1', { exposure: 1 }, String(index)));
	assert.equal(prepareLinearGlobalEffectsV1(bounded).length, 256);
	assert.throws(() => prepareLinearGlobalEffectsV1([...bounded, effect('white-balance-v1', {}, '257')]));
});

test('closed bounded metadata is fully checked even when a stage would be inactive', () => {
	let reads = 0;
	const params = Object.defineProperty({}, 'exposure', { enumerable: true, get() { reads++; return 1; } });
	const accessor = Object.defineProperty([], '0', { enumerable: true, get() { reads++; return effect('tone-ladder-v1'); } });
	const hostile = Object.defineProperty([effect('tone-ladder-v1')], 'future', { value: true });
	for (const value of [undefined, {}, new Array(1), accessor, hostile,
		[effect('tone-ladder-v1', params, 'getter', false)],
		[effect('tone-ladder-v1', {}, 'duplicate'), effect('white-balance-v1', {}, 'duplicate', false)],
		[effect('cube-lut-profile-v1', {}, 'unsupported', false)], [effect('chroma-v1', {}, 'unsupported')],
		[{ ...effect('white-balance-v1'), future: true }], [effect('white-balance-v1', { temperature: 101 })],
		[effect('white-balance-v1', { tint: Number.POSITIVE_INFINITY })],
		...Object.entries({ exposure: 5.01, contrast: 101, highlights: Number.NaN, shadows: -101, whites: Infinity, blacks: '1' })
			.map(([key, value]) => [effect('tone-ladder-v1', { [key]: value }, 'invalid', false)]),
	]) assert.throws(() => prepareLinearGlobalEffectsV1(value));
	assert.equal(reads, 0);
});

test('scalar evaluation refuses borrowed, copied or forged preparations without reading hostile properties', () => {
	const owned = prepared('white-balance-v1', { temperature: 100 }); let reads = 0;
	const proxy = new Proxy(owned, { get() { reads++; throw new Error('unowned property read'); } });
	for (const value of [{ ...owned }, Object.create(owned) as object, proxy,
		prepareGlobalDevelopEffectV1(effect('white-balance-v1', { temperature: 100 })), null]) {
		assert.throws(() => sample(value as PreparedLinearGlobalEffectV1, 0.5), /owning/u);
	}
	for (const value of [NaN, Infinity, -Infinity, '0.5']) {
		assert.throws(() => sample(owned, value as number));
	}
	for (const channel of [-1, 3, 0.5, '0']) {
		assert.throws(() => linearGlobalDevelopChannelV1(owned, 0.5, channel as 0 | 1 | 2));
	}
	assert.equal(reads, 0);
});
