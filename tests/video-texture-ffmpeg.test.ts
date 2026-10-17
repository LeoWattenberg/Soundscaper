/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { serializeTextureEffectToFfmpegV1 } from '../src/common/editor/video-texture-v1.ts';
import { appendTextureFfmpegOperationV1 } from '../src/common/editor/video-texture-ffmpeg-v1.ts';
import { withTexturePixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-texture-v1.ts';
import { createVideoEffect, serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { appendVideoEffectOperation } from '../src/common/editor/video-effect-ffmpeg.ts';

interface Core{FS:{writeFile(name:string,bytes:Uint8Array):void;readFile(name:string):Uint8Array;unlink(name:string):void};exec(...args:string[]):number;reset():void;setLogger(listener:(entry:{message:string})=>void):void}
let core:Core;
test.before(async()=>{
	const require=createRequire(import.meta.url),previous=Object.getOwnPropertyDescriptor(globalThis,'self');
	Object.defineProperty(globalThis,'self',{configurable:true,value:{location:{href:'file:///ffmpeg-core.js'}}});
	try{const create=require('@ffmpeg/core')as(options:{wasmBinary:Uint8Array})=>Promise<Core>;core=await create({wasmBinary:await readFile(require.resolve('@ffmpeg/core/wasm'))});}
	finally{if(previous)Object.defineProperty(globalThis,'self',previous);else Reflect.deleteProperty(globalThis,'self');}
});
const effect=(amount=100)=>({id:'texture',type:'texture-v1',enabled:true,params:{amount}});
type Stage=Readonly<{texture:number}>|Readonly<{legacy:unknown}>;

test('pinned Texture GEQ preserves independently literal signed and fractional medium-detail bytes',()=>{
	const source=new Uint8Array([64,128,192].flatMap(n=>[n,n,n,255]));
	for(const [amount,expected]of [[100,[59,128,197]],[-100,[69,128,187]],[50,[62,128,195]]]as const)
		assert.deepEqual(execute(source,3,[{texture:amount}]),expected.flatMap(n=>[n,n,n,255]));
	const medium=new Uint8Array(Array.from({length:4},()=>[96,128,160,128]).flat().flatMap(n=>[n,n,n,127]));
	assert.deepEqual(execute(medium,16,[{texture:37.125}]).slice(16,32),[94,128,162,128].flatMap(n=>[n,n,n,127]));
});

test('pinned Texture graph preserves all256 alpha and independent BigInt dual neighborhoods through original-alpha transport',async()=>{
	const source=new Uint8Array(Array.from({length:256},(_,n)=>[n,255-n,(n*17)%256,n]).flat());
	for(const amount of [-100,-50,37.125,100,0]){
		const expected=reference(source,16,amount),actual=execute(source,16,[{texture:amount}]);assert.deepEqual(actual,expected);
		const cpu=await withTexturePixelFrameV1({frame:{descriptor:{schemaVersion:1,width:16,height:16,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels:source},effect:effect(amount)},
			view=>[...view.pixels],{limits:{maximumSidePixels:16,maximumPixels:256,maximumBytes:1024}});
		assert.deepEqual(cpu,expected);assert.deepEqual(actual.filter((_,n)=>n%4===3),Array.from({length:256},(_,n)=>n));
	}
	const hidden=new Uint8Array([255,0,255,0,64,128,192,1,0,255,0,0]);assert.deepEqual(execute(hidden,3,[{texture:100}]),[...hidden]);
});

test('two Texture phases and an owning curve compose exact scoped labels; copied compiled operations refuse before graph mutation',()=>{
	const source=new Uint8Array(Array.from({length:256},(_,n)=>[n,255-n,(n*17)%256,n]).flat()),first=reference(source,16,37.125);
	assert.deepEqual(execute(source,16,[{texture:37.125},{texture:-50}]),reference(new Uint8Array(first),16,-50));
	const invert=createVideoEffect('point-curves-v1',{params:{master:[{x:0,y:1},{x:1,y:0}]}});
	const inverted=first.map((n,i)=>i%4===3?n:255-n);
	assert.deepEqual(execute(source,16,[{texture:37.125},{legacy:invert},{texture:-50}]),reference(new Uint8Array(inverted),16,-50));
	const operation=serializeTextureEffectToFfmpegV1(effect());assert.ok(operation);const filters:string[]=[];
	const registers=[...operation.expression.matchAll(/(?:st|ld)\((\d+)/gu)].map(match=>Number(match[1]));assert.equal(Math.max(...registers),7);
	for(const bad of [{...operation},null,{kind:'texture-v1',expression:'unsafe',preserveAlpha:true}])
		assert.throws(()=>appendTextureFfmpegOperationV1({filters,inputLabel:'in',outputLabel:'out',operation:bad}));
	assert.deepEqual(filters,[]);assert.match(operation.expression,/interpolation=nearest/u);assert.ok(operation.expression.length<32768);
});

function execute(source:Uint8Array,width:number,stages:readonly Stage[]):number[]{
	const filters:string[]=[],logs:string[]=[];let label='0:v',ordinal=0;
	for(const stage of stages){
		if('texture'in stage){const operation=serializeTextureEffectToFfmpegV1(effect(stage.texture));if(!operation)continue;
			const next=`texture_${String(ordinal++)}`;appendTextureFfmpegOperationV1({filters,inputLabel:label,outputLabel:next,operation});label=next;
		}else for(const operation of serializeVideoEffectsToFfmpegOperations([stage.legacy])){
			const next=`texture_${String(ordinal++)}`;appendVideoEffectOperation({filters,inputLabel:label,outputLabel:next,operation,width,height:source.length/(4*width)});label=next;
		}
	}
	core.FS.writeFile('texture.rgba',source);core.setLogger(({message})=>{if(logs.length<64)logs.push(message);});
	try{core.reset();const graph=filters.length?['-filter_complex',filters.join(';'),'-map',`[${label}]`]:[];
		assert.equal(core.exec('-hide_banner','-f','rawvideo','-pixel_format','rgba','-video_size',`${String(width)}x${String(source.length/(4*width))}`,'-i','texture.rgba',
			...graph,'-frames:v','1','-f','rawvideo','-pix_fmt','rgba','texture-out.rgba'),0,logs.join('\n'));
		const output=core.FS.readFile('texture-out.rgba');assert.equal(output.length,source.length);return[...output];
	}finally{core.reset();core.FS.unlink('texture.rgba');try{core.FS.unlink('texture-out.rgba');}catch{/* A refused output may not exist. */}}
}

/** Independent two-neighborhood BigInt model. Preparation quantization is
 * exactly the process-specified JavaScript Math.round, not rational rounding. */
function reference(source:Uint8Array,width:number,amount:number):number[]{
	const height=source.length/(4*width),gain=BigInt(Math.round(amount*256/100));
	const luma=(n:number)=>(54n*BigInt(source[n]!)+183n*BigInt(source[n+1]!)+19n*BigInt(source[n+2]!)+128n)/256n;
	return [...source].map((byte,offset)=>{
		const channel=offset%4,pixel=Math.floor(offset/4);if(channel===3||source[pixel*4+3]===0)return byte;
		const x=pixel%width,y=Math.floor(pixel/width),mean=(bins:readonly bigint[])=>{
			let sum=0n,weight=0n;const radius=Math.floor(bins.length/2);
			for(let row=0;row<bins.length;row++)for(let column=0;column<bins.length;column++){
				const n=4*(Math.min(height-1,Math.max(0,y+row-radius))*width+Math.min(width-1,Math.max(0,x+column-radius)));
				const w=bins[row]!*bins[column]!*BigInt(source[n+3]!);weight+=w;sum+=w*luma(n);
			}return(2n*sum+weight)/(2n*weight);
		};
		const fine=mean([1n,2n,1n]),coarse=mean([1n,4n,6n,4n,1n]),difference=luma(pixel*4)-coarse;
		const response=256n-4n*(difference<0n?-difference:difference),gate=response<0n?0n:response;
		const n=(fine-coarse)*gain*gate+32768n,delta=n<0n?-((-n+65535n)/65536n):n/65536n;
		const result=BigInt(byte)+delta;return Number(result<0n?0n:result>255n?255n:result);
	});
}
