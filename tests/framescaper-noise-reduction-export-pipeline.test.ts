/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { createGlobalExportContextV1, renderGlobalExportFrameV1 } from './helpers/framescaper-global-export-fixture.ts';
import { createPinnedExportEncoderV1 } from './helpers/framescaper-pinned-export-encoder.ts';
import { createVideoExactPictureExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { encodeVideoKeyframeVideo } from '../src/common/editor/video-keyframe-video-encoder.ts';

test('selected finishing and picture export encode the persisted noise neighborhood with exact pre-encode bytes',async()=>{
	const original=[100,100,100,255,200,200,200,255,100,100,100,255,100,100,100,255],source=new Uint8Array(original);
	const effects=[createVideoEffect('noise-reduction-v1',{id:'noise',params:{luminance:100,luminanceDetail:0}})],context=createGlobalExportContextV1(effects,2,2);
	// Independent replicated binomial means119/156/106/119 become47/85/37/47
	// in linear UNORM8, then119/156/106/119 after the declared sRGB roundtrip.
	const preEncode=[119,119,119,255,156,156,156,255,106,106,106,255,119,119,119,255];
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
		assert.deepEqual(encoder.decode(result.bytes),encoder.decode(encoder.referenceEncode(new Uint8Array(preEncode))));
		assert.deepEqual([...source],original);
	}finally{encoder.close();}
});
