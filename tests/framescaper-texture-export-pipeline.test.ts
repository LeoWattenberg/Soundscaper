/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { createGlobalExportContextV1, renderGlobalExportFrameV1 } from './helpers/framescaper-global-export-fixture.ts';
import { createPinnedExportEncoderV1 } from './helpers/framescaper-pinned-export-encoder.ts';
import { createVideoExactPictureExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { encodeVideoKeyframeVideo } from '../src/common/editor/video-keyframe-video-encoder.ts';
import { serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { appendVideoEffectOperation } from '../src/common/editor/video-effect-ffmpeg.ts';
import { textureReferenceV1 } from './browser/helpers/lightscaper-texture-reference.ts';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

test('selected finishing and picture export encode the persisted texture neighborhood with exact pre-encode bytes',async()=>{
	const original=[64,64,64,255,128,128,128,255,192,192,192,255,128,128,128,255],source=new Uint8Array(original);
	const effects=[createVideoEffect('texture-v1',{id:'texture',params:{amount:100}})],context=createGlobalExportContextV1(effects,2,2);
	// Independent Texture bytes62/127/194/128 become linear UNORM8
	//12/54/138/55, then encoded61/127/194/128 before the declared YUV codec.
	const preEncode=[61,61,61,255,127,127,127,255,194,194,194,255,128,128,128,255];
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

test('owning graph dispatcher executes consecutive Texture and an intervening curve with exact original-alpha planes',async()=>{
	const original=Array.from({length:256},(_,n)=>[n,255-n,(n*17)%256,n]).flat(),source=new Uint8Array(original);
	const first=createVideoEffect('texture-v1',{id:'first',params:{amount:73.25}}),second=createVideoEffect('texture-v1',{id:'second',params:{amount:-50}});
	const invert=createVideoEffect('point-curves-v1',{id:'invert',params:{master:[{x:0,y:1},{x:1,y:0}]}});
	const core=await createCore();
	for(const effects of [[first,second],[first,invert,second],[invert,first]]){
		let expected=[...original];for(const effect of effects)expected=effect===first||effect===second
			?textureReferenceV1(expected,16,effect===first?73.25:-50):expected.map((n,offset)=>offset%4===3?n:255-n);
		const filters:string[]=[];let label='0:v';
		for(const[n,operation]of serializeVideoEffectsToFfmpegOperations(effects).entries()){
			const next=`texture_${String(n)}`;appendVideoEffectOperation({filters,inputLabel:label,outputLabel:next,operation,width:16,height:16});label=next;
		}
		const output=await applyVideoExactBrowserEffectsFinishing({width:16,height:16,pixels:source},effects,new AbortController().signal);
		try{assert.deepEqual([...output.pixels],expected);assert.deepEqual(execute(core,source,filters,label),expected);}
		finally{output.pixels.fill(0);}
		assert.deepEqual(expected.filter((_,n)=>n%4===3),Array.from({length:256},(_,n)=>n));
	}
	assert.deepEqual([...source],original);
});

interface Core{FS:{writeFile(name:string,bytes:Uint8Array):void;readFile(name:string):Uint8Array;unlink(name:string):void};exec(...args:string[]):number;reset():void;setLogger(listener:(entry:{message:string})=>void):void}
async function createCore():Promise<Core>{
	const require=createRequire(import.meta.url),previous=Object.getOwnPropertyDescriptor(globalThis,'self');
	Object.defineProperty(globalThis,'self',{configurable:true,value:{location:{href:'file:///ffmpeg-core.js'}}});
	try{const create=require('@ffmpeg/core')as(options:{wasmBinary:Uint8Array})=>Promise<Core>;return await create({wasmBinary:await readFile(require.resolve('@ffmpeg/core/wasm'))});}
	finally{if(previous)Object.defineProperty(globalThis,'self',previous);else Reflect.deleteProperty(globalThis,'self');}
}
function execute(core:Core,source:Uint8Array,filters:readonly string[],label:string):number[]{
	const logs:string[]=[];core.FS.writeFile('texture.rgba',source);core.setLogger(({message})=>{if(logs.length<64)logs.push(message);});
	try{core.reset();assert.equal(core.exec('-hide_banner','-f','rawvideo','-pixel_format','rgba','-video_size','16x16','-i','texture.rgba',
		'-filter_complex',filters.join(';'),'-map',`[${label}]`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','texture-out.rgba'),0,logs.join('\n'));
		const bytes=core.FS.readFile('texture-out.rgba');assert.equal(bytes.length,source.length);return[...bytes];
	}finally{core.reset();core.FS.unlink('texture.rgba');try{core.FS.unlink('texture-out.rgba');}catch{/* A refused output may not exist. */}}
}
