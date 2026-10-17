/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { createGlobalExportContextV1, renderGlobalExportFrameV1 } from './helpers/framescaper-global-export-fixture.ts';
import { createPinnedExportEncoderV1 } from './helpers/framescaper-pinned-export-encoder.ts';
import { createVideoExactPictureExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { encodeVideoKeyframeVideo } from '../src/common/editor/video-keyframe-video-encoder.ts';

for (const reverse of [false, true]) test(`actual selected finishing→composition→picture encoder preserves curve order; reverse=${String(reverse)}`, async () => {
	const source = new Uint8Array([0,32,64,255,64,128,192,255,128,128,128,255,255,224,16,255]);
	const point = createVideoEffect('point-curves-v1', { id: 'point', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } });
	const parametric = createVideoEffect('parametric-curves-v1', { id: 'parametric', params: { masterShadows: 100 } });
	const effects = reverse ? [parametric, point] : [point, parametric], context = createGlobalExportContextV1(effects, 2, 2);
	// Literal effect goldens include the existing linear UNORM8 composition roundtrip:
	// 62→61, 63→64 and 32→34 are composition-only quantization, never a curve tolerance.
	const expected = reverse ? [255,191,175,255,175,127,64,255,127,127,127,255,0,28,223,255]
		: [255,223,191,255,191,127,79,255,127,127,127,255,0,61,239,255];
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
		// Same actual production arguments qualify lossy YUV/alpha removal; decoded video is not called RGBA-equal.
		assert.deepEqual(encoder.decode(result.bytes), encoder.decode(encoder.referenceEncode(new Uint8Array(expected))));
		assert.deepEqual([...source], [0,32,64,255,64,128,192,255,128,128,128,255,255,224,16,255]);
	} finally { encoder.close(); }
});
