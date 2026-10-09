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
	const require=createRequire(import.meta.url), previous=Object.getOwnPropertyDescriptor(globalThis,'self');
	Object.defineProperty(globalThis,'self',{configurable:true,value:{location:{href:'file:///ffmpeg-core.js'}}});
	try {const create=require('@ffmpeg/core') as (options:{wasmBinary:Uint8Array})=>Promise<Core>;core=await create({wasmBinary:await readFile(require.resolve('@ffmpeg/core/wasm'))});}
	finally {if(previous)Object.defineProperty(globalThis,'self',previous);else Reflect.deleteProperty(globalThis,'self');}
});

test('actual pinned WASM generated chroma graph retains independent RGB goldens and alpha',()=>{
	const source=new Uint8Array([0,32,64,0,64,128,192,1,128,128,128,127,255,224,16,255]);
	assert.deepEqual(execute(source,[createVideoEffect('chroma-v1',{params:{saturation:-100}})]),[28,28,28,0,119,119,119,1,128,128,128,127,215,215,215,255]);
	assert.deepEqual(execute(source,[createVideoEffect('chroma-v1',{params:{saturation:100}})]),[0,36,100,0,9,137,255,1,128,128,128,127,255,233,0,255]);
});

test('actual pinned WASM graph exactly matches bounded CPU over all256 mixed RGB/alpha and ordered chroma/global operations',async()=>{
	const source=new Uint8Array(Array.from({length:256},(_,n)=>[n,(n*17)%256,255-n,[0,1,127,255][n%4]!]).flat());
	for(const effects of [[createVideoEffect('chroma-v1',{params:{saturation:12.5,vibrance:-37.125}})],
		[createVideoEffect('chroma-v1',{params:{vibrance:73.25,saturation:-33.3}})],
		[createVideoEffect('white-balance-v1',{params:{temperature:73}}),createVideoEffect('chroma-v1',{params:{vibrance:100}})],
		[createVideoEffect('chroma-v1',{params:{vibrance:100}}),createVideoEffect('white-balance-v1',{params:{temperature:73}})]]){
		const expected=await withGlobalDevelopPixelFrameV1({frame:{descriptor:{schemaVersion:1,width:256,height:1,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels:source},effects},
			view=>[...view.pixels],{limits:{maximumSidePixels:256,maximumPixels:256,maximumBytes:1024}});
		assert.deepEqual(execute(source,effects),expected,JSON.stringify(effects));
	}
});

test('pinned WASM preserves all256 alpha values through chroma and both global/chroma orders',async()=>{
	const source=new Uint8Array(Array.from({length:256},(_,n)=>[n,(17*n)%256,255-n,n]).flat());
	const chroma=()=>createVideoEffect('chroma-v1',{params:{saturation:33.3,vibrance:-37.125}});
	const white=()=>createVideoEffect('white-balance-v1',{params:{temperature:73}});
	for(const effects of [[chroma()],[white(),chroma()],[chroma(),white()]]){
		const expected=await withGlobalDevelopPixelFrameV1({frame:{descriptor:{schemaVersion:1,width:256,height:1,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels:source},effects},
			view=>[...view.pixels],{limits:{maximumSidePixels:256,maximumPixels:256,maximumBytes:1024}});
		assert.deepEqual(execute(source,effects),expected,JSON.stringify(effects));
		for(let n=0;n<256;n++)assert.equal(expected[n*4+3],n);
	}
});

function execute(source:Uint8Array,effects:readonly unknown[]):number[]{
	const filters:string[]=[];let label='0:v';const logs:string[]=[];
	for(const [i,operation]of serializeVideoEffectsToFfmpegOperations(effects).entries()){
		const next=`chroma_${String(i)}`;appendVideoEffectOperation({filters,inputLabel:label,outputLabel:next,operation,width:source.length/4,height:1});label=next;
	}
	core.FS.writeFile('chroma.rgba',source);core.setLogger(({message})=>{if(logs.length<64)logs.push(message);});
	try{core.reset();assert.equal(core.exec('-hide_banner','-f','rawvideo','-pixel_format','rgba','-video_size',`${String(source.length/4)}x1`,'-i','chroma.rgba',
		'-filter_complex',filters.join(';'),'-map',`[${label}]`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','out.rgba'),0,logs.join('\n'));
		const output=core.FS.readFile('out.rgba');assert.equal(output.length,source.length);return [...output];}
	finally{core.reset();core.FS.unlink('chroma.rgba');try{core.FS.unlink('out.rgba');}catch{/* Refused native output may be absent. */}}
}
