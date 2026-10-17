/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withPhotoDevelopProxyV1 } from '../src/lightscaper/controller/photo-develop-proxy-v1.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { CURVE_PNG_BASE64, CURVE_SOURCE } from './browser/helpers/lightscaper-curve-reference.ts';
import { WHEEL_PNG_BASE64, WHEEL_SOURCE, WHEEL_REFERENCES } from './browser/helpers/lightscaper-color-wheels-reference.ts';

test('wheel native source reuses the independently qualified literal PNG and immutable exact row-major pixels', () => {
	assert.equal(WHEEL_PNG_BASE64, CURVE_PNG_BASE64); assert.equal(Buffer.from(WHEEL_PNG_BASE64, 'base64').byteLength, 84);
	assert.deepEqual(WHEEL_SOURCE, [0,32,64,255,64,128,192,255,128,128,128,255,255,224,16,255]);
	assert.deepEqual(WHEEL_SOURCE, CURVE_SOURCE); assert.ok(Object.isFrozen(WHEEL_SOURCE));
	for (const reference of WHEEL_REFERENCES) { assert.ok(Object.isFrozen(reference)); assert.ok(Object.isFrozen(reference.params)); assert.equal(Object.keys(reference.params).length, 9); }
});

for (const reference of WHEEL_REFERENCES) test(`actual scoped Photo proxy matches independent ${reference.name} native pixels and all histogram bins`, async () => {
	const pixels = new Uint8Array(WHEEL_SOURCE), source = [...pixels]; let borrowed: Uint8Array | null = null;
	const frame = { descriptor: { schemaVersion: 1, width: 2, height: 2, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels };
	const result = await withPhotoDevelopProxyV1({ frame, develop: { ...defaultPhotoDevelopV1(),
		effects: [createVideoEffect('color-wheels-v1', { id: 'native-wheel-reference', params: reference.params })] } }, view => {
		borrowed = view.frame.pixels; return { pixels: [...view.frame.pixels], histogram: view.histogram };
	});
	assert.deepEqual(result.pixels, reference.pixels); assert.deepEqual([...pixels], source);
	assert.ok((borrowed as Uint8Array | null)?.every(value => value === 0));
	assert.equal(result.histogram.sampledPixels, 4); assert.equal(result.histogram.transparentPixels, 0);
	assert.equal(result.histogram.lowClippedPixels, reference.low); assert.equal(result.histogram.highClippedPixels, reference.high);
	for (const channel of ['red', 'green', 'blue'] as const) {
		const expected = new Array<number>(256).fill(0); for (const [bin, count] of reference.bins[channel]) expected[bin] = count;
		assert.deepEqual(result.histogram.bins[channel], expected);
	}
});
