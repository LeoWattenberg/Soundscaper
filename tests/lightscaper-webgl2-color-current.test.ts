/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePixelFrameWebGl2GlobalsCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-global-current-v1.ts';
import { PIXEL_FRAME_WEBGL2_COLOR_SCRATCH_BYTES_CURRENT_V1, preparePixelFrameWebGl2ColorsCurrentV1,
	readPixelFrameWebGl2ColorCurrentV1, writePixelFrameWebGl2ColorChannelsCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-color-current-v1.ts';

const effect = (type: string, params: Readonly<Record<string, unknown>> = {}, id = type, enabled = true) => ({ id, type, enabled, params });
const linear = (value: number) => Math.sign(value) * (Math.abs(value) <= .04045 ? Math.abs(value) / 12.92 : ((Math.abs(value) + .055) / 1.055) ** 2.4);
function sample(value: unknown, rgb: readonly number[]) {
	const output = { red: 0, green: 0, blue: 0 };
	writePixelFrameWebGl2ColorChannelsCurrentV1(value, rgb[0]!, rgb[1]!, rgb[2]!, output);
	return [output.red, output.green, output.blue];
}
function close(actual: readonly number[], expected: readonly number[]) {
	assert.equal(actual.length, expected.length);
	for (let at = 0; at < actual.length; at++) assert.ok(Math.abs(actual[at]! - expected[at]!) <= 1e-12 * Math.max(1, Math.abs(expected[at]!)), `${String(at)}: ${String(actual[at])} vs ${String(expected[at])}`);
}

test('native GPU color preparation owns all eight continuous color families and bounded detached uniforms', () => {
	const passes = preparePixelFrameWebGl2ColorsCurrentV1([
		effect('white-balance-v1', { temperature: 100 }), effect('tone-ladder-v1', { exposure: 1 }),
		effect('chroma-v1', { saturation: 100, vibrance: -25 }), effect('black-white-mix-v1'),
		effect('hsl-mixer-v1', { redHue: 60, orangeSaturation: 33.333, magentaLuminance: -20 }),
		effect('point-curves-v1', { master: [{ x: 0, y: 0 }, { x: 1, y: .5 }] }),
		effect('parametric-curves-v1', { masterShadows: 100 }), effect('color-wheels-v1', { highlightsLuminance: 100 }),
	]);
	assert.deepEqual(passes.map(pass => pass.kind), [1, 2, 3, 4, 5, 6, 6, 7]);
	assert.equal(PIXEL_FRAME_WEBGL2_COLOR_SCRATCH_BYTES_CURRENT_V1, 4096);
	for (const pass of passes) {
		assert.equal(readPixelFrameWebGl2ColorCurrentV1(pass), pass); assert.equal(pass.supported, true); assert.ok(Object.isFrozen(pass));
		for (const tuple of [pass.params0, pass.params1, pass.params2, pass.curveCounts]) { assert.equal(tuple.length, 4); assert.ok(Object.isFrozen(tuple)); }
		assert.equal(pass.bands.length, 8); assert.ok(Object.isFrozen(pass.bands));
		for (const band of pass.bands) { assert.equal(band.length, 4); assert.ok(Object.isFrozen(band)); }
		assert.equal(pass.curvePoints.length, 256); assert.ok(Object.isFrozen(pass.curvePoints));
	}
	assert.deepEqual(passes[0]!.params0, [2, 1, .5, 0]); assert.deepEqual(passes[2]!.params0, [100, -25, 0, 0]);
	assert.deepEqual(passes[4]!.bands[0], [60, 0, 0, 0]); assert.deepEqual(passes[4]!.bands[1], [0, 33.333, 0, 0]);
	assert.deepEqual(passes[4]!.bands[7], [0, 0, -20, 0]);
	assert.deepEqual(passes[5]!.params0, [0, 1, 1, 1]); assert.deepEqual(passes[5]!.curveCounts, [2, 2, 2, 2]);
	assert.deepEqual(passes[5]!.curvePoints.slice(0, 6), [0, 0, 1, .5, 0, 0]);
	assert.deepEqual(passes[5]!.curvePoints.slice(64, 70), [0, 0, 1, 1, 0, 0]);
	assert.deepEqual(passes[7]!.params0, [0, 0, 0, 0]); assert.deepEqual(passes[7]!.params1, [2, 2, 2, 0]);
	assert.deepEqual(passes[7]!.params2, [1, 1, 1, 0]);
});

test('GPU prepared identities retain the native Double oracle instead of video byte lookup math', () => {
	const pass = (type: string, params: Readonly<Record<string, unknown>> = {}) => {
		const prepared = preparePixelFrameWebGl2ColorsCurrentV1([effect(type, params)])[0]; assert.ok(prepared); return prepared;
	};
	close(sample(pass('chroma-v1', { saturation: 100 }), [.75, .25, .25].map(linear)), [1.14453125, .14453125, .14453125].map(linear));
	close(sample(pass('black-white-mix-v1'), [1, 0, 0]), [54 / 256, 54 / 256, 54 / 256].map(linear));
	close(sample(pass('hsl-mixer-v1', { redHue: 60 }), [.75, .25, .25].map(linear)), [.75, .75, .25].map(linear));
	close(sample(pass('point-curves-v1', { master: [{ x: 0, y: 0 }, { x: 1, y: .5 }] }), [1, 0, -1]), [.5, 0, -.5].map(linear));
	close(sample(pass('parametric-curves-v1', { masterShadows: 100 }), [.125, .125, .125].map(linear)), [.25, .25, .25].map(linear));
	assert.deepEqual(sample(pass('color-wheels-v1', { highlightsLuminance: 100 }), [-4, .25, 2]), [-8, .5, 4]);
	assert.deepEqual(sample(pass('white-balance-v1', { temperature: 100 }), [1, 2, 3]), [2, 2, 1.5]);
	assert.deepEqual(sample(pass('tone-ladder-v1', { exposure: 1 }), [-1e-30, .25, 2]), [-2e-30, .5, 4]);
});

test('old owning global passes canonicalize once while forged and revoked preparations reflect no fields', () => {
	const old = preparePixelFrameWebGl2GlobalsCurrentV1([effect('white-balance-v1', { temperature: 100 })])[0]; assert.ok(old);
	const captured = readPixelFrameWebGl2ColorCurrentV1(old);
	assert.equal(readPixelFrameWebGl2ColorCurrentV1(old), captured); assert.equal(readPixelFrameWebGl2ColorCurrentV1(captured), captured);
	assert.deepEqual(sample(old, [1, 2, 3]), [2, 2, 1.5]);
	let reflected = 0;
	const forged = new Proxy({}, { get() { reflected++; assert.fail('Forged identity reflection'); }, ownKeys() { reflected++; assert.fail('Forged identity enumeration'); } });
	assert.throws(() => readPixelFrameWebGl2ColorCurrentV1(forged), TypeError);
	const revoked = Proxy.revocable({}, {}); revoked.revoke();
	assert.throws(() => readPixelFrameWebGl2ColorCurrentV1(revoked.proxy), TypeError); assert.equal(reflected, 0);
});

test('complete color admission validates disabled metadata, duplicate IDs and array bounds before filtering', () => {
	assert.throws(() => preparePixelFrameWebGl2ColorsCurrentV1([effect('chroma-v1', { saturation: 101 }, 'invalid', false)]), RangeError);
	assert.throws(() => preparePixelFrameWebGl2ColorsCurrentV1([effect('hsl-mixer-v1', { redHue: Infinity }, 'invalid', false)]), RangeError);
	assert.throws(() => preparePixelFrameWebGl2ColorsCurrentV1([effect('point-curves-v1', { master: [{ x: 0, y: 0 }, { x: 0, y: 1 }] }, 'invalid', false)]), RangeError);
	assert.throws(() => preparePixelFrameWebGl2ColorsCurrentV1([effect('grain-v1', {}, 'unsupported', false)]), RangeError);
	assert.throws(() => preparePixelFrameWebGl2ColorsCurrentV1([effect('black-white-mix-v1', {}, 'same'), effect('chroma-v1', {}, 'same', false)]), /unique|duplicate/u);
	const bounded = Array.from({ length: 256 }, (_, index) => effect('chroma-v1', {}, String(index)));
	assert.deepEqual(preparePixelFrameWebGl2ColorsCurrentV1(bounded), []);
	assert.throws(() => preparePixelFrameWebGl2ColorsCurrentV1([...bounded, effect('chroma-v1', {}, '257')]), RangeError);
	let getterCalls = 0;
	const params = { get saturation(): never { getterCalls++; return assert.fail('Disabled parameter getter must not run.'); } };
	assert.throws(() => preparePixelFrameWebGl2ColorsCurrentV1([effect('chroma-v1', params, 'accessor', false)]), TypeError);
	assert.equal(getterCalls, 0);
});

test('native color activity preserves black-and-white at zero controls and authored controls below Float32 uniform range', () => {
	assert.deepEqual(preparePixelFrameWebGl2ColorsCurrentV1(['white-balance-v1', 'tone-ladder-v1', 'chroma-v1', 'hsl-mixer-v1',
		'point-curves-v1', 'parametric-curves-v1', 'color-wheels-v1'].map(type => effect(type))), []);
	const blackWhite = preparePixelFrameWebGl2ColorsCurrentV1([effect('black-white-mix-v1'), effect('black-white-mix-v1', {}, 'disabled', false)]);
	assert.equal(blackWhite.length, 1); assert.equal(blackWhite[0]!.kind, 4);
	const tiny = preparePixelFrameWebGl2ColorsCurrentV1([effect('chroma-v1', { saturation: Number.MIN_VALUE }),
		effect('hsl-mixer-v1', { redHue: Number.MIN_VALUE }), effect('color-wheels-v1', { midtonesLuminance: Number.MIN_VALUE })]);
	assert.deepEqual(tiny.map(pass => pass.kind), [3, 5, 7]);
	assert.equal(tiny[0]!.params0[0], Number.MIN_VALUE); assert.equal(Math.fround(tiny[0]!.params0[0]), 0);
	assert.equal(tiny[1]!.bands[0][0], Number.MIN_VALUE);
});

test('prepared bands, knots and normative channels remain detached after caller metadata is replaced', () => {
	const hsl = { redHue: 60 }, points = [{ x: 0, y: 0 }, { x: 1, y: .5 }], wheels = { highlightsLuminance: 100 };
	const passes = preparePixelFrameWebGl2ColorsCurrentV1([effect('hsl-mixer-v1', hsl), effect('point-curves-v1', { master: points }), effect('color-wheels-v1', wheels)]);
	const before = JSON.stringify(passes);
	hsl.redHue = -180; points[1]!.y = 1; wheels.highlightsLuminance = -100;
	Object.defineProperty(hsl, 'redHue', { get() { assert.fail('Prepared execution must not reacquire caller controls.'); } });
	assert.equal(JSON.stringify(passes), before);
	close(sample(passes[0], [.75, .25, .25].map(linear)), [.75, .75, .25].map(linear));
	close(sample(passes[1], [1, 0, -1]), [.5, 0, -.5].map(linear));
	assert.deepEqual(sample(passes[2], [-4, .25, 2]), [-8, .5, 4]);
});

test('valid curve metadata falls back when distinct Double knots collapse or a slope cannot fit native uniforms', () => {
	const collapsed = preparePixelFrameWebGl2ColorsCurrentV1([effect('point-curves-v1', { master: [
		{ x: 0, y: 0 }, { x: .5, y: .25 }, { x: .5 + Number.EPSILON, y: .75 }, { x: 1, y: 1 },
	] })])[0]; assert.ok(collapsed); assert.equal(collapsed.supported, false); assert.equal(collapsed.curveCounts[0], 4);
	assert.notEqual(collapsed.curvePoints[2], collapsed.curvePoints[4]);
	assert.equal(Math.fround(collapsed.curvePoints[2]!), Math.fround(collapsed.curvePoints[4]!));
	close(sample(collapsed, [-1, 0, 1]), [-.5, 0, 1].map(linear));
	const steep = preparePixelFrameWebGl2ColorsCurrentV1([effect('point-curves-v1', { master: [
		{ x: 0, y: 0 }, { x: 1e-40, y: 1 }, { x: 1, y: 1 },
	] })])[0]; assert.ok(steep); assert.equal(steep.supported, false);
	assert.notEqual(Math.fround(steep.curvePoints[0]!), Math.fround(steep.curvePoints[2]!));
});

test('uniform-shaped forgeries and nonfinite native samples cannot write the caller result target', () => {
	const pass = preparePixelFrameWebGl2ColorsCurrentV1([effect('chroma-v1', { saturation: 100 })])[0]; assert.ok(pass);
	let writes = 0;
	const target = new Proxy({ red: 17, green: 19, blue: 23 }, { set() { writes++; assert.fail('Invalid identity or RGB must refuse before output writes.'); } });
	assert.throws(() => writePixelFrameWebGl2ColorChannelsCurrentV1({ ...pass, supported: true }, 1, 2, 3, target), TypeError);
	for (const rgb of [[NaN, 1, 2], [1, Infinity, 2], [1, 2, -Infinity]]) {
		assert.throws(() => writePixelFrameWebGl2ColorChannelsCurrentV1(pass, rgb[0]!, rgb[1]!, rgb[2]!, target), TypeError);
	}
	assert.equal(writes, 0);
});
