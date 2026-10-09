/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { createGlobalExportContextV1, renderGlobalExportFrameV1 } from './helpers/framescaper-global-export-fixture.ts';
import { createPinnedExportEncoderV1 } from './helpers/framescaper-pinned-export-encoder.ts';
import { createVideoExactPictureExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { encodeVideoKeyframeVideo } from '../src/common/editor/video-keyframe-video-encoder.ts';
import { grainReferenceV1 } from './helpers/video-grain-reference.ts';

test('selected Frame finishing and actual picture encoder preserve deterministic Grain pre-encode bytes',async()=>{
	const original=Array.from({length:4},()=>[128,128,128,255]).flat(),source=new Uint8Array(original);
	const params={amount:100,size:2,roughness:0,seed:7},effects=[createVideoEffect('grain-v1',{id:'grain',params})],context=createGlobalExportContextV1(effects,2,2);
	// Independent seeded lattice gives124/128/124/118. These four encoded bytes
	// survive this declared linear-UNORM8 compositing roundtrip exactly.
	const preEncode=[124,128,124,118].flatMap(value=>[value,value,value,255]);assert.deepEqual(grainReferenceV1(original,2,params),preEncode);
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
		assert.deepEqual(encoder.decode(result.bytes),encoder.decode(encoder.referenceEncode(new Uint8Array(preEncode))));assert.deepEqual([...source],original);
	}finally{encoder.close();}
});
