/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createVideoEffect, serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { appendVideoEffectOperation } from '../src/common/editor/video-effect-ffmpeg.ts';
import { withGlobalDevelopPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-global-develop-v1.ts';

interface Core { FS:{writeFile(name:string,bytes:Uint8Array):void;readFile(name:string):Uint8Array;unlink(name:string):void}; exec(...args:string[]):number;reset():void;setLogger(listener:(entry:{message:string})=>void):void }
let core:Core;
test.before(async()=>{
	const require=createRequire(import.meta.url),previous=Object.getOwnPropertyDescriptor(globalThis,'self');
	Object.defineProperty(globalThis,'self',{configurable:true,value:{location:{href:'file:///ffmpeg-core.js'}}});
	try{const create=require('@ffmpeg/core') as (options:{wasmBinary:Uint8Array})=>Promise<Core>;core=await create({wasmBinary:await readFile(require.resolve('@ffmpeg/core/wasm'))});}
	finally{if(previous)Object.defineProperty(globalThis,'self',previous);else Reflect.deleteProperty(globalThis,'self');}
});

test('actual pinned WASM generated monochrome graph retains independent baseline/hue/negative-half goldens and alpha',()=>{
	const source=new Uint8Array([254,0,0,0,254,127,0,1,0,254,0,127,0,0,254,255]);
	assert.deepEqual(execute(source,[createVideoEffect('black-white-mix-v1')]),[54,54,54,0,144,144,144,1,182,182,182,127,19,19,19,255]);
	assert.deepEqual(execute(source,[createVideoEffect('black-white-mix-v1',{params:{orange:-25}})]),[54,54,54,0,81,81,81,1,182,182,182,127,19,19,19,255]);
	const gray=new Uint8Array(Array.from({length:256},(_,n)=>[n,n,n,n]).flat());
	const rendered=execute(gray,[createVideoEffect('black-white-mix-v1',{params:{red:100,orange:100,yellow:100,green:100,aqua:100,blue:100,purple:100,magenta:100}})]);
	assert.deepEqual(rendered,[...gray],JSON.stringify(rendered.flatMap((value,i)=>value===gray[i]?[]:[{offset:i,expected:gray[i],actual:value}])));
});

test('actual pinned WASM matches all256 multichannel pixels and ordered authored monochrome/global/chroma stacks',async()=>{
	const source=new Uint8Array(Array.from({length:256},(_,n)=>[n,(17*n)%256,255-n,[0,1,127,255][n%4]!]).flat());
	const mono=()=>createVideoEffect('black-white-mix-v1',{params:{red:12.5,orange:-37.125,yellow:33.3,green:-73.25,aqua:50,blue:100,purple:-100,magenta:25}});
	for(const effects of [[mono()],[createVideoEffect('white-balance-v1',{params:{temperature:73}}),mono()],
		[mono(),createVideoEffect('white-balance-v1',{params:{temperature:73}})],
		[createVideoEffect('chroma-v1',{params:{vibrance:100,saturation:33.3}}),mono()]]){
		const expected=await withGlobalDevelopPixelFrameV1({frame:{descriptor:{schemaVersion:1,width:256,height:1,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels:source},effects},
			view=>[...view.pixels],{limits:{maximumSidePixels:256,maximumPixels:256,maximumBytes:1024}});
		assert.deepEqual(execute(source,effects),expected,JSON.stringify(effects));
	}
});

test('pinned WASM preserves all256 alpha bytes through authored monochrome/global/chroma order',async()=>{
	const source=new Uint8Array(Array.from({length:256},(_,n)=>[n,(17*n)%256,255-n,n]).flat());
	const mono=()=>createVideoEffect('black-white-mix-v1',{params:{red:12.5,orange:-37.125,yellow:33.3,green:-73.25,aqua:50,blue:100,purple:-100,magenta:25}});
	const white=()=>createVideoEffect('white-balance-v1',{params:{temperature:73}}),tone=()=>createVideoEffect('tone-ladder-v1',{params:{exposure:0.37}});
	const chroma=()=>createVideoEffect('chroma-v1',{params:{vibrance:100,saturation:33.3}});
	for(const effects of [[mono()],[white(),mono()],[mono(),white()],[chroma(),mono()],[mono(),chroma()],[white(),tone(),chroma(),mono()]]){
		const expected=await withGlobalDevelopPixelFrameV1({frame:{descriptor:{schemaVersion:1,width:256,height:1,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels:source},effects},
			view=>[...view.pixels],{limits:{maximumSidePixels:256,maximumPixels:256,maximumBytes:1024}});
		assert.deepEqual(execute(source,effects),expected,JSON.stringify(effects));
		for(let n=0;n<256;n++)assert.equal(expected[n*4+3],n);
	}
});

function execute(source:Uint8Array,effects:readonly unknown[]):number[]{
	const filters:string[]=[];let label='0:v';const logs:string[]=[];
	for(const [i,operation]of serializeVideoEffectsToFfmpegOperations(effects).entries()){
		const next=`mono_${String(i)}`;appendVideoEffectOperation({filters,inputLabel:label,outputLabel:next,operation,width:source.length/4,height:1});label=next;
	}
	core.FS.writeFile('mono.rgba',source);core.setLogger(({message})=>{if(logs.length<64)logs.push(message);});
	try{core.reset();assert.equal(core.exec('-hide_banner','-f','rawvideo','-pixel_format','rgba','-video_size',`${String(source.length/4)}x1`,'-i','mono.rgba',
		'-filter_complex',filters.join(';'),'-map',`[${label}]`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','out.rgba'),0,logs.join('\n'));
		const output=core.FS.readFile('out.rgba');assert.equal(output.length,source.length);return [...output];}
	finally{core.reset();core.FS.unlink('mono.rgba');try{core.FS.unlink('out.rgba');}catch{/* Refused native output may be absent. */}}
}
