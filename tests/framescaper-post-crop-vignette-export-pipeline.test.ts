/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { createGlobalExportContextV1, renderGlobalExportFrameV1 } from './helpers/framescaper-global-export-fixture.ts';
import { createPinnedExportEncoderV1 } from './helpers/framescaper-pinned-export-encoder.ts';
import { createVideoExactPictureExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { encodeVideoKeyframeVideo } from '../src/common/editor/video-keyframe-video-encoder.ts';

test('actual selected finishing→composition→picture encoder consumes the persisted natural-output vignette recipe with exact pre-encode bytes',async()=>{
	const source=new Uint8Array([40,80,120,255,100,140,180,255,160,200,240,255,220,60,20,255]);
	const effects=[createVideoEffect('post-crop-vignette-v1',{id:'vignette',params:{amount:-100,midpoint:0,feather:100}})];
	const context=createGlobalExportContextV1(effects,2,2);
	// Every2x2 center has ellipse radius1/2, smooth coverage128/256.
	// Literal half-gain bytes are20/40/60,50/70/90,80/100/120,110/30/10.
	// Existing linear UNORM8 composition quantizes those to this declared output.
	const preEncode=[22,38,61,255,50,71,90,255,79,99,120,255,110,28,13,255];
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
