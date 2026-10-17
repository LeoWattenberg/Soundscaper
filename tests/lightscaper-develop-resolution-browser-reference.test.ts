/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { RESOLUTION_PNG_BASE64, RESOLUTION_WIDTH, RESOLUTION_HEIGHT, resolutionPixels, resolutionBins } from './browser/helpers/lightscaper-resolution-reference.ts';
import { PHOTO_DEVELOP_RENDER_RUNTIME_V1 } from '../src/lightscaper/photo-develop-render-runtime-v1.ts';
import { normalizePhotoDevelopV1, defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import type { PixelFrameHistogramV1 } from '../src/common/editor/imaging/pixel-frame-histogram-v1.ts';

test('the literal resolution PNG authenticates every chunk and inflates to all claimed source rows', () => {
	const bytes = Buffer.from(RESOLUTION_PNG_BASE64, 'base64'); assert.deepEqual([...bytes.subarray(0,8)], [137,80,78,71,13,10,26,10]);
	const names: string[] = [], compressed: Buffer[] = [];
	for (let offset = 8; offset < bytes.length;) {
		const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8), end = offset + 8 + length;
		assert.ok(end + 4 <= bytes.length); names.push(type);
		assert.equal(crc(bytes.subarray(offset + 4, end)), bytes.readUInt32BE(end), type);
		if (type === 'IHDR') { assert.equal(length, 13); assert.equal(bytes.readUInt32BE(offset + 8), RESOLUTION_WIDTH);
			assert.equal(bytes.readUInt32BE(offset + 12), RESOLUTION_HEIGHT); assert.deepEqual([...bytes.subarray(offset + 16, end)], [8,6,0,0,0]); }
		if (type === 'IDAT') compressed.push(bytes.subarray(offset + 8, end));
		if (type === 'IEND') { assert.equal(length, 0); assert.equal(end + 4, bytes.length); }
		offset = end + 4;
	}
	assert.deepEqual(names, ['IHDR','IDAT','IEND']); const raw = inflateSync(Buffer.concat(compressed)), expected = resolutionPixels();
	assert.equal(raw.length, RESOLUTION_HEIGHT * (RESOLUTION_WIDTH * 4 + 1));
	for (let y = 0; y < RESOLUTION_HEIGHT; y++) {
		const start = y * (RESOLUTION_WIDTH * 4 + 1); assert.equal(raw[start], 0);
		assert.deepEqual([...raw.subarray(start + 1, start + 1 + RESOLUTION_WIDTH * 4)], [...expected.subarray(y * RESOLUTION_WIDTH * 4, (y + 1) * RESOLUTION_WIDTH * 4)]);
	}
});

test('the actual full product runtime agrees byte-for-byte with independent spatial and all-bin browser references', async () => {
	const render = PHOTO_DEVELOP_RENDER_RUNTIME_V1.withFullResolution; assert.ok(render);
	for (const developed of [false, true]) {
		const pixels = resolutionPixels(), expected = [...resolutionPixels(developed)]; let backing: ArrayBuffer | undefined;
		const develop = normalizePhotoDevelopV1({ ...defaultPhotoDevelopV1(), effects: developed ? [createVideoEffect('detail-sharpen-v1', { params: { amount: 50 } })] : [] });
		const result: { pixels: number[]; histogram: Readonly<PixelFrameHistogramV1> } = await render({ frame: { descriptor: { schemaVersion: 1, width: RESOLUTION_WIDTH, height: RESOLUTION_HEIGHT,
			sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels }, develop, signal: new AbortController().signal }, view => {
			backing = view.frame.pixels.buffer; return { pixels: [...view.frame.pixels], histogram: view.histogram };
		});
		assert.deepEqual(result.pixels, expected);
		for (const channel of ['red','green','blue'] as const) assert.deepEqual(result.histogram.bins[channel], resolutionBins(developed));
		assert.equal(result.histogram.sampledPixels, RESOLUTION_WIDTH * RESOLUTION_HEIGHT);
		assert.equal(result.histogram.lowClippedPixels, 0); assert.equal(result.histogram.highClippedPixels, 0);
		assert.deepEqual([...pixels], [...resolutionPixels()]); assert.ok(backing); assert.ok(new Uint8Array(backing).every(byte => byte === 0));
	}
});
function crc(bytes: Uint8Array): number {
	let value = 0xffffffff;
	for (const byte of bytes) { value ^= byte; for (let n = 0; n < 8; n++) value = (value & 1) ? (value >>> 1) ^ 0xedb88320 : value >>> 1; }
	return (value ^ 0xffffffff) >>> 0;
}
