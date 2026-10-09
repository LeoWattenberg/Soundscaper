/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
	decodeFramescaperBrowserNativeImageV1 as decode,
	type FramescaperBrowserNativeImageDecodeSessionV1,
} from '../src/common/editor/timeline-image-native-decode-v1.ts';
import { ordinaryHighPrecisionPng } from './helpers/framescaper-ordinary-high-precision-image-fixture.ts';
import { ordinaryFramescaperImage } from './helpers/framescaper-ordinary-animation-fixture.ts';
import { createPngFixture } from './helpers/png-fixture.mjs';

test('native image composition refuses normal high-precision PNG before quantizing it', async () => {
	let opened = false;
	const bytes = ordinaryHighPrecisionPng();
	assert.equal(bytes[24], 16);
	await assert.rejects(() => decode({ bytes, fileName: 'gradient.png', mimeTypeHint: 'image/png',
		open: async () => { opened = true; return session(1); } }), /high.precision|16.bit/iu);
	assert.equal(opened, false);
});

for (const animated of [false, true]) test(`ordinary 8-bit ${animated ? 'animation' : 'still'} retains its native route and original`, async () => {
	const bytes = animated ? ordinaryFramescaperImage('animated.png') : createPngFixture(16);
	assert.equal(bytes[24], 8);
	let closed = 0;
	const result = await decode({ bytes, fileName: 'ordinary.png', mimeTypeHint: 'image/png',
		open: async () => ({ ...session(animated ? 10 : 1), close() { closed += 1; } }) });
	assert.equal(result.publication.frameCount, animated ? 10 : 1);
	assert.equal(result.publication.durationTicks, '5000000');
	assert.equal(result.publication.timingMode, animated ? 'embedded' : 'fallback');
	assert.equal(result.publication.originalByteLength, bytes.byteLength);
	assert.equal(result.publication.originalSha256, createHash('sha256').update(bytes).digest('hex'));
	assert.equal(closed, 1);
});

function session(frameCount: number): FramescaperBrowserNativeImageDecodeSessionV1 {
	return { metadata: { width: 1, height: 1, frameCount,
		topology: frameCount === 1 ? 'single' : 'animated', runtimeVersion: 'ordinary-test-1' },
		async decodeFrame() { return { rgba: Uint8Array.of(39, 39, 40, 255),
			durationMicroseconds: frameCount === 1 ? null : 500_000 }; }, close() {} };
}
