/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { createGlobalExportContextV1, renderGlobalExportFrameV1 } from './helpers/framescaper-global-export-fixture.ts';
import { createPinnedExportEncoderV1 } from './helpers/framescaper-pinned-export-encoder.ts';
import { createVideoExactPictureExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { encodeVideoKeyframeVideo } from '../src/common/editor/video-keyframe-video-encoder.ts';

test('actual selected finishing→composition→picture encoder consumes the persisted neighborhood recipe with exact pre-encode bytes',async()=>{
	const source=new Uint8Array([40,80,120,255,100,140,180,255,160,200,240,255,220,60,20,255]);
	const effects=[createVideoEffect('detail-sharpen-v1',{id:'detail',params:{amount:100,threshold:0}})];
	const context=createGlobalExportContextV1(effects,2,2);
	// The independently weighted blur gives raw RGB [0,47,92;85,162,217;175,252,255;255,17,0].
	// The existing linear UNORM8 composition roundtrip maps47→46 and17→13.
	const preEncode=[0,46,92,255,85,162,217,255,175,252,255,255,255,13,0,255];
	const frameSource=createVideoExactPictureExportFrameSource({sampleRate:48000,startFrame:0,endFrame:4800,
		canvas:{width:2,height:2,frameRate:{num:10,den:1},fit:'contain',backgroundColor:'#000000'}});
	const encoder=await createPinnedExportEncoderV1();let produced=0,disposed=0;
	try{
		const result=await encodeVideoKeyframeVideo(encoder.editor,{frameSource,format:'mp4',signal:new AbortController().signal,
			producer:{width:2,height:2,byteLength:16,async produce(_frame,target){
				produced++;const output=await renderGlobalExportFrameV1(context,undefined,()=>({width:2,height:2,pixels:source.slice()}));
				assert.deepEqual(output.pixels,preEncode);assert.ok(output.consumedNodeIds.length>0);target.set(output.pixels);
			},dispose(){disposed++;}}});
		assert.equal(produced,1);assert.equal(disposed,1);assert.equal(encoder.streamsDisposed(),1);assert.equal(result.videoEncoder,'ffmpeg');
		assert.deepEqual(encoder.inputCopies,[preEncode]);assert.ok(encoder.calls[0]!.includes('libx264'));assert.ok(encoder.calls[0]!.includes('yuv420p'));
		// Identical actual codec arguments compare lossy YUV/alpha removal; decoded H264 is never called RGBA-equal.
		assert.deepEqual(encoder.decode(result.bytes),encoder.decode(encoder.referenceEncode(new Uint8Array(preEncode))));
		assert.deepEqual([...source],[40,80,120,255,100,140,180,255,160,200,240,255,220,60,20,255]);
	}finally{encoder.close();}
});
