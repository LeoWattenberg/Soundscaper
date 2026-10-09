/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { DEHAZE_PNG_BASE64, DEHAZE_SOURCE, DEHAZE_PARAMS, DEHAZE_PIXELS, DEHAZE_BINS, qualifyDehazeNativeV1 } from './browser/helpers/lightscaper-dehaze-reference.ts';
import { DEHAZE_SOURCE_V1, DEHAZE_GOLDENS_V1, dehazeReferenceV1 } from './helpers/video-dehaze-reference.ts';
import { withDehazePixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-dehaze-v1.ts';
import { withPhotoDevelopProxyV1 } from '../src/lightscaper/controller/photo-develop-proxy-v1.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

test('Dehaze native import fixture authenticates the literal two-row RGBA8 PNG',()=>{
	const png=Buffer.from(DEHAZE_PNG_BASE64,'base64'),parts:Buffer[]=[],types:string[]=[];
	assert.equal(png.byteLength,84);assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
	for(let offset=8;offset<png.length;){const length=png.readUInt32BE(offset),type=png.toString('ascii',offset+4,offset+8),body=png.subarray(offset+8,offset+8+length);
		assert.equal(crc32(png.subarray(offset+4,offset+8+length)),png.readUInt32BE(offset+8+length));types.push(type);
		if(type==='IHDR')assert.deepEqual([...body],[0,0,0,2,0,0,0,2,8,6,0,0,0]);if(type==='IDAT')parts.push(body);offset+=length+12;
	}
	assert.deepEqual(DEHAZE_SOURCE,DEHAZE_SOURCE_V1);assert.deepEqual(DEHAZE_PIXELS,DEHAZE_GOLDENS_V1[2][1]);
	assert.deepEqual(types,['IHDR','IDAT','IEND']);assert.deepEqual([...inflateSync(Buffer.concat(parts))],[0,...DEHAZE_SOURCE.slice(0,8),0,...DEHAZE_SOURCE.slice(8)]);
});

test('signed fractional literal and native alpha-spectrum oracles agree with independent BigInt dark-channel neighborhoods',async()=>{
	assert.deepEqual(dehazeReferenceV1(DEHAZE_SOURCE,2,DEHAZE_PARAMS.amount),DEHAZE_PIXELS);
	const source=Array.from({length:256},(_,n)=>[n,255-n,(n*17)%256,n]).flat(),pixels=new Uint8Array(source);
	for(const amount of [37.125,-37.125,-100,100]){
		const expected=dehazeReferenceV1(source,16,amount);let borrowed:Uint8Array|undefined;
		const actual=await withDehazePixelFrameV1({frame:{descriptor:{schemaVersion:1,width:16,height:16,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels},
			effect:{id:'alpha',type:'dehaze-v1',enabled:true,params:{amount}}},view=>{borrowed=view.pixels;return[...view.pixels];},
			{limits:{maximumSidePixels:16,maximumPixels:256,maximumBytes:1024}});
		assert.deepEqual(actual,expected);assert.deepEqual(actual.filter((_,n)=>n%4===3),Array.from({length:256},(_,n)=>n));
		assert.deepEqual(actual.slice(0,4),source.slice(0,4));assert.deepEqual([...pixels],source);assert.ok(borrowed?.every(n=>n===0));
	}
});

test('actual registered Photo proxy matches literal Dehaze pixels, every histogram bin and scoped output ownership',async()=>{
	const pixels=new Uint8Array(DEHAZE_SOURCE);let borrowed:Uint8Array|undefined;
	const output=await withPhotoDevelopProxyV1({frame:{descriptor:{schemaVersion:1,width:2,height:2,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels},
		develop:{...defaultPhotoDevelopV1(),effects:[createVideoEffect('dehaze-v1',{id:'native-reference',params:DEHAZE_PARAMS})]}},view=>{
		borrowed=view.frame.pixels;return{pixels:[...view.frame.pixels],histogram:view.histogram};
	});
	assert.deepEqual(output.pixels,DEHAZE_PIXELS);assert.deepEqual([...pixels],DEHAZE_SOURCE);assert.ok(borrowed?.every(n=>n===0));
	assert.equal(output.histogram.sampledPixels,4);assert.equal(output.histogram.transparentPixels,0);
	assert.equal(output.histogram.lowClippedPixels,0);assert.equal(output.histogram.highClippedPixels,0);
	for(const channel of ['red','green','blue']as const){const counts=new Array<number>(256).fill(0);
		for(const[bin,count]of DEHAZE_BINS[channel])counts[bin]=count;assert.deepEqual(output.histogram.bins[channel],counts);
	}
});

function crc32(bytes:Uint8Array):number{
	let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^(value&1?0xedb88320:0);}return(value^0xffffffff)>>>0;
}


test('native Dehaze capability refusal occurs before owning any fixture source allocation',async()=>{
	const previous=Object.getOwnPropertyDescriptor(globalThis,'WebGL2RenderingContext'),Native=Uint8Array;let allocations=0,checks=0,traps=0;
	const reason=new Proxy({}, {get(){traps++;throw Error();},getOwnPropertyDescriptor(){traps++;throw Error();},getPrototypeOf(){traps++;throw Error();}});
	Object.defineProperty(globalThis,'WebGL2RenderingContext',{configurable:true,get(){checks++;throw reason;}});
	globalThis.Uint8Array=new Proxy(Native,{construct(target,args){if(Array.isArray(args[0]))allocations++;return Reflect.construct(target,args);}});
	let result:Readonly<{failed:boolean;reason:unknown}>;
	try{result=await qualifyDehazeNativeV1({source:DEHAZE_SOURCE,height:2,params:DEHAZE_PARAMS,mode:'target'})
		.then(()=>({failed:false,reason:undefined}),error=>({failed:true,reason:error as unknown}));}
	finally{globalThis.Uint8Array=Native;if(previous)Object.defineProperty(globalThis,'WebGL2RenderingContext',previous);else Reflect.deleteProperty(globalThis,'WebGL2RenderingContext');}
	assert.equal(allocations,0);assert.equal(checks,1);assert.equal(result.failed,true);assert.equal(result.reason===reason,true);assert.equal(traps,0);
});

test('native Dehaze model creation refusal retires its already-owned source without reflecting the opaque reason',async()=>{
	const previous=Object.getOwnPropertyDescriptor(globalThis,'WebGL2RenderingContext'),Native=Uint8Array,clone=globalThis.structuredClone;
	let owned:Uint8Array|undefined,clones=0,traps=0,nativeCalls=0;
	const reason=new Proxy({}, {get(){traps++;throw Error();},getOwnPropertyDescriptor(){traps++;throw Error();},getPrototypeOf(){traps++;throw Error();}});
	Object.defineProperty(globalThis,'WebGL2RenderingContext',{configurable:true,value:{prototype:{readPixels(){nativeCalls++;throw Error('No native output is admitted.');}}}});
	globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const view=Reflect.construct(target,args)as Uint8Array;if(Array.isArray(args[0]))owned=view;return view;}});
	globalThis.structuredClone=()=>{clones++;throw reason;};
	let result:Readonly<{failed:boolean;reason:unknown}>;
	try{result=await qualifyDehazeNativeV1({source:DEHAZE_SOURCE,height:2,params:DEHAZE_PARAMS,mode:'target'})
		.then(()=>({failed:false,reason:undefined}),error=>({failed:true,reason:error as unknown}));}
	finally{globalThis.Uint8Array=Native;globalThis.structuredClone=clone;
		if(previous)Object.defineProperty(globalThis,'WebGL2RenderingContext',previous);else Reflect.deleteProperty(globalThis,'WebGL2RenderingContext');}
	assert.equal(result.failed,true);assert.equal(result.reason===reason,true);assert.equal(clones,1);assert.equal(traps,0);assert.equal(nativeCalls,0);
	assert.ok(owned);assert.ok(owned.every(byte=>byte===0));
});


test('the actual maintained Dehaze native entry closes over registered CPU and shader owners',async()=>{
	const specURL=new URL('./browser/lightscaper-develop-dehaze.spec.js',import.meta.url),spec=await readFile(specURL,'utf8');
	const entries=[...spec.matchAll(/new URL\('(\.\/helpers\/[^']+)'\s*,\s*import\.meta\.url\)/gu)];
	assert.equal(entries.length,1);assert.equal(entries[0]![1],'./helpers/lightscaper-dehaze-reference.ts');
	const helper=fileURLToPath(new URL(entries[0]![1]!,specURL));
	const result=await build({entryPoints:[helper],bundle:true,write:false,metafile:true,format:'esm',platform:'browser',logLevel:'silent'});
	const inputs=Object.keys(result.metafile.inputs);
	assert.ok(inputs.some(path=>path.endsWith('imaging/pixel-frame-dehaze-v1.ts')));
	assert.ok(inputs.some(path=>path.endsWith('ui/video-preview-dehaze-v1.ts')));
	assert.ok(result.outputFiles[0]!.text.includes('dehaze_render(content_uv)'));
});
