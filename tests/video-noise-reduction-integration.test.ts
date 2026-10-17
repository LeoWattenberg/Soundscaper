/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createVideoEffect, serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { appendVideoEffectOperation } from '../src/common/editor/video-effect-ffmpeg.ts';
import { noiseReductionReferenceV1 } from './helpers/video-noise-reduction-reference.ts';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';

interface Core { FS:{writeFile(name:string,bytes:Uint8Array):void;readFile(name:string):Uint8Array;unlink(name:string):void};
	exec(...args:string[]):number;reset():void;setLogger(listener:(entry:{message:string})=>void):void }
let core:Core;
test.before(async()=>{
	const require=createRequire(import.meta.url),previous=Object.getOwnPropertyDescriptor(globalThis,'self');
	Object.defineProperty(globalThis,'self',{configurable:true,value:{location:{href:'file:///ffmpeg-core.js'}}});
	try{const create=require('@ffmpeg/core')as(options:{wasmBinary:Uint8Array})=>Promise<Core>;core=await create({wasmBinary:await readFile(require.resolve('@ffmpeg/core/wasm'))});}
	finally{if(previous)Object.defineProperty(globalThis,'self',previous);else Reflect.deleteProperty(globalThis,'self');}
});
const defaults=Object.freeze({luminance:0,luminanceDetail:50,luminanceContrast:0,color:0,colorDetail:50,colorSmoothness:50});

test('shared recipe serialization and graph dispatch execute pinned noise GEQ with all alpha values and stage order',async()=>{
	const source=new Uint8Array(Array.from({length:256},(_,n)=>[n,255-n,(n*17)%256,n]).flat());
	const first={luminance:37.125,luminanceDetail:1.5,luminanceContrast:50,color:72.25,colorDetail:3.125,colorSmoothness:50};
	const second={luminance:100,luminanceDetail:0,luminanceContrast:0,color:100,colorDetail:0,colorSmoothness:100};
	for(const controls of [[first],[second],[first,second],[second,first]]){
		const effects=controls.map((params,n)=>createVideoEffect('noise-reduction-v1',{id:`noise_${String(n)}`,params}));
		let independent=[...source];for(const params of controls)independent=noiseReductionReferenceV1(independent,16,{...defaults,...params});
		const browser=await applyVideoExactBrowserEffectsFinishing({width:16,height:16,pixels:source},effects,new AbortController().signal);
		try{assert.deepEqual([...browser.pixels],independent);assert.deepEqual(execute(source,effects),independent);}
		finally{browser.pixels.fill(0);}
		assert.deepEqual(independent.filter((_,n)=>n%4===3),Array.from({length:256},(_,n)=>n));
		assert.deepEqual(independent.slice(0,4),[...source.slice(0,4)]);
	}
	assert.deepEqual([...source],Array.from({length:256},(_,n)=>[n,255-n,(n*17)%256,n]).flat());
});

test('shared noise creation closes every scalar and option even when disabled or neutral',()=>{
	for(const params of [{color:101},{luminance:NaN},{colorDetail:'10'},{future:1}])assert.throws(()=>createVideoEffect('noise-reduction-v1',{enabled:false,params}));
	let reads=0;const options=Object.defineProperty({},'params',{enumerable:true,get(){reads++;throw Error();}});
	assert.throws(()=>createVideoEffect('noise-reduction-v1',options));assert.equal(reads,0);
	for(const bad of [{future:1},{enabled:null},{index:-1},{index:0.5},{id:undefined},{type:'noise-reduction-v2'}])assert.throws(()=>createVideoEffect('noise-reduction-v1',bad));
	const disabled=createVideoEffect('noise-reduction-v1',{id:'disabled',enabled:false,params:{color:100}});
	assert.deepEqual(serializeVideoEffectsToFfmpegOperations([disabled,createVideoEffect('noise-reduction-v1')]),[]);
});

function execute(source:Uint8Array,effects:readonly unknown[]):number[]{
	const filters:string[]=[],logs:string[]=[];let label='0:v';
	for(const[n,operation]of serializeVideoEffectsToFfmpegOperations(effects).entries()){
		const next=`noise_${String(n)}`;appendVideoEffectOperation({filters,inputLabel:label,outputLabel:next,operation,width:16,height:16});label=next;
	}
	core.FS.writeFile('noise.rgba',source);core.setLogger(({message})=>{if(logs.length<64)logs.push(message);});
	try{core.reset();assert.equal(core.exec('-hide_banner','-f','rawvideo','-pixel_format','rgba','-video_size','16x16','-i','noise.rgba',
		'-filter_complex',filters.join(';'),'-map',`[${label}]`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','noise-out.rgba'),0,logs.join('\n'));
		const output=core.FS.readFile('noise-out.rgba');assert.equal(output.length,source.length);return[...output];
	}finally{core.reset();core.FS.unlink('noise.rgba');try{core.FS.unlink('noise-out.rgba');}catch{/* Refused output may be absent. */}}
}
