/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { withPhotoDevelopProxyV1 } from '../src/lightscaper/controller/photo-develop-proxy-v1.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { CURVE_PNG_BASE64, CURVE_SOURCE, CURVE_REFERENCES } from './browser/helpers/lightscaper-curve-reference.ts';

test('the native menu fixture is a literal two-row RGBA8 PNG matching the independent pixel reference', () => {
	const png = Buffer.from(CURVE_PNG_BASE64, 'base64');
	assert.equal(png.byteLength, 84);
	assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
	const chunks: Buffer[] = [], types: string[] = [];
	for (let offset = 8; offset < png.length;) {
		const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
		const body = png.subarray(offset + 8, offset + 8 + length);
		assert.equal(crc32(png.subarray(offset + 4, offset + 8 + length)), png.readUInt32BE(offset + 8 + length));
		types.push(type);
		if (type === 'IHDR') assert.deepEqual([...body], [0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0]);
		if (type === 'IDAT') chunks.push(body);
		offset += length + 12;
	}
	assert.deepEqual(types, ['IHDR', 'IDAT', 'IEND']);
	assert.deepEqual([...inflateSync(Buffer.concat(chunks))], [0, ...CURVE_SOURCE.slice(0, 8), 0, ...CURVE_SOURCE.slice(8)]);
});

for (const reference of CURVE_REFERENCES) test(`actual Photo proxy agrees with literal ${reference.type} browser pixels and every histogram bin`, async () => {
	const pixels = new Uint8Array(CURVE_SOURCE), source = [...pixels];
	const frame = { descriptor: { schemaVersion: 1, width: 2, height: 2, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels };
	let borrowed: Uint8Array | null = null;
	const result = await withPhotoDevelopProxyV1({ frame, develop: { ...defaultPhotoDevelopV1(),
		effects: [createVideoEffect(reference.type, { id: 'native-menu-reference', params: reference.params })] } }, view => {
		borrowed = view.frame.pixels;
		return { pixels: [...view.frame.pixels], histogram: view.histogram };
	});
	assert.deepEqual(result.pixels, reference.pixels);
	assert.deepEqual([...pixels], source);
	assert.ok((borrowed as Uint8Array | null)?.every(value => value === 0), 'The fixture uses the actual scoped proxy, whose borrowed output is retired.');
	assert.equal(result.histogram.sampledPixels, 4); assert.equal(result.histogram.transparentPixels, 0);
	assert.equal(result.histogram.lowClippedPixels, reference.low); assert.equal(result.histogram.highClippedPixels, reference.high);
	for (const channel of ['red', 'green', 'blue'] as const) {
		const expected = new Array<number>(256).fill(0);
		for (const [bin, count] of reference.bins[channel]) expected[bin] = count;
		assert.deepEqual(result.histogram.bins[channel], expected);
	}
});

function crc32(bytes: Uint8Array): number {
	let value = 0xffffffff;
	for (const byte of bytes) {
		value ^= byte;
		for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
	}
	return (value ^ 0xffffffff) >>> 0;
}
