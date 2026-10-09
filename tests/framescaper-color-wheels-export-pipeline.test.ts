/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { createGlobalExportContextV1, renderGlobalExportFrameV1 } from './helpers/framescaper-global-export-fixture.ts';
import { createPinnedExportEncoderV1 } from './helpers/framescaper-pinned-export-encoder.ts';
import { createVideoExactPictureExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { encodeVideoKeyframeVideo } from '../src/common/editor/video-keyframe-video-encoder.ts';

test('actual selected wheel finishing→composition→picture encoder preserves literal new-process bytes', async () => {
	const source = new Uint8Array([0,0,0,255,128,128,128,255,255,255,255,255,64,64,64,255]);
	const effects = [createVideoEffect('color-wheels-v1', { id: 'wheel', params: { highlightsLuminance: 100 } })];
	const context = createGlobalExportContextV1(effects, 2, 2), expected = [0,0,0,255,176,176,176,255,255,255,255,255,90,90,90,255];
	const frameSource = createVideoExactPictureExportFrameSource({ sampleRate: 48000, startFrame: 0, endFrame: 4800,
		canvas: { width: 2, height: 2, frameRate: { num: 10, den: 1 }, fit: 'contain', backgroundColor: '#000000' } });
	const encoder = await createPinnedExportEncoderV1(); let produced = 0, disposed = 0;
	try {
		const result = await encodeVideoKeyframeVideo(encoder.editor, { frameSource, format: 'mp4', signal: new AbortController().signal,
			producer: { width: 2, height: 2, byteLength: 16, async produce(_frame, target) {
				produced++; const output = await renderGlobalExportFrameV1(context, undefined, () => ({ width: 2, height: 2, pixels: source.slice() }));
				assert.deepEqual(output.pixels, expected); assert.ok(output.consumedNodeIds.length > 0); target.set(output.pixels);
			}, dispose() { disposed++; } } });
		assert.equal(produced, 1); assert.equal(disposed, 1); assert.equal(encoder.streamsDisposed(), 1);
		assert.equal(result.videoEncoder, 'ffmpeg'); assert.deepEqual(encoder.inputCopies, [expected]);
		assert.ok(encoder.calls[0]!.includes('libx264')); assert.ok(encoder.calls[0]!.includes('yuv420p'));
		// Lossy YUV/H264 decoding is compared with the same production encoder;
		// it is separate from the exact authored RGBA process above.
		assert.deepEqual(encoder.decode(result.bytes), encoder.decode(encoder.referenceEncode(new Uint8Array(expected))));
		assert.deepEqual([...source], [0,0,0,255,128,128,128,255,255,255,255,255,64,64,64,255]);
	} finally { encoder.close(); }
});
