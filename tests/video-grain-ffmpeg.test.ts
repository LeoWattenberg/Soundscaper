/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { serializeGrainEffectToFfmpegV1 } from '../src/common/editor/video-grain-v1.ts';
import { appendGrainFfmpegOperationV1 } from '../src/common/editor/video-grain-ffmpeg-v1.ts';
import { GRAIN_GLSL_V1 } from '../src/common/editor/ui/video-preview-grain-v1.ts';
import { withGrainPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-grain-v1.ts';

interface Core{FS:{writeFile(name:string,bytes:Uint8Array):void;readFile(name:string):Uint8Array;unlink(name:string):void};exec(...args:string[]):number;reset():void;setLogger(callback:(entry:{message:string})=>void):void}
let core:Core;
test.before(async()=>{
	const require=createRequire(import.meta.url),previous=Object.getOwnPropertyDescriptor(globalThis,'self');
	Object.defineProperty(globalThis,'self',{configurable:true,value:{location:{href:'file:///ffmpeg-core.js'}}});
	try{const create=require('@ffmpeg/core') as (options:{wasmBinary:Uint8Array})=>Promise<Core>;core=await create({wasmBinary:await readFile(require.resolve('@ffmpeg/core/wasm'))});}
	finally{if(previous)Object.defineProperty(globalThis,'self',previous);else Reflect.deleteProperty(globalThis,'self');}
});
const effect=(params:unknown)=>({id:'grain',type:'grain-v1',enabled:true,params});

test('pinned GEQ matches literal deterministic coarse/fine gray samples and preserves partial alpha',()=>{
	const source=new Uint8Array(Array.from({length:8},()=>[128,128,128,127]).flat());
	for(const [params,bytes] of [
		[{amount:100,size:1,roughness:50,seed:0},[128,120,111,138,120,124,132,124]],
		[{amount:100,size:2,roughness:0,seed:7},[124,128,128,123,125,134,140,142]],
		[{amount:100,size:2,roughness:100,seed:7},[123,119,124,139,132,124,131,131]],
		[{amount:100,size:8,roughness:75,seed:65520},[130,131,131,132,134,137,140,143]],
	] as const)assert.deepEqual(execute(source,8,[params]),bytes.flatMap(n=>[n,n,n,127]));
});

test('pinned GEQ and scoped CPU match independent BigInt noise/envelope for all256 alpha and gamut boundaries',async()=>{
	const source=new Uint8Array(Array.from({length:256},(_,n)=>[n,255-n,n%2?250:8,n]).flat());
	for(const params of [{amount:100,size:1,roughness:100,seed:65520},{amount:37.125,size:2.25,roughness:49.8,seed:7},{amount:100,size:8,roughness:0,seed:19}]){
		const expected=reference(source,16,params),actual=execute(source,16,[params]);assert.deepEqual(actual,expected);
		const cpu=await withGrainPixelFrameV1({frame:{descriptor:{schemaVersion:1,width:16,height:16,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels:source},effect:effect(params)},
			view=>[...view.pixels],{limits:{maximumSidePixels:16,maximumPixels:256,maximumBytes:1024}});
		assert.deepEqual(cpu,expected);assert.deepEqual(actual.filter((_,n)=>n%4===3),Array.from({length:256},(_,n)=>n));assert.deepEqual(actual.slice(0,4),[...source.slice(0,4)]);
	}
	const first={amount:100,size:1,roughness:50,seed:0},second={amount:62.5,size:4,roughness:100,seed:65520};
	assert.deepEqual(execute(source,16,[first,second]),reference(new Uint8Array(reference(source,16,first)),16,second));
});

test('shader centers/hash stay highp unsigned and bounded compiled GEQ cannot be copied or caller-forged',()=>{
	assert.match(GRAIN_GLSL_V1,/highp uint grain_hash/u);assert.match(GRAIN_GLSL_V1,/h\*h\+31u\*h\+17u/u);
	assert.match(GRAIN_GLSL_V1,/\(\(2u\*center\+uvec2\(1u\)\)\*32768u\)\/size/u);
	assert.doesNotMatch(GRAIN_GLSL_V1,/float (?:noise|delta|hash|sum|luma)/u);
	const operation=serializeGrainEffectToFfmpegV1(effect({amount:100}));assert.ok(operation);assert.ok(Object.isFrozen(operation));
	const registers=[...operation.expression.matchAll(/(?:st|ld)\((\d+)/gu)].map(match=>Number(match[1]));assert.equal(Math.max(...registers),9);assert.ok(operation.expression.length<16384);
	const filters:string[]=[];
	assert.throws(()=>appendGrainFfmpegOperationV1({filters,inputLabel:'0:v',outputLabel:'grain',operation:{...operation}}));assert.equal(filters.length,0);
	appendGrainFfmpegOperationV1({filters,inputLabel:'0:v',outputLabel:'grain',operation});assert.equal(filters.length,7);
	assert.match(filters[2]!,/alphaextract/u);assert.match(filters[6]!,/\[grain_output_a\]alphamerge/u);
});

function execute(source:Uint8Array,width:number,stages:readonly unknown[]):number[]{
	const filters:string[]=[],logs:string[]=[];let label='0:v';
	for(const [index,params]of stages.entries()){
		const operation=serializeGrainEffectToFfmpegV1(effect(params));assert.ok(operation);const next=`grain_${String(index)}`;
		appendGrainFfmpegOperationV1({filters,inputLabel:label,outputLabel:next,operation});label=next;
	}
	core.FS.writeFile('grain.rgba',source);core.setLogger(({message})=>{if(logs.length<64)logs.push(message);});
	try{core.reset();assert.equal(core.exec('-hide_banner','-f','rawvideo','-pixel_format','rgba','-video_size',`${String(width)}x${String(source.length/(4*width))}`,'-i','grain.rgba',
		'-filter_complex',filters.join(';'),'-map',`[${label}]`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','grain-out.rgba'),0,logs.join('\n'));
		const output=core.FS.readFile('grain-out.rgba');assert.equal(output.length,source.length);return [...output];
	}finally{core.reset();core.FS.unlink('grain.rgba');try{core.FS.unlink('grain-out.rgba');}catch{/* Refused output may not exist. */}}
}

/** Independent integer model: no owning preparation or production scalar is
 * called. Original alpha, luma response and clamped common RGB are explicit. */
function reference(source:Uint8Array,width:number,p:{amount:number;size:number;roughness:number;seed:number}):number[]{
	const size=BigInt(Math.round(p.size*256)),rough=BigInt(Math.round(p.roughness*256/100)),amount=BigInt(Math.round(p.amount*256/100));
	const floor=(n:bigint,d:bigint)=>n<0n?-((-n+d-1n)/d):n/d;
	const sample=(x:bigint,y:bigint)=>{let h=(x*73n+y*151n+BigInt(p.seed)*199n+101n)%65521n;h=(h*h+31n*h+17n)%65521n;
		const first=h%257n;h=(h*h+31n*h+17n)%65521n;return floor(first+h%257n-255n,2n);};
	const octave=(x:number,y:number,s:bigint)=>{
		const qx=BigInt(2*x+1)*32768n/s,qy=BigInt(2*y+1)*32768n/s,ix=qx/256n,iy=qy/256n,fx=qx%256n,fy=qy%256n;
		return floor(sample(ix,iy)*(256n-fx)*(256n-fy)+sample(ix+1n,iy)*fx*(256n-fy)+sample(ix,iy+1n)*(256n-fx)*fy+sample(ix+1n,iy+1n)*fx*fy+32768n,65536n);
	};
	return [...source].map((byte,index)=>{
		const channel=index%4,start=index-channel,pixel=start/4;if(channel===3||source[start+3]===0)return byte;
		const x=pixel%width,y=Math.floor(pixel/width),noise=floor(octave(x,y,size)*(256n-rough)+octave(x,y,size/2n)*rough+128n,256n);
		const luma=(54n*BigInt(source[start]!)+183n*BigInt(source[start+1]!)+19n*BigInt(source[start+2]!)+128n)/256n,response=2n*(luma<255n-luma?luma:255n-luma);
		const next=BigInt(byte)+floor(noise*amount*response+131072n,262144n);return Number(next<0n?0n:next>255n?255n:next);
	});
}
