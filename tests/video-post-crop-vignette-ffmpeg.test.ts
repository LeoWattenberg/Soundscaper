/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createVideoEffect, serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { appendVideoEffectOperation } from '../src/common/editor/video-effect-ffmpeg.ts';
import { serializePostCropVignetteEffectToFfmpegV1 } from '../src/common/editor/video-post-crop-vignette-v1.ts';
import { appendPostCropVignetteFfmpegOperationV1 } from '../src/common/editor/video-post-crop-vignette-ffmpeg-v1.ts';
import { POST_CROP_VIGNETTE_GLSL_V1 } from '../src/common/editor/ui/video-preview-post-crop-vignette-v1.ts';
import { withPostCropVignettePixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-post-crop-vignette-v1.ts';

interface Core {FS:{writeFile(name:string,bytes:Uint8Array):void;readFile(name:string):Uint8Array;unlink(name:string):void};exec(...args:string[]):number;reset():void;setLogger(callback:(entry:{message:string})=>void):void}
let core:Core;
test.before(async()=>{
	const require=createRequire(import.meta.url),previous=Object.getOwnPropertyDescriptor(globalThis,'self');
	Object.defineProperty(globalThis,'self',{configurable:true,value:{location:{href:'file:///ffmpeg-core.js'}}});
	try {const create=require('@ffmpeg/core') as (options:{wasmBinary:Uint8Array})=>Promise<Core>;core=await create({wasmBinary:await readFile(require.resolve('@ffmpeg/core/wasm'))});}
	finally {if(previous)Object.defineProperty(globalThis,'self',previous);else Reflect.deleteProperty(globalThis,'self');}
});
const effect=(params:unknown)=>({id:'post-crop',type:'post-crop-vignette-v1',enabled:true,params});

test('actual pinned GEQ produces independent literal3x3 corner/center bytes with original partial alpha',()=>{
	const source=new Uint8Array(Array.from({length:9},()=>[128,64,255,127]).flat());
	assert.deepEqual(execute(source,3,{amount:-100}),[16,8,31,127,128,64,255,127,16,8,31,127,
		128,64,255,127,128,64,255,127,128,64,255,127,16,8,31,127,128,64,255,127,16,8,31,127]);
});

test('actual pinned GEQ and CPU agree with independent BigInt spatial reference and all256 alpha bytes',async()=>{
	const source=new Uint8Array(Array.from({length:256},(_,n)=>[n,255-n,(n*17)%256,n]).flat());
	for(const params of [{amount:-37.125,midpoint:13.25,roundness:-50,feather:77.5,highlights:62.5},
		{amount:100,midpoint:0,roundness:100,feather:0,highlights:100},{amount:-100,midpoint:100,roundness:0,feather:0,highlights:0}]){
		const expected=reference(source,16,params),actual=execute(source,16,params);assert.deepEqual(actual,expected);
		const cpu=await withPostCropVignettePixelFrameV1({frame:{descriptor:{schemaVersion:1,width:16,height:16,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels:source},effect:effect(params)},view=>[...view.pixels],{limits:{maximumSidePixels:16,maximumPixels:256,maximumBytes:1024}});
		assert.deepEqual(cpu,expected);assert.deepEqual(actual.filter((_,n)=>n%4===3),Array.from({length:256},(_,n)=>n));assert.deepEqual(actual.slice(0,4),[...source.slice(0,4)]);
	}
});

test('integer GLSL transport and branded export reject copied recipes and preserve ten-register GEQ bounds',()=>{
	assert.match(POST_CROP_VIGNETTE_GLSL_V1,/int distance=/u);assert.match(POST_CROP_VIGNETTE_GLSL_V1,/post_crop_floor\(2\*\(2\*position\+1-size\)\*256/u);
	assert.match(POST_CROP_VIGNETTE_GLSL_V1,/min\(131072,cx\*cx\+cy\*cy\)/u);assert.doesNotMatch(POST_CROP_VIGNETTE_GLSL_V1,/float (?:weight|distance|coverage)/u);
	const operation=serializePostCropVignetteEffectToFfmpegV1(effect({amount:-50}));assert.ok(operation);assert.ok(Object.isFrozen(operation));
	const registers=[...operation.expression.matchAll(/(?:st|ld)\((\d+)/gu)].map(match=>Number(match[1]));assert.equal(Math.max(...registers),9);
	assert.equal(operation.expression.length<8192,true);assert.equal(serializePostCropVignetteEffectToFfmpegV1(effect({amount:0})),null);
	assert.throws(()=>appendPostCropVignetteFfmpegOperationV1({filters:[],inputLabel:'0:v',outputLabel:'safe',operation:{...operation}}));
});

test('owning registry dispatch composes repeated natural vignette and inverted curve without alpha or label drift',()=>{
	const pixels=new Uint8Array(Array.from({length:9},()=>[128,64,255,127]).flat());
	const vignette=createVideoEffect('post-crop-vignette-v1',{id:'v',params:{amount:-100}}),invert=createVideoEffect('point-curves-v1',{id:'curve',params:{master:[{x:0,y:1},{x:1,y:0}]}});
	// Corners retain31/256 after each vignette:239→29,247→30,224→27.
	const corner=[29,30,27,127],center=[127,191,0,127];
	assert.deepEqual(execute(pixels,3,{},[vignette,invert,{...vignette,id:'second'}]),[corner,center,corner,center,center,center,corner,center,corner].flat());
});

function execute(source:Uint8Array,width:number,params:unknown,effects?:readonly unknown[]):number[] {
	const operation=serializePostCropVignetteEffectToFfmpegV1(effect(params));if(!effects)assert.ok(operation);const filters:string[]=[],logs:string[]=[];
	let label='post_crop';
	if(effects){label='0:v';for(const[n,op]of serializeVideoEffectsToFfmpegOperations(effects).entries()){const next=`vignette_${String(n)}`;appendVideoEffectOperation({filters,inputLabel:label,outputLabel:next,operation:op,width,height:source.length/(4*width)});label=next;}}
	else appendPostCropVignetteFfmpegOperationV1({filters,inputLabel:'0:v',outputLabel:label,operation});
	core.FS.writeFile('vignette.rgba',source);core.setLogger(({message})=>{if(logs.length<64)logs.push(message);});
	try {core.reset();assert.equal(core.exec('-hide_banner','-f','rawvideo','-pixel_format','rgba','-video_size',`${String(width)}x${String(source.length/(4*width))}`,'-i','vignette.rgba',
		'-filter_complex',filters.join(';'),'-map',`[${label}]`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','vignette-out.rgba'),0,logs.join('\n'));
		const output=core.FS.readFile('vignette-out.rgba');assert.equal(output.length,source.length);return [...output];
	}finally{core.reset();core.FS.unlink('vignette.rgba');try{core.FS.unlink('vignette-out.rgba');}catch{/* Refused output may not exist. */}}
}

/** A separate BigInt recipe: source lookup never calls production preparation,
 * coverage or byte evaluation. Plane alpha is copied literally. */
function reference(source:Uint8Array,width:number,p:{amount:number;midpoint:number;roundness:number;feather:number;highlights:number}):number[] {
	const height=source.length/(4*width),gain=BigInt(Math.round(p.amount*256/100)),r=BigInt(Math.abs(Math.round(p.roundness*256/100)));
	const midpoint=BigInt(Math.round(p.midpoint*65536/100)),feather=BigInt(Math.max(1,Math.round(p.feather*65536/100))),highlights=BigInt(Math.round(p.highlights*256/100));
	const floor=(a:bigint,b:bigint)=>a<0n?-((-a+b-1n)/b):a/b,clamp=(n:bigint,min:bigint,max:bigint)=>n<min?min:n>max?max:n;
	return [...source].map((byte,offset)=>{
		const channel=offset%4,pixel=Math.floor(offset/4);if(channel===3||source[pixel*4+3]===0)return byte;
		const x=pixel%width,y=Math.floor(pixel/width),q=(position:number,size:number,denominator:number)=>floor(2n*BigInt(2*position+1-size)*256n+BigInt(denominator),2n*BigInt(denominator));
		const rx=q(x,width,width),ry=q(y,height,height),ellipse=rx*rx+ry*ry,square=rx*rx>ry*ry?rx*rx:ry*ry,side=Math.min(width,height);
		const cx=clamp(q(x,width,side),-512n,512n),cy=clamp(q(y,height,side),-512n,512n),circle=clamp(cx*cx+cy*cy,0n,131072n);
		const distance=(ellipse*(256n-r)+(p.roundness<0?square:circle)*r+128n)/256n,t=clamp(floor((distance-midpoint)*256n,feather),0n,256n);
		const weight=(t*t*(768n-2n*t)+32768n)/65536n,maximum=BigInt(Math.max(source[pixel*4]!,source[pixel*4+1]!,source[pixel*4+2]!));
		const protection=gain<0n?(maximum*highlights+127n)/255n:0n,coverage=(weight*(256n-protection)+128n)/256n,target=gain<0n?0n:255n;
		return Number(clamp(BigInt(byte)+floor((target-BigInt(byte))*(gain<0n?-gain:gain)*coverage+32768n,65536n),0n,255n));
	});
}
