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

const COLORS=['red','orange','yellow','green','aqua','blue','purple','magenta'];
const all=(suffix:string,value:number)=>Object.fromEntries(COLORS.map(color=>[`${color}${suffix}`,value]));

test('actual pinned WASM HSL preserves independently stated hue, clipping and signed-half byte goldens',()=>{
	const source=new Uint8Array([254,0,0,0,254,127,0,1,0,254,0,127,0,0,254,255]);
	assert.deepEqual(execute(source,[createVideoEffect('hsl-mixer-v1',{params:all('Hue',60)})]),[254,254,0,0,127,254,0,1,0,254,254,127,254,0,254,255]);
	assert.deepEqual(execute(new Uint8Array([255,0,0,127]),[createVideoEffect('hsl-mixer-v1',{params:{redHue:73.25,redSaturation:-37.125,redLuminance:33.3}})]),[200,224,117,127]);
	assert.deepEqual(execute(new Uint8Array([255,0,0,1]),[createVideoEffect('hsl-mixer-v1',{params:{redLuminance:-50}})]),[128,0,0,1]);
	assert.deepEqual(execute(new Uint8Array([64,128,192,127]),[createVideoEffect('hsl-mixer-v1',{params:all('Luminance',-50)})]),[32,64,97,127]);
});

test('pinned WASM matches all256 mixed RGB/alpha through fractional HSL and both authored orders',async()=>{
	const source=new Uint8Array(Array.from({length:256},(_,n)=>[n,(17*n)%256,255-n,n]).flat());
	const hsl=()=>createVideoEffect('hsl-mixer-v1',{params:{redHue:73.25,redSaturation:-37.125,redLuminance:33.3,blueHue:-37.125,blueSaturation:100,blueLuminance:-73.25,orangeHue:-180,magentaHue:180}});
	const white=()=>createVideoEffect('white-balance-v1',{params:{temperature:73}}),tone=()=>createVideoEffect('tone-ladder-v1',{params:{exposure:0.37}});
	const chroma=()=>createVideoEffect('chroma-v1',{params:{vibrance:100,saturation:33.3}}),mono=()=>createVideoEffect('black-white-mix-v1',{params:{red:12.5,blue:-37.125}});
	for(const effects of [[hsl()],[white(),hsl()],[hsl(),white()],[chroma(),hsl()],[hsl(),chroma()],[mono(),hsl()],[hsl(),mono()],[white(),tone(),chroma(),hsl(),mono()]]){
		const expected=await withGlobalDevelopPixelFrameV1({frame:{descriptor:{schemaVersion:1,width:256,height:1,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels:source},effects},
			view=>[...view.pixels],{limits:{maximumSidePixels:256,maximumPixels:256,maximumBytes:1024}});
		assert.deepEqual(execute(source,effects),expected,JSON.stringify(effects));
		for(let n=0;n<256;n++)assert.equal(expected[n*4+3],n);
	}
});

function execute(source:Uint8Array,effects:readonly unknown[]):number[]{
	const filters:string[]=[];let label='0:v';const logs:string[]=[];
	for(const [i,operation]of serializeVideoEffectsToFfmpegOperations(effects).entries()){
		const next=`hsl_${String(i)}`;appendVideoEffectOperation({filters,inputLabel:label,outputLabel:next,operation,width:source.length/4,height:1});label=next;
	}
	core.FS.writeFile('hsl.rgba',source);core.setLogger(({message})=>{if(logs.length<64)logs.push(message);});
	try{core.reset();assert.equal(core.exec('-hide_banner','-f','rawvideo','-pixel_format','rgba','-video_size',`${String(source.length/4)}x1`,'-i','hsl.rgba',
		'-filter_complex',filters.join(';'),'-map',`[${label}]`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','out.rgba'),0,logs.join('\n'));
		const output=core.FS.readFile('out.rgba');assert.equal(output.length,source.length);return [...output];}
	finally{core.reset();core.FS.unlink('hsl.rgba');try{core.FS.unlink('out.rgba');}catch{/* Refused native output may be absent. */}}
}
