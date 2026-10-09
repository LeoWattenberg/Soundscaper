/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { GRAIN_PNG_BASE64, GRAIN_SOURCE, GRAIN_PARAMS, GRAIN_PIXELS, GRAIN_BINS, qualifyGrainNativeV1 } from './browser/helpers/lightscaper-grain-reference.ts';
import { grainReferenceV1 } from './helpers/video-grain-reference.ts';
import { withGrainPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-grain-v1.ts';
import { withPhotoDevelopProxyV1 } from '../src/lightscaper/controller/photo-develop-proxy-v1.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

test('Grain native import fixture authenticates the literal two-row RGBA8 PNG',()=>{
	const png=Buffer.from(GRAIN_PNG_BASE64,'base64'),parts:Buffer[]=[],types:string[]=[];
	assert.equal(png.byteLength,84);assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
	for(let offset=8;offset<png.length;){const length=png.readUInt32BE(offset),type=png.toString('ascii',offset+4,offset+8),body=png.subarray(offset+8,offset+8+length);
		assert.equal(crc32(png.subarray(offset+4,offset+8+length)),png.readUInt32BE(offset+8+length));types.push(type);
		if(type==='IHDR')assert.deepEqual([...body],[0,0,0,2,0,0,0,2,8,6,0,0,0]);if(type==='IDAT')parts.push(body);offset+=length+12;
	}
	assert.deepEqual(types,['IHDR','IDAT','IEND']);assert.deepEqual([...inflateSync(Buffer.concat(parts))],[0,...GRAIN_SOURCE.slice(0,8),0,...GRAIN_SOURCE.slice(8)]);
});

test('all-four-control literal and native alpha-spectrum oracles agree with independent BigInt neighborhoods',async()=>{
	assert.deepEqual(grainReferenceV1(GRAIN_SOURCE,2,GRAIN_PARAMS),GRAIN_PIXELS);
	const source=Array.from({length:256},(_,n)=>[n,255-n,(n*17)%256,n]).flat();
	const expected=grainReferenceV1(source,16,GRAIN_PARAMS),pixels=new Uint8Array(source);
	let borrowed:Uint8Array|undefined;
	const actual=await withGrainPixelFrameV1({frame:{descriptor:{schemaVersion:1,width:16,height:16,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels},
		effect:{id:'alpha',type:'grain-v1',enabled:true,params:GRAIN_PARAMS}},view=>{borrowed=view.pixels;return[...view.pixels];},
		{limits:{maximumSidePixels:16,maximumPixels:256,maximumBytes:1024}});
	assert.deepEqual(actual,expected);assert.deepEqual(actual.filter((_,n)=>n%4===3),Array.from({length:256},(_,n)=>n));
	assert.deepEqual(actual.slice(0,4),source.slice(0,4));assert.deepEqual([...pixels],source);assert.ok(borrowed?.every(n=>n===0));
});

test('actual registered Photo proxy matches literal Grain pixels, every histogram bin and scoped output ownership',async()=>{
	const pixels=new Uint8Array(GRAIN_SOURCE);let borrowed:Uint8Array|undefined;
	const output=await withPhotoDevelopProxyV1({frame:{descriptor:{schemaVersion:1,width:2,height:2,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels},
		develop:{...defaultPhotoDevelopV1(),effects:[createVideoEffect('grain-v1',{id:'native-reference',params:GRAIN_PARAMS})]}},view=>{
		borrowed=view.frame.pixels;return{pixels:[...view.frame.pixels],histogram:view.histogram};
	});
	assert.deepEqual(output.pixels,GRAIN_PIXELS);assert.deepEqual([...pixels],GRAIN_SOURCE);assert.ok(borrowed?.every(n=>n===0));
	assert.equal(output.histogram.sampledPixels,4);assert.equal(output.histogram.transparentPixels,0);
	assert.equal(output.histogram.lowClippedPixels,1);assert.equal(output.histogram.highClippedPixels,0);
	for(const channel of ['red','green','blue']as const){const counts=new Array<number>(256).fill(0);
		for(const[bin,count]of GRAIN_BINS[channel])counts[bin]=count;assert.deepEqual(output.histogram.bins[channel],counts);
	}
});

function crc32(bytes:Uint8Array):number{
	let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^(value&1?0xedb88320:0);}return(value^0xffffffff)>>>0;
}

test('native Grain fixture joins an opaque model creation refusal and wipes its already-owned source',async()=>{
	const previous=Object.getOwnPropertyDescriptor(globalThis,'WebGL2RenderingContext'),Native=Uint8Array,clone=globalThis.structuredClone;
	let owned:Uint8Array|undefined,clones=0,traps=0;
	const reason=new Proxy({}, {get(){traps++;throw Error();},getOwnPropertyDescriptor(){traps++;throw Error();},getPrototypeOf(){traps++;throw Error();}});
	Object.defineProperty(globalThis,'WebGL2RenderingContext',{configurable:true,value:{prototype:{readPixels(){throw Error('No native work is admitted.');}}}});
	globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const view=Reflect.construct(target,args)as Uint8Array;if(Array.isArray(args[0]))owned=view;return view;}});
	globalThis.structuredClone=()=>{clones++;throw reason;};
	let result:Readonly<{failed:boolean;reason:unknown}>;
	try{result=await qualifyGrainNativeV1({source:GRAIN_SOURCE,height:2,params:GRAIN_PARAMS,mode:'target'})
		.then(()=>({failed:false,reason:undefined}),error=>({failed:true,reason:error as unknown}));}
	finally{globalThis.Uint8Array=Native;globalThis.structuredClone=clone;
		if(previous)Object.defineProperty(globalThis,'WebGL2RenderingContext',previous);else Reflect.deleteProperty(globalThis,'WebGL2RenderingContext');}
	assert.equal(result.failed,true);assert.equal(result.reason===reason,true);assert.equal(clones,1);assert.equal(traps,0);
	assert.ok(owned);assert.ok(owned.every(byte=>byte===0));
});
