/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { createGlobalExportContextV1, renderGlobalExportFrameV1 } from './helpers/framescaper-global-export-fixture.ts';
import { createPinnedExportEncoderV1 } from './helpers/framescaper-pinned-export-encoder.ts';
import { createVideoExactPictureExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { encodeVideoKeyframeVideo } from '../src/common/editor/video-keyframe-video-encoder.ts';

test('production selected finishing applies captured authored globals before straight sRGB composition', async () => {
	const source = new Uint8Array([0,32,64,255,64,128,192,255,128,128,128,255,255,224,16,255]);
	const effects = [createVideoEffect('white-balance-v1', { id: 'wb', params: { temperature: 100 } }),
		createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: -1 } })];
	const context = createGlobalExportContextV1(effects, 2, 2);
	const result = await renderGlobalExportFrameV1(context, undefined, () => ({ width: 2, height: 2, pixels: source.slice() }));
	const effected = [0,20,29,255,64,92,101,255,128,92,65,255,188,164,5,255];
	const direct = await applyVideoExactBrowserEffectsFinishing({ width: 2, height: 2, pixels: source }, effects, new AbortController().signal);
	assert.deepEqual(Array.from(direct.pixels), effected);
	// Existing selected finishing quantizes the managed linear frame to UNORM8,
	// then composes in premultiplied linear space and encodes straight sRGB.
	const composed = [0,22,28,255,64,92,101,255,128,92,64,255,188,164,0,255];
	assert.deepEqual(effected.map((value, index) => index % 4 === 3 ? value : linearRoundtrip(value)), composed);
	assert.deepEqual(result.pixels, composed);
	assert.ok(result.consumedNodeIds.length > 0);
	assert.deepEqual(Array.from(source), [0,32,64,255,64,128,192,255,128,128,128,255,255,224,16,255]);
});

test('production picture encoder consumes selected finishing pixels and decodes identically to the declared YUV/H264 reference', async () => {
	const source = new Uint8Array([0,32,64,255,64,128,192,255,128,128,128,255,255,224,16,255]);
	const context = createGlobalExportContextV1([createVideoEffect('white-balance-v1', { id: 'wb', params: { temperature: 100 } }),
		createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: -1 } })], 2, 2);
	const frameSource = createVideoExactPictureExportFrameSource({ sampleRate: 48000, startFrame: 0, endFrame: 4800,
		canvas: { width: 2, height: 2, frameRate: { num: 10, den: 1 }, fit: 'contain', backgroundColor: '#000000' } });
	const preEncode = [0,22,28,255,64,92,101,255,128,92,64,255,188,164,0,255];
	const encoder = await createPinnedExportEncoderV1(); let produced = 0, disposed = 0;
	try {
		const result = await encodeVideoKeyframeVideo(encoder.editor, { frameSource, format: 'mp4', signal: new AbortController().signal,
			producer: { width: 2, height: 2, byteLength: 16,
				async produce(frame, target) {
					assert.equal(frame.index, 0); produced++;
					const rendered = await renderGlobalExportFrameV1(context, undefined, () => ({ width: 2, height: 2, pixels: source.slice() }));
					assert.deepEqual(rendered.pixels, preEncode); target.set(rendered.pixels);
				},
				dispose() { disposed++; },
			},
		});
		assert.equal(result.videoEncoder, 'ffmpeg'); assert.equal(result.format, 'mp4');
		assert.equal(result.frameCount, 1); assert.equal(result.rgbaChunkCount, 1); assert.ok(result.byteLength > 16);
		assert.equal(produced, 1); assert.equal(disposed, 1); assert.equal(encoder.streamsDisposed(), 1);
		assert.deepEqual(encoder.inputCopies, [preEncode]);
		assert.ok(encoder.calls[0]!.includes('libx264')); assert.ok(encoder.calls[0]!.includes('yuv420p'));
		// H264/YUV420 is intentionally lossy and alpha-free. Compare actual decoded
		// production output to an independent literal pre-encode frame through the
		// exact same observed encoder parameters, rather than treating it as RGBA.
		const decoded = encoder.decode(result.bytes), reference = encoder.referenceEncode(new Uint8Array(preEncode));
		assert.deepEqual(decoded, encoder.decode(reference)); assert.equal(decoded.length, 16);
		assert.ok(decoded.every((value, index) => index % 4 !== 3 || value === 255));
		assert.notDeepEqual(decoded, preEncode);
	} finally { encoder.close(); }
});

function linearRoundtrip(byte: number): number {
	const v = byte / 255, linear = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	const quantized = Math.round(linear * 255) / 255;
	return Math.round((quantized <= 0.0031308 ? quantized * 12.92 : 1.055 * quantized ** (1 / 2.4) - 0.055) * 255);
}
