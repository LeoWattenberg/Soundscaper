/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { createGlobalExportContextV1, renderGlobalExportFrameV1 } from './helpers/framescaper-global-export-fixture.ts';
import { createPinnedExportEncoderV1 } from './helpers/framescaper-pinned-export-encoder.ts';
import { createVideoExactPictureExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { encodeVideoKeyframeVideo } from '../src/common/editor/video-keyframe-video-encoder.ts';

test('production selected finishing and pinned picture encoder preserve ordered HSL/tone with declared composition/YUV phases',async()=>{
	const source=new Uint8Array([255,0,0,255,0,0,0,255,128,128,128,255,0,0,255,255]);
	const effects=[createVideoEffect('hsl-mixer-v1',{id:'saved-hsl',params:{redHue:60,orangeHue:60,yellowHue:60,greenHue:60,aquaHue:60,blueHue:60,purpleHue:60,magentaHue:60}}),createVideoEffect('tone-ladder-v1',{id:'saved-tone',params:{exposure:-1}})];
	const context=createGlobalExportContextV1(effects,2,2),preEncode=[188,188,0,255,0,0,0,255,92,92,92,255,188,0,188,255];
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
		// Existing linear UNORM8 composition retains these exact primary-channel values. Decode
		// compares identical declared lossy/alpha-free codec parameters, not RGBA.
		assert.deepEqual(encoder.decode(result.bytes),encoder.decode(encoder.referenceEncode(new Uint8Array(preEncode))));
		assert.deepEqual([...source],[255,0,0,255,0,0,0,255,128,128,128,255,0,0,255,255]);
	}finally{encoder.close();}
});
