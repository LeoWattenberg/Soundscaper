/* SPDX-License-Identifier: AGPL-3.0-only */
// Exact native blend words; shader execution is covered separately.
import assert from 'node:assert/strict';
import test from 'node:test';
import { blendLinearMaskCurrentV1 as blend } from '../src/common/editor/imaging/image-develop-linear-mask-blend-current-v1.ts';
const frame = (values: readonly number[]) => ({ descriptor: { schemaVersion: 1 as const, width: values.length / 4, height: 1,
	sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const }, pixels: Float32Array.from(values) });

test('generic endpoints copy exact selected RGB and alpha while fractional equal signed zeros retain arithmetic', async () => {
	for (const q of [0, 128, 255]) {
		const source = frame([-0, 2, -3, -0]), target = Float32Array.of(0, 4, -5, 1);
		await blend(source, target, Uint8Array.of(q), { kind: 'generic' });
		assert.ok(Object.is(target[0], q === 0 ? -0 : 0)); assert.ok(Object.is(target[3], -0));
		assert.equal(target[1], Math.fround(q === 0 ? 2 : q === 255 ? 4 : 2 + q / 255 * 2));
		assert.equal(target[2], Math.fround(q === 0 ? -3 : q === 255 ? -5 : -3 + q / 255 * -2));
	}
});

test('unchanged equality has precedence even over full coverage and preserves incoming negative zero', async () => {
	for (const q of [0, 128, 255]) {
		const source = frame([-0, 1e-30, 4, .375]), target = Float32Array.of(0, 1e-30, 8, .5);
		await blend(source, target, Uint8Array.of(q), { kind: 'unchanged-components' });
		assert.ok(Object.is(target[0], -0)); assert.ok(Object.is(target[1], source.pixels[1])); assert.equal(target[3], .375);
		assert.equal(target[2], Math.fround(q === 0 ? 4 : q === 255 ? 8 : 4 + q / 255 * 4));
	}
});

test('CA restores G and raw-zero R/B after fractional and endpoint blending', async () => {
	for (const q of [0, 128, 255]) {
		const source = frame([-0, -0, -0, .375]), target = Float32Array.of(3, 4, 5, .5);
		await blend(source, target, Uint8Array.of(q), { kind: 'ca-copy', copyRed: true, copyBlue: true });
		assert.ok([0, 1, 2].every(channel => Object.is(target[channel], -0))); assert.equal(target[3], .375);
	}
});

test('procedural coverage can alter hidden RGB; there is no new alpha-zero bypass', async () => {
	const source = frame([2, -.5, .125, 0]), target = Float32Array.of(4, -1, .25, 1);
	await blend(source, target, Uint8Array.of(128), { kind: 'generic' });
	assert.deepEqual([...target], [Math.fround(2 + 128 / 255 * 2), Math.fround(-.5 + 128 / 255 * -.5), Math.fround(.125 + 128 / 255 * .125), 0]);
});
