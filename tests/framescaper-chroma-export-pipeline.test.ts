/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { createGlobalExportContextV1, renderGlobalExportFrameV1 } from './helpers/framescaper-global-export-fixture.ts';
import { createPinnedExportEncoderV1 } from './helpers/framescaper-pinned-export-encoder.ts';
import { createVideoExactPictureExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { encodeVideoKeyframeVideo } from '../src/common/editor/video-keyframe-video-encoder.ts';

test('production selected finishing and actual pinned picture encoder consume chroma recipe with declared composition/YUV phases',async()=>{
	const source = new Uint8Array([0,32,64,255,64,128,192,255,128,128,128,255,255,224,16,255]);
	const context = createGlobalExportContextV1([createVideoEffect('chroma-v1',{id:'saved-chroma',params:{saturation:-100,vibrance:73.25}})],2,2);
	const preEncode = [28,28,28,255,119,119,119,255,128,128,128,255,215,215,215,255];
	const frameSource = createVideoExactPictureExportFrameSource({sampleRate:48000,startFrame:0,endFrame:4800,
		canvas:{width:2,height:2,frameRate:{num:10,den:1},fit:'contain',backgroundColor:'#000000'}});
	const encoder = await createPinnedExportEncoderV1(); let produced=0,disposed=0;
	try {
		const result=await encodeVideoKeyframeVideo(encoder.editor,{frameSource,format:'mp4',signal:new AbortController().signal,
			producer:{width:2,height:2,byteLength:16, async produce(_frame,target){
				produced++; const output=await renderGlobalExportFrameV1(context,undefined,()=>({width:2,height:2,pixels:source.slice()}));
				assert.deepEqual(output.pixels,preEncode); assert.ok(output.consumedNodeIds.length>0); target.set(output.pixels);
			},dispose(){disposed++;}}});
		assert.equal(produced,1); assert.equal(disposed,1); assert.equal(encoder.streamsDisposed(),1); assert.equal(result.videoEncoder,'ffmpeg');
		assert.deepEqual(encoder.inputCopies,[preEncode]); assert.ok(encoder.calls[0]!.includes('libx264')); assert.ok(encoder.calls[0]!.includes('yuv420p'));
		// The existing selected linear UNORM8 roundtrip leaves these four gray goldens unchanged.
		// Decoded output equality is against identical declared lossy codec parameters, not straight RGBA.
		assert.deepEqual(encoder.decode(result.bytes),encoder.decode(encoder.referenceEncode(new Uint8Array(preEncode))));
		assert.deepEqual([...source],[0,32,64,255,64,128,192,255,128,128,128,255,255,224,16,255]);
	} finally {encoder.close();}
});
