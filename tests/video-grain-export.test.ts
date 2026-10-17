/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createVideoEffect, serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { appendVideoEffectOperation } from '../src/common/editor/video-effect-ffmpeg.ts';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { grainReferenceV1 } from './helpers/video-grain-reference.ts';

interface Core { FS:{writeFile(name:string,bytes:Uint8Array):void;readFile(name:string):Uint8Array;unlink(name:string):void};
	exec(...args:string[]):number;reset():void;setLogger(listener:(entry:{message:string})=>void):void }
let core:Core;
test.before(async()=>{
	const require=createRequire(import.meta.url),previous=Object.getOwnPropertyDescriptor(globalThis,'self');
	Object.defineProperty(globalThis,'self',{configurable:true,value:{location:{href:'file:///ffmpeg-core.js'}}});
	try{const create=require('@ffmpeg/core')as(options:{wasmBinary:Uint8Array})=>Promise<Core>;core=await create({wasmBinary:await readFile(require.resolve('@ffmpeg/core/wasm'))});}
	finally{if(previous)Object.defineProperty(globalThis,'self',previous);else Reflect.deleteProperty(globalThis,'self');}
});

test('registered Grain export dispatcher matches BigInt CPU goldens through all alpha, repeated stages and an ordered invert curve',async()=>{
	const source=new Uint8Array(Array.from({length:256},(_,n)=>[n,255-n,n%2?250:8,n]).flat());
	const first={amount:100,size:1,roughness:100,seed:65520},second={amount:37.125,size:2.25,roughness:49.8,seed:7};
	for(const controls of [[first],[second],[first,second],[second,first]]){
		const effects=controls.map((params,n)=>createVideoEffect('grain-v1',{id:`grain_${String(n)}`,params}));
		let independent=[...source];for(const params of controls)independent=grainReferenceV1(independent,16,params);
		const rendered=await applyVideoExactBrowserEffectsFinishing({width:16,height:16,pixels:source},effects,new AbortController().signal);
		try{assert.deepEqual([...rendered.pixels],independent);assert.deepEqual(execute(source,effects),independent);}finally{rendered.pixels.fill(0);}
		assert.deepEqual(independent.filter((_,n)=>n%4===3),Array.from({length:256},(_,n)=>n));assert.deepEqual(independent.slice(0,4),[...source.slice(0,4)]);
	}
	const invert=createVideoEffect('point-curves-v1',{id:'invert',params:{master:[{x:0,y:1},{x:1,y:0}]}});
	const beforeCurve=grainReferenceV1([...source],16,first),inverted=beforeCurve.map((byte,n)=>n%4===3?byte:255-byte);
	const effects=[createVideoEffect('grain-v1',{id:'before',params:first}),invert,createVideoEffect('grain-v1',{id:'after',params:second})];
	const expected=grainReferenceV1(inverted,16,second),rendered=await applyVideoExactBrowserEffectsFinishing({width:16,height:16,pixels:source},effects,new AbortController().signal);
	try{assert.deepEqual([...rendered.pixels],expected);assert.deepEqual(execute(source,effects),expected);}finally{rendered.pixels.fill(0);}
	assert.deepEqual([...source],Array.from({length:256},(_,n)=>[n,255-n,n%2?250:8,n]).flat());
});

function execute(source:Uint8Array,effects:readonly unknown[]):number[]{
	const filters:string[]=[],logs:string[]=[];let label='0:v';
	for(const[n,operation]of serializeVideoEffectsToFfmpegOperations(effects).entries()){
		const next=`grain_${String(n)}`;appendVideoEffectOperation({filters,inputLabel:label,outputLabel:next,operation,width:16,height:16});label=next;
	}
	core.FS.writeFile('registered-grain.rgba',source);core.setLogger(({message})=>{if(logs.length<64)logs.push(message);});
	try{core.reset();assert.equal(core.exec('-hide_banner','-f','rawvideo','-pixel_format','rgba','-video_size','16x16','-i','registered-grain.rgba',
		'-filter_complex',filters.join(';'),'-map',`[${label}]`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','registered-grain-out.rgba'),0,logs.join('\n'));
		const output=core.FS.readFile('registered-grain-out.rgba');assert.equal(output.length,source.length);return[...output];
	}finally{core.reset();core.FS.unlink('registered-grain.rgba');try{core.FS.unlink('registered-grain-out.rgba');}catch{/* Refused output may be absent. */}}
}
