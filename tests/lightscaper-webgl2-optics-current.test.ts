/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePixelFrameWebGl2OpticsCurrentV1 as prepare, readPixelFrameWebGl2OpticsCurrentV1 as read,
	isPixelFrameWebGl2OpticsCurrentV1 as isOptics, writePixelFrameWebGl2OpticsCurrentV1 as write } from '../src/common/editor/imaging/pixel-frame-webgl2-optics-current-v1.ts';
import type { LinearWorkingPixelFrameV1 } from '../src/common/editor/imaging/image-develop-linear-frame-v1.ts';
import type { PixelFrameDescriptorV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';

const effect = (type: string, params: Record<string, number> = {}, enabled = true) => ({ id: 'optics', type, enabled, params });
const descriptor = (width: number, height: number): LinearWorkingPixelFrameV1['descriptor'] => ({ schemaVersion: 1, width, height,
	sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' });
const frame = (values: readonly number[], width = values.length / 4, height = 1): LinearWorkingPixelFrameV1 => ({ descriptor: descriptor(width, height), pixels: Float32Array.from(values) });
const bits = (values: Float32Array<ArrayBuffer>) => new Uint32Array(values.buffer, values.byteOffset, values.length).slice();
const decoded = (value: number) => Math.sign(value) * (Math.abs(value) <= .04045 ? Math.abs(value) / 12.92 : ((Math.abs(value) + .055) / 1.055) ** 2.4);
async function render(source: LinearWorkingPixelFrameV1, selected: unknown) {
	const pass = prepare(selected, source.descriptor), target = new Float32Array(source.pixels.length).fill(19), before = bits(source.pixels);
	await write(pass, source, target); assert.deepEqual(bits(source.pixels), before); return { pass, target };
}

test('native optics preparation captures detached frozen scalar ABI and the same incoming/output extent', () => {
	for (const [type, params, kind, p0, p1] of [
		['lens-distortion-v1', { amount: 100 }, 10, [.3, 0, 0, 0], [1, 0, 0, 1]],
		['chromatic-aberration-v1', { red: -100, blue: 50 }, 11, [-.01, .005, 0, 0], [1, 1, 0, 1]],
		['defringe-v1', { purple: 25, green: 50, edgeThreshold: 75 }, 12, [.25, .5, .75, 0], [1, 0, 0, 1]],
		['optical-vignette-v1', { amount: -100 }, 13, [-2, 0, 0, 0], [1, 0, 0, 1]],
	] as const) {
		const selected = effect(type, { ...params }), pass = prepare(selected, descriptor(3, 5));
		assert.equal(read(pass), pass); assert.equal(isOptics(pass), true); assert.equal(pass.type, type); assert.equal(pass.kind, kind); assert.equal(pass.id, 'optics');
		assert.deepEqual(pass.sourceDescriptor, descriptor(3, 5)); assert.deepEqual(pass.descriptor, descriptor(3, 5));
		assert.deepEqual(pass.params0, p0); assert.deepEqual(pass.params1, p1); assert.equal(pass.supported, true);
		for (const value of [pass, pass.sourceDescriptor, pass.descriptor, pass.params0, pass.params1]) assert.equal(Object.isFrozen(value), true);
		selected.enabled = false; selected.params.amount = 0; assert.deepEqual(pass.params0, p0); assert.deepEqual(pass.params1, p1);
	}
});

test('raw activity remains separate from coefficients and unsupported Float32 conversions are truthful metadata', async () => {
	const source = frame([47, -0, 2 ** -149, 0]);
	const lens = await render(source, effect('lens-distortion-v1', { amount: Number.MIN_VALUE }));
	assert.deepEqual(lens.pass.params0, [0, 0, 0, 0]); assert.equal(lens.pass.params1[0], 1); assert.equal(lens.pass.supported, true);
	assert.deepEqual(lens.target, new Float32Array(4), 'active zero-derived lens still filters hidden alpha-zero color');
	const ca = await render(source, effect('chromatic-aberration-v1', { red: Number.MIN_VALUE, blue: 0 }));
	assert.deepEqual(ca.pass.params0, [0, 0, 0, 0]); assert.deepEqual(ca.pass.params1, [1, 0, 0, 1]);
	assert.deepEqual(bits(ca.target), bits(Float32Array.from([0, -0, 2 ** -149, 0])));
	for (const selected of [effect('lens-distortion-v1', { amount: 1e-43 }), effect('chromatic-aberration-v1', { red: 1e-43 })]) {
		const pass = prepare(selected, descriptor(3, 3)); assert.notEqual(pass.params0[0], 0); assert.equal(Math.fround(pass.params0[0]), 0);
		assert.equal(pass.params1[0], 1); assert.equal(pass.supported, false);
	}
});

test('private CPU lens plan retains independent signed HDR premultiplied rational literals', async () => {
	const result = await render(frame([2, -.5, .125, 1, 0, 1, 4, .5, 8, 2, -2, 0]), effect('lens-distortion-v1', { amount: -100 }));
	assert.deepEqual(result.target, Float32Array.from([88 / 47, -19 / 47, 35 / 94, .94, 0, 1, 4, .5, 0, 1, 4, .06]));
	const positive = await render(frame([2, -.5, 1e-30, .5, 3, 4, 5, 1, 100, -100, 8, 0]), effect('lens-distortion-v1', { amount: 100 }));
	assert.deepEqual(positive.target, Float32Array.from([2, -.5, 1e-30, .44, 3, 4, 5, 1, 0, 0, 0, 0]));
});

test('private CPU CA plan keeps Green, reference alpha and zero-controlled Blue bits while reconstructing signed Red', async () => {
	const source = frame([2, -0, 8, .5, 4, 1e-30, -2, 1, 16, -(2 ** -149), 4, 0]);
	const result = await render(source, effect('chromatic-aberration-v1', { red: -100, blue: 0 }));
	assert.deepEqual(bits(result.target), bits(Float32Array.from([506 / 251, -0, 8, .5, 4, 1e-30, -2, 1, 4, -(2 ** -149), 4, 0])));
});

test('tiny stable CA basis retains diagonal Double support below Float32 before its own alpha normalization', async () => {
	for (const red of [-1e-12, -1e-20]) {
		const values = Array.from({ length: 9 }, (_, i) => [i === 4 ? 3.25 : -2, i % 2 ? 1e-30 : -0, -(2 ** -149), i === 4 ? .5 : 0]).flat();
		const source = frame(values, 3, 3), result = await render(source, effect('chromatic-aberration-v1', { red, blue: 0 }));
		assert.equal(result.pass.params0[0], red * .0001); assert.deepEqual(result.pass.params1, [1, 0, 0, 1]);
		for (let index = 0; index < 9; index++) {
			assert.equal(result.target[index * 4], 3.25);
			for (const channel of [1, 2, 3]) assert.ok(Object.is(result.target[index * 4 + channel], source.pixels[index * 4 + channel]));
		}
	}
});

test('private CPU Defringe stays continuous, handles supported aliases and preserves flat/hidden native bits', async () => {
	const result = await render(frame([0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1]), effect('defringe-v1', { purple: 100, green: 0, edgeThreshold: 25 }));
	const gray = decoded(73 / 256); assert.deepEqual(result.target, Float32Array.from([0, 0, 0, 1, gray, gray, gray, 1, 1, 1, 1, 1]));
	const flat = frame([4, 1e-30, -0, .25, 4, 1e-30, -0, .75, 4, 1e-30, -0, 1]);
	assert.deepEqual(bits((await render(flat, effect('defringe-v1', { purple: 100, green: 100, edgeThreshold: 0 }))).target), bits(flat.pixels));
	const hidden = frame([-0, 2 ** -149, 4, -0]);
	assert.deepEqual(bits((await render(hidden, effect('defringe-v1', { purple: 100, green: 100, edgeThreshold: 0 }))).target), bits(hidden.pixels));
});

test('private CPU optical plan uses stage-local sqrt2 and direct native gains with exact zero/hidden bypass', async () => {
	const source = frame([2, -1, .001, .5, 0, -0, 4, 1, -2, 3, 1e-30, .25, 47, -19, 8, 0], 2, 2);
	const result = await render(source, effect('optical-vignette-v1', { amount: 100 })), expected = source.pixels.slice();
	for (let i = 0; i < 12; i++) if (i % 4 !== 3 && expected[i] !== 0) expected[i] = expected[i]! * Math.SQRT2;
	assert.deepEqual(bits(result.target), bits(expected));
	const line = await render(frame([2, -1, .001, 1, 2, -1, .001, 1, 2, -1, .001, 1]), effect('optical-vignette-v1', { amount: 100 }));
	assert.equal(line.target[0], Math.fround(2 * 2 ** .8)); assert.equal(line.target[4], 2);
	const overflow = frame([3.4028234663852886e38, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
	await assert.rejects(write(prepare(effect('optical-vignette-v1', { amount: 100 }), overflow.descriptor), overflow, new Float32Array(12)), /finite|Float32|range/u);
});

test('disabled and raw-neutral optics copy exact native hidden, negative-zero and subnormal bits', async () => {
	const source = frame([-0, -(2 ** -149), 4, 0, 1e-30, -0, -2, 1]);
	for (const [type, active] of [['lens-distortion-v1', { amount: 100 }], ['chromatic-aberration-v1', { red: 100, blue: -100 }],
		['defringe-v1', { purple: 100, green: 100 }], ['optical-vignette-v1', { amount: 100 }]] as const) {
		const disabled = await render(source, effect(type, { ...active }, false)); assert.equal(disabled.pass.params1[3], 0);
		assert.deepEqual(bits(disabled.target), bits(source.pixels));
		const neutral = await render(source, effect(type)); assert.equal(neutral.pass.params1[0], 0); assert.equal(neutral.pass.params1[1], 0);
		assert.deepEqual(bits(neutral.target), bits(source.pixels));
	}
});

test('optics close controls/profile metadata and reject forged or revoked pass identities without reflecting them', async () => {
	const selected = effect('lens-distortion-v1', { amount: 100 }), source = frame([2, 3, 4, 1]), pass = prepare(selected, source.descriptor);
	for (const candidate of [effect('other-v1'), effect('lens-distortion-v1', { amount: 101 }), { ...selected, extra: true }]) assert.throws(() => prepare(candidate, source.descriptor));
	for (const bad of [{ ...source.descriptor, sampleFormat: 'unorm16' }, { ...source.descriptor, transfer: 'srgb' },
		{ ...source.descriptor, primaries: 'display-p3' }]) assert.throws(() => prepare(selected, bad as PixelFrameDescriptorV1), /linear|float|profile/u);
	let probes = 0; const poisoned = { ...selected, get params(): never { probes++; throw new Error('getter'); } };
	assert.throws(() => prepare(poisoned, source.descriptor), /data|accessor/u); assert.equal(probes, 0);
	const hostile = new Proxy({}, { get() { probes++; throw new Error('get'); }, getPrototypeOf() { probes++; throw new Error('prototype'); } });
	const revoked = Proxy.revocable({}, {}); revoked.revoke();
	for (const value of [{ ...pass }, hostile, revoked.proxy, null]) { assert.equal(isOptics(value), false); assert.throws(() => read(value), /prepared|owning|identity/u); }
	assert.equal(probes, 0); const target = new Float32Array(4).fill(19); await assert.rejects(write({ ...pass }, source, target), /prepared|owning|identity/u);
	assert.deepEqual(target, new Float32Array(4).fill(19));
});

test('delegated optics writers bind descriptors and require dedicated disjoint caller-owned planes', async () => {
	const source = frame([2, 3, 4, 1, 5, 6, 7, 1]), pass = prepare(effect('lens-distortion-v1', { amount: 50 }), source.descriptor), target = new Float32Array(8).fill(19);
	await assert.rejects(write(pass, { ...source, descriptor: descriptor(1, 2) }, target), /descriptor|binding|geometry/u);
	await assert.rejects(write(pass, source, source.pixels), /overlap|alias|separate/u);
	await assert.rejects(write(pass, source, new Float32Array(10).subarray(1, 9)), /dedicated/u);
	let probes = 0; Object.defineProperty(target, 'buffer', { get(): never { probes++; throw new Error('shadow'); } });
	await assert.rejects(write(pass, source, target), /shadow|intrinsic/u); assert.equal(probes, 0);
	assert.deepEqual([...target], Array.from({ length: 8 }, () => 19));
});

test('opaque preabort and yielded transfer failures retain exact outcomes through the delegated writer', async () => {
	const source = frame([2, 3, 4, 1]), pass = prepare(effect('lens-distortion-v1', { amount: 100 }), source.descriptor), stop = new AbortController();
	const revoked = Proxy.revocable({}, {}); revoked.revoke(); stop.abort(revoked.proxy);
	const result = await write(pass, source, new Float32Array(4), stop.signal).then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
	assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, revoked.proxy), true);
	for (const transfer of ['abort', 'source', 'target'] as const) {
		const large = frame(Array.from({ length: 512 * 512 * 4 }, () => 1), 512, 512), target = new Float32Array(large.pixels.length);
		const prepared = prepare(effect('chromatic-aberration-v1', { red: -100 }), large.descriptor);
		const controller = new AbortController(), timer = setTimeout(() => {
			if (transfer === 'abort') controller.abort(revoked.proxy);
			else { const buffer = transfer === 'source' ? large.pixels.buffer : target.buffer; structuredClone(buffer, { transfer: [buffer] }); }
		}, 0);
		try {
			const result = await write(prepared, large, target, controller.signal).then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
			assert.equal(result.ok, false); if (!result.ok) {
				if (transfer === 'abort') assert.equal(Object.is(result.error, revoked.proxy), true);
				else assert.ok(result.error instanceof TypeError && /detach|changed/u.test(result.error.message));
			}
		}
		finally { clearTimeout(timer); }
	}
});
