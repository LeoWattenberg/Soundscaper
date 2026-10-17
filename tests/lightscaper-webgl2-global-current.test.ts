/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { prepareLinearGlobalEffectsV1 } from '../src/common/editor/imaging/pixel-frame-linear-global-v1.ts';

const OWNER = new URL('../src/common/editor/imaging/pixel-frame-webgl2-global-current-v1.ts', import.meta.url);
interface Prepared {
	readonly id: string; readonly type: 'white-balance-v1' | 'tone-ladder-v1';
	readonly params0: readonly [number, number, number, number];
	readonly params1: readonly [number, number, number, number];
}
interface Module {
	preparePixelFrameWebGl2GlobalsCurrentV1(value: unknown): readonly Readonly<Prepared>[];
	readPixelFrameWebGl2GlobalCurrentV1(value: unknown): Readonly<Prepared>;
	pixelFrameWebGl2GlobalChannelCurrentV1(value: unknown, sample: number, channel: 0 | 1 | 2): number;
	readonly PIXEL_FRAME_WEBGL2_GLOBAL_VERTEX_CURRENT_V1: string;
	readonly PIXEL_FRAME_WEBGL2_GLOBAL_FRAGMENT_CURRENT_V1: string;
}
async function owner(): Promise<Module> {
	assert.ok(existsSync(OWNER), 'The native Float32 WebGL2 global shader owner must exist.');
	return await import(OWNER.href) as Module;
}
function effect(type: string, params: Record<string, unknown> = {}, id = type, enabled = true) {
	return { id, type, enabled, params };
}

/** Uniform-contract arithmetic only. These tests do not create a GL context or
 * claim GPU execution; browser native readback owns shader conformance. */
function uniformChannel(effect: Prepared, input: number, channel: 0 | 1 | 2): number {
	if (effect.type === 'white-balance-v1') return input * effect.params0[channel];
	const [exposure, contrast, highlights, shadows] = effect.params0, [whites, blacks] = effect.params1;
	const x = input * exposure * contrast + .18 * (1 - contrast);
	const step = (low: number, high: number) => { const t = Math.max(0, Math.min(1, (x - low) / (high - low))); return t * t * (3 - 2 * t); };
	return x + highlights * step(.5, 1) + shadows * (1 - step(0, .5)) + whites * step(.75, 1) + blacks * (1 - step(0, .25));
}
function close(actual: number, expected: number): void {
	assert.ok(Math.abs(actual - expected) <= 1e-12 * Math.max(1, Math.abs(expected)), `${String(actual)} != ${String(expected)}`);
}

test('native WebGL2 global preparation delivers independent exact WB and complete tone uniforms', async () => {
	const api = await owner(), prepared = api.preparePixelFrameWebGl2GlobalsCurrentV1([
		effect('white-balance-v1', { temperature: 50, tint: 100 }, 'balance'),
		effect('tone-ladder-v1', { exposure: 1, contrast: -50, highlights: -100, shadows: 100, whites: -100, blacks: 100 }, 'tone'),
	]);
	assert.equal(prepared.length, 2);
	assert.deepEqual(api.readPixelFrameWebGl2GlobalCurrentV1(prepared[0]), { id: 'balance', type: 'white-balance-v1', params0: [2, .5, 1, 0], params1: [0, 0, 0, 0] });
	assert.deepEqual(api.readPixelFrameWebGl2GlobalCurrentV1(prepared[1]), { id: 'tone', type: 'tone-ladder-v1', params0: [2, .5, -.25, .25], params1: [-.25, .25, 0, 0] });
	for (const [input, expected] of [[.16, .375], [.785, .5390625], [-.18, .41], [4, 3.59]] as const) close(uniformChannel(prepared[1]!, input, 0), expected);
	assert.deepEqual(([0, 1, 2] as const).map(channel => uniformChannel(prepared[0]!, -.25, channel)), [-.5, -.125, -.25]);
});

test('native GPU uniforms are detached and deeply frozen with exactly the existing linear preparation gains', async () => {
	const api = await owner(), input = effect('tone-ladder-v1', { exposure: 1, contrast: 50, highlights: 70, shadows: -30, whites: 20, blacks: -40 }, 'authored');
	const expected = prepareLinearGlobalEffectsV1([input])[0]!, prepared = api.preparePixelFrameWebGl2GlobalsCurrentV1([input]);
	const value = api.readPixelFrameWebGl2GlobalCurrentV1(prepared[0]);
	assert.deepEqual(value.params0, expected.params0); assert.deepEqual(value.params1, expected.params1);
	for (const owned of [prepared, prepared[0], value, value.params0, value.params1]) assert.equal(Object.isFrozen(owned), true);
	input.id = 'changed'; input.enabled = false; input.params.exposure = -5; input.params.whites = 100;
	assert.equal(value.id, 'authored'); assert.deepEqual(value.params0, expected.params0); assert.deepEqual(value.params1, expected.params1);
	assert.deepEqual(api.readPixelFrameWebGl2GlobalCurrentV1(prepared[0]), value);
});

test('preparation retains authored noncommuting stage order and omits only admitted disabled or neutral globals', async () => {
	const api = await owner(), exposure = effect('tone-ladder-v1', { exposure: 1 }, 'exposure'), shadows = effect('tone-ladder-v1', { shadows: 100 }, 'shadows');
	const stages = api.preparePixelFrameWebGl2GlobalsCurrentV1([effect('white-balance-v1', {}, 'neutral'), exposure,
		effect('tone-ladder-v1', { exposure: 5 }, 'disabled', false), shadows]);
	assert.deepEqual(stages.map(value => value.id), ['exposure', 'shadows']); assert.deepEqual(api.preparePixelFrameWebGl2GlobalsCurrentV1([]), []);
	const evaluate = (values: readonly Prepared[]) => values.reduce((sample, value) => Math.fround(uniformChannel(value, sample, 0)), .125);
	assert.equal(evaluate(stages), .375); assert.equal(evaluate([...stages].reverse()), .671875);
	const up = api.preparePixelFrameWebGl2GlobalsCurrentV1([exposure])[0]!;
	for (const value of [-4, -1e-30, 1e-30, 2 ** -126, 2, 16]) assert.equal(uniformChannel(up, value, 0), value * 2);
});

test('complete closed WB and tone metadata is admitted before skipping inactive effects or delivering identities', async () => {
	const api = await owner(); let calls = 0;
	const params = Object.defineProperty({}, 'exposure', { enumerable: true, get() { calls++; throw new Error('No accessors.'); } });
	const accessor = Object.defineProperty([], '0', { enumerable: true, get() { calls++; throw new Error('No array accessors.'); } });
	for (const value of [undefined, {}, new Array(1), accessor,
		[effect('tone-ladder-v1', params, 'accessor', false)], [effect('chroma-v1', {}, 'unsupported', false)],
		[effect('white-balance-v1', {}, 'same'), effect('tone-ladder-v1', {}, 'same', false)],
		[{ ...effect('white-balance-v1'), future: true }], [effect('tone-ladder-v1', { exposure: 5.01 }, 'invalid', false)],
		[effect('tone-ladder-v1', { contrast: Infinity })], [effect('white-balance-v1', { temperature: 101 })],
	]) assert.throws(() => api.preparePixelFrameWebGl2GlobalsCurrentV1(value));
	assert.equal(calls, 0);
	const maximum = Array.from({ length: 256 }, (_, index) => effect('tone-ladder-v1', { exposure: 1 }, `stage-${index}`));
	assert.equal(api.preparePixelFrameWebGl2GlobalsCurrentV1(maximum).length, 256);
	assert.throws(() => api.preparePixelFrameWebGl2GlobalsCurrentV1([...maximum, effect('white-balance-v1', {}, 'overflow')]));
});

test('uniform reads require the exact private prepared identity without inspecting forged or hostile properties', async () => {
	const api = await owner(), prepared = api.preparePixelFrameWebGl2GlobalsCurrentV1([effect('white-balance-v1', { temperature: 100 })])[0]!;
	let calls = 0;
	const hostile = new Proxy(prepared, { get() { calls++; throw new Error('No forged reads.'); }, getPrototypeOf() { calls++; throw new Error('No forged prototype.'); } });
	for (const value of [null, 1, {}, { ...prepared }, Object.create(prepared) as object, hostile,
		prepareLinearGlobalEffectsV1([effect('white-balance-v1', { temperature: 100 })])[0]]) assert.throws(() => api.readPixelFrameWebGl2GlobalCurrentV1(value), TypeError);
	assert.equal(calls, 0);
});

test('native GPU admission can read the normative scalar without losing the Float32 contrast-pivot witness', async () => {
	const api = await owner(); assert.equal(typeof api.pixelFrameWebGl2GlobalChannelCurrentV1, 'function', 'GPU numeric eligibility needs the owning native scalar capability.');
	const contrast = api.preparePixelFrameWebGl2GlobalsCurrentV1([effect('tone-ladder-v1', { contrast: 100 }, 'contrast')])[0]!;
	const actual = api.pixelFrameWebGl2GlobalChannelCurrentV1(contrast, Math.fround(.135), 0);
	assert.equal(actual, 2.1457672083613488e-8); assert.notEqual(actual, 0);
	const balance = api.preparePixelFrameWebGl2GlobalsCurrentV1([effect('white-balance-v1', { temperature: 50, tint: 100 }, 'balance')])[0]!;
	assert.deepEqual(([0, 1, 2] as const).map(channel => api.pixelFrameWebGl2GlobalChannelCurrentV1(balance, -.25, channel)), [-.5, -.125, -.25]);
	const exposure = api.preparePixelFrameWebGl2GlobalsCurrentV1([effect('tone-ladder-v1', { exposure: 1 }, 'exposure')])[0]!;
	for (const input of [1e-30, -1e-30, 2 ** -126, 2 ** -149, -(2 ** -149), 4]) {
		assert.equal(api.pixelFrameWebGl2GlobalChannelCurrentV1(exposure, input, 0), input * 2);
	}
});

test('normative scalar authority refuses copied, CPU-owned and hostile preparations without reflection', async () => {
	const api = await owner(); assert.equal(typeof api.pixelFrameWebGl2GlobalChannelCurrentV1, 'function', 'Native scalar admission must authenticate its own GPU preparation.');
	const prepared = api.preparePixelFrameWebGl2GlobalsCurrentV1([effect('white-balance-v1', { temperature: 100 })])[0]!;
	let calls = 0;
	const hostile = new Proxy(prepared, { get() { calls++; throw new Error('No forged reads.'); }, getPrototypeOf() { calls++; throw new Error('No forged prototype.'); },
		getOwnPropertyDescriptor() { calls++; throw new Error('No forged descriptors.'); } });
	for (const value of [null, 1, {}, { ...prepared }, Object.create(prepared) as object, hostile,
		prepareLinearGlobalEffectsV1([effect('white-balance-v1', { temperature: 100 })])[0]]) {
		assert.throws(() => api.pixelFrameWebGl2GlobalChannelCurrentV1(value, .25, 0), TypeError);
	}
	assert.equal(calls, 0);
	for (const sample of [Number.NaN, Infinity, -Infinity]) assert.throws(() => api.pixelFrameWebGl2GlobalChannelCurrentV1(prepared, sample, 0), TypeError);
	assert.throws(() => api.pixelFrameWebGl2GlobalChannelCurrentV1(prepared, .25, 3 as 0), RangeError);
});

test('shader source declares a native highp Float32 texel pass with unchanged straight alpha, without byte tables', async () => {
	const api = await owner(), vertex = api.PIXEL_FRAME_WEBGL2_GLOBAL_VERTEX_CURRENT_V1, fragment = api.PIXEL_FRAME_WEBGL2_GLOBAL_FRAGMENT_CURRENT_V1;
	for (const source of [vertex, fragment]) assert.match(source, /^#version 300 es/u);
	assert.match(vertex, /gl_VertexID/u); assert.match(fragment, /precision highp float/u); assert.match(fragment, /precision highp int/u);
	for (const declaration of ['uniform sampler2D uImage;', 'uniform int uKind;', 'uniform vec4 uParams0;', 'uniform vec4 uParams1;']) assert.ok(fragment.includes(declaration));
	assert.match(fragment, /texelFetch\(uImage,\s*ivec2\(gl_FragCoord\.xy\),\s*0\)/u);
	assert.match(fragment, /vec4\([^;]*\.a\)/u);
	assert.doesNotMatch(fragment, /255|UNSIGNED_BYTE|lookup|texture\(/u);
	assert.match(fragment, /uKind\s*==\s*1/u); assert.match(fragment, /uKind\s*==\s*2/u);
});

test('tone shader keeps the stable affine exposure term and all four unclipped native regional contributions', async () => {
	const api = await owner(), fragment = api.PIXEL_FRAME_WEBGL2_GLOBAL_FRAGMENT_CURRENT_V1;
	assert.match(fragment, /uParams0\.x\s*\*\s*uParams0\.y/u);
	assert.match(fragment, /0\.18\s*\*\s*\(1\.0\s*-\s*uParams0\.y\)/u);
	for (const parameter of ['uParams0.z', 'uParams0.w', 'uParams1.x', 'uParams1.y']) assert.ok(fragment.includes(parameter));
	for (const bounds of ['0.5, 1.0', '0.0, 0.5', '0.75, 1.0', '0.0, 0.25']) assert.ok(fragment.includes(bounds));
	assert.doesNotMatch(fragment, /clamp\(\s*(?:rgb|exposed|result|color)\b/u);
});
