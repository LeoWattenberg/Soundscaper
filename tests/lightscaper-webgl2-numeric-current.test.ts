/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

interface Numeric {
	pixelFrameWebGl2NumericEligibleCurrentV1(source: Float32Array<ArrayBuffer>, passes: readonly unknown[], copy: boolean, arithmetic: boolean, check: () => void): Promise<boolean>;
	validatePixelFrameWebGl2ColorReadbackCurrentV1(source: Float32Array<ArrayBuffer>, result: Float32Array<ArrayBuffer>, passes: readonly unknown[], check: () => void): Promise<boolean>;
}
async function api() {
	const url = new URL('../src/common/editor/imaging/pixel-frame-webgl2-numeric-current-v1.ts', import.meta.url);
	assert.ok(existsSync(url), 'Native color readback requires a joined numeric-contract owner.');
	const numeric = await import(url.href) as Numeric;
	const globals = await import('../src/common/editor/imaging/pixel-frame-webgl2-global-current-v1.ts');
	return { ...numeric, passes: globals.preparePixelFrameWebGl2GlobalsCurrentV1([{ id: 'warm', type: 'white-balance-v1', enabled: true, params: { temperature: 100 } }]) };
}
const check = () => undefined;
function shifted(value: number, ulps: number): number {
	const slot = Float32Array.of(value), word = new Uint32Array(slot.buffer); word[0]! += ulps; return slot[0]!;
}

test('native color comparison has a bounded ULP contract with exact alpha, unchanged channels and signed zero', async () => {
	const owner = await api(), source = Float32Array.of(.125, .25, .5, -0), expected = Float32Array.of(.25, .25, .25, -0);
	assert.equal(await owner.validatePixelFrameWebGl2ColorReadbackCurrentV1(source, expected, owner.passes, check), true);
	for (const sign of [1, -1]) {
		const input = source.slice(), result = expected.slice(); input[0]! *= sign; result[0]! *= sign;
		result[0] = shifted(result[0]!, 8);
		assert.equal(await owner.validatePixelFrameWebGl2ColorReadbackCurrentV1(input, result, owner.passes, check), true);
		result[0] = shifted(expected[0]! * sign, 9);
		assert.equal(await owner.validatePixelFrameWebGl2ColorReadbackCurrentV1(input, result, owner.passes, check), false);
	}
	for (const at of [1, 3]) {
		const result = expected.slice(); result[at] = at === 3 ? 0 : shifted(result[at]!, 1);
		assert.equal(await owner.validatePixelFrameWebGl2ColorReadbackCurrentV1(source, result, owner.passes, check), false);
	}
	for (const value of [2 ** -50, 1, 2 ** 50, 2 ** 127]) for (const ulps of [-8, 8]) {
		const input = Float32Array.of(value / 2, .25, .5, 1), result = Float32Array.of(shifted(value, ulps), .25, .25, 1);
		assert.equal(await owner.validatePixelFrameWebGl2ColorReadbackCurrentV1(input, result, owner.passes, check), true,
			'ULP distance remains exact across exponent boundaries.');
	}
	assert.deepEqual([...source], [.125, .25, .5, -0]); assert.deepEqual([...expected], [.25, .25, .25, -0]);
});

test('native tiny normals, subnormals and exactly unchanged planes cannot disappear inside an absolute epsilon', async () => {
	const owner = await api();
	for (const value of [1e-30, 2 ** -149, -(2 ** -126)]) {
		const source = Float32Array.of(value, value, value, .375), expected = Float32Array.of(Math.fround(value * 2), value, Math.fround(value * .5), .375);
		assert.equal(await owner.validatePixelFrameWebGl2ColorReadbackCurrentV1(source, expected, owner.passes, check), true);
		const changed = expected.slice(); changed[0] = shifted(changed[0]!, 1);
		assert.equal(await owner.validatePixelFrameWebGl2ColorReadbackCurrentV1(source, changed, owner.passes, check), false);
		changed[0] = 0;
		assert.equal(await owner.validatePixelFrameWebGl2ColorReadbackCurrentV1(source, changed, owner.passes, check), false);
	}
	const source = Float32Array.of(-0, .10000000149011612, .10000000894069672, 0), changed = source.slice();
	changed[1] = shifted(changed[1]!, 1);
	assert.equal(await owner.validatePixelFrameWebGl2ColorReadbackCurrentV1(source, source.slice(), [], check), true);
	assert.equal(await owner.validatePixelFrameWebGl2ColorReadbackCurrentV1(source, changed, [], check), false);
});

test('the normative result rounds once per authored stage and nonfinite CPU results remain errors', async () => {
	const owner = await api(), globals = await import('../src/common/editor/imaging/pixel-frame-webgl2-global-current-v1.ts');
	const passes = globals.preparePixelFrameWebGl2GlobalsCurrentV1([
		{ id: 'warm', type: 'white-balance-v1', enabled: true, params: { temperature: 100 } },
		{ id: 'contrast', type: 'tone-ladder-v1', enabled: true, params: { contrast: 50 } },
	]);
	const source = Float32Array.of(.125, .25, .5, .75), expected = Float32Array.of(.32, .32, .32, .75);
	assert.equal(await owner.validatePixelFrameWebGl2ColorReadbackCurrentV1(source, expected, passes, check), true);
	const reversed = globals.preparePixelFrameWebGl2GlobalsCurrentV1([
		{ id: 'contrast', type: 'tone-ladder-v1', enabled: true, params: { contrast: 50 } },
		{ id: 'warm', type: 'white-balance-v1', enabled: true, params: { temperature: 100 } },
	]);
	assert.equal(await owner.validatePixelFrameWebGl2ColorReadbackCurrentV1(source, expected, reversed, check), false);
	await assert.rejects(owner.validatePixelFrameWebGl2ColorReadbackCurrentV1(Float32Array.of(2 ** 127, 0, 0, 1), Float32Array.of(0, 0, 0, 1), owner.passes, check), /finite|Float32/u);
	const invalid = expected.slice(); invalid[0] = Infinity;
	assert.equal(await owner.validatePixelFrameWebGl2ColorReadbackCurrentV1(source, invalid, passes, check), false);
});

test('numeric admission preserves existing subnormal, pivot and private pass-identity refusals', async () => {
	const owner = await api(), globals = await import('../src/common/editor/imaging/pixel-frame-webgl2-global-current-v1.ts');
	assert.equal(await owner.pixelFrameWebGl2NumericEligibleCurrentV1(Float32Array.of(2 ** -149, .25, .5, 1), owner.passes, true, false, check), false);
	assert.equal(await owner.pixelFrameWebGl2NumericEligibleCurrentV1(Float32Array.of(1e-30, .25, .5, 1), owner.passes, true, false, check), true);
	const pivot = globals.preparePixelFrameWebGl2GlobalsCurrentV1([{ id: 'pivot', type: 'tone-ladder-v1', enabled: true, params: { contrast: 100 } }]);
	assert.equal(await owner.pixelFrameWebGl2NumericEligibleCurrentV1(Float32Array.of(.135, .25, .5, 1), pivot, true, true, check), false);
	const revoked = Proxy.revocable({}, {}); revoked.revoke();
	for (const pass of [{ ...owner.passes[0] }, revoked.proxy]) {
		await assert.rejects(owner.validatePixelFrameWebGl2ColorReadbackCurrentV1(Float32Array.of(.125, .25, .5, 1), Float32Array.of(.25, .25, .25, 1), [pass], check));
	}
});

test('native readback validation yields and preserves opaque cancellation before any result admission', async () => {
	const owner = await api(), stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke();
	const source = new Float32Array(65_536 * 4), result = new Float32Array(source.length);
	for (let at = 0; at < source.length; at += 4) { source.set([.125, .25, .5, 1], at); result.set([.25, .25, .25, 1], at); }
	const work = owner.validatePixelFrameWebGl2ColorReadbackCurrentV1(source, result, owner.passes, () => { if (stop.signal.aborted) throw stop.signal.reason as unknown; });
	const timer = setTimeout(() => { stop.abort(reason.proxy); }, 0);
	try {
		const outcome = await work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
		assert.equal(outcome.ok, false); if (!outcome.ok) assert.ok(Object.is(outcome.error, reason.proxy));
		assert.equal(source[0], .125); assert.equal(result[0], .25);
	} finally { clearTimeout(timer); source.fill(0); result.fill(0); }
});
