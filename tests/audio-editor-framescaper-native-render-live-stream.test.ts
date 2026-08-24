/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	nativeRgbaFramePackV1ByteLength,
} from '../src/common/editor/native-rgba-frame-pack-v1-contract.ts';
import { assertUnifiedExactRenderOutputAdmission } from '../src/common/editor/unified-exact-render-output-admission.ts';
import {
	streamFramescaperNativeRgbaFramePackV1,
} from '../src/framescaper/native-render-frame-pack-v1.ts';

test('V14 live carrier exact length admits a two-hour 1080p30 stream beyond the old 16 GiB stage', () => {
	const byteLength = nativeRgbaFramePackV1ByteLength({
		width: 1920, height: 1080, frameCount: 2 * 60 * 60 * 30,
	});
	assert.ok(byteLength > 16 * 1024 ** 3);
	assert.equal(byteLength, 59 + 216_000 * (32 + 1920 * 1080 * 4));
	assert.doesNotThrow(() => assertUnifiedExactRenderOutputAdmission({
		version: 14, deliveryProfile: 'encode-mov-prores-422-hq', format: { container: 'mov' },
		codecs: {
			video: 'prores', videoEncoder: 'prores_ks', audio: 'pcm_s16le',
			audioEncoder: 'pcm_s16le', pixelFormat: 'yuv422p10le',
		},
		output: {
			frameRate: { num: 30, den: 1 }, frameCount: 216_000,
			canvas: { width: 1_920, height: 1_080, pixelFormat: 'yuv422p10le' },
			includeAudio: true,
		},
	}));
});

test('V14 live carrier waits for every direct-sink acknowledgement and trailers its exact digest', async () => {
	const chunks: Uint8Array[] = [];
	let active = 0;
	let maximumActive = 0;
	const result = await streamFramescaperNativeRgbaFramePackV1({
		width: 2, height: 1, frameCount: 3, frameRate: { num: 30, den: 1 },
		signal: new AbortController().signal, assertCurrent() {},
		renderFrame(ordinal, output) { output.fill(ordinal + 1); },
	}, { async write(bytes) {
		active += 1; maximumActive = Math.max(maximumActive, active);
		await Promise.resolve(); chunks.push(new Uint8Array(bytes)); active -= 1;
	} });
	const body = new Uint8Array(chunks.reduce((sum, bytes) => sum + bytes.byteLength, 0));
	let offset = 0;
	for (const bytes of chunks) { body.set(bytes, offset); offset += bytes.byteLength; }
	assert.equal(maximumActive, 1);
	assert.equal(result.byteLength, body.byteLength);
	assert.equal(result.chunkCount, 7);
	assert.equal(result.sha256, bytesToHex(sha256(body)));
});
