/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withGrainPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-grain-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const limits={maximumSidePixels:1024,maximumPixels:262144,maximumBytes:1048576};
const descriptor=(width:number,height:number)=>({schemaVersion:1,width,height,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'});
const effect=(params:unknown={},enabled=true)=>({id:'grain',type:'grain-v1',enabled,params});

test('grain is scoped straight-byte output with a common-RGB envelope and exact original alpha',async()=>{
	const pixels=new Uint8Array(Array.from({length:256},(_,alpha)=>[8,128,250,alpha]).flat());let delivered:Uint8Array|undefined;
	const output=await withGrainPixelFrameV1({frame:{descriptor:descriptor(16,16),pixels},effect:effect({amount:100,size:2,seed:7})},view=>{
		delivered=view.pixels;return [...view.pixels];
	},{limits});
	assert.deepEqual(output.filter((_,n)=>n%4===3),Array.from({length:256},(_,n)=>n));assert.deepEqual(output.slice(0,4),[8,128,250,0]);
	assert.ok(output.some((n,i)=>i%4!==3&&n!==pixels[i]));assert.ok(delivered?.every(n=>n===0));assert.equal(pixels[4],8);
	for(let n=4;n<output.length;n+=4){const delta=output[n+1]!-128;assert.equal(output[n],Math.max(0,Math.min(255,8+delta)));assert.equal(output[n+2],Math.max(0,Math.min(255,250+delta)));}
	for(const [params,enabled]of [[{},true],[{amount:100},false],[{amount:0.01},true]] as const){
		assert.deepEqual(await withGrainPixelFrameV1({frame:{descriptor:descriptor(16,16),pixels},effect:effect(params,enabled)},view=>[...view.pixels],{limits}),[...pixels]);
	}
});

test('held consumers join cancellation and failure while captured output backing is always wiped',async()=>{
	for(const fail of [false,true]){
		const stop=new AbortController(),entered=deferred<void>(),release=deferred<void>();let delivered:Uint8Array|undefined,traps=0;
		const reason=new Proxy({}, {get(){traps++;throw Error();},getPrototypeOf(){traps++;throw Error();}});
		Object.defineProperty(stop.signal,'throwIfAborted',{get(){traps++;throw Error('Shadow');}});
		const source=Uint8Array.of(128,128,128,127);
		const work=withGrainPixelFrameV1({frame:{descriptor:descriptor(1,1),pixels:source},effect:effect({amount:100}),signal:stop.signal},async view=>{
			delivered=view.pixels;Object.defineProperty(view.pixels,'buffer',{get(){throw Error('Borrowed backing shadow');}});entered.resolve();await release.promise;if(fail)throw reason;
		},{limits});
		const observed=work.then(()=>({failed:false,reason:undefined as unknown}),(error:unknown)=>({failed:true,reason:error}));
		await entered.promise;if(!fail)stop.abort(reason);assert.equal(await remainsPending(work),true);release.resolve();
		const result=await observed;assert.equal(result.failed,true);assert.equal(result.reason===reason,true);assert.equal(traps,0);
		assert.ok(delivered?.every(n=>n===0));assert.deepEqual([...source],[128,128,128,127]);
	}
});

test('source and settings detach before a real yield, including transfer and mutable borrowed slice',async()=>{
	for(const transfer of [false,true]){
		const pixels=new Uint8Array(Array.from({length:512*256},()=>[128,128,128,255]).flat()),params={amount:100,size:2,roughness:50,seed:19};let reads=0;
		Object.defineProperty(pixels,'slice',{value:()=>{reads++;throw Error();}});
		const timer=setTimeout(()=>{params.amount=0;if(transfer)structuredClone(pixels.buffer,{transfer:[pixels.buffer]});else pixels.fill(0);},0);
		try{const result=await withGrainPixelFrameV1({frame:{descriptor:descriptor(512,256),pixels},effect:effect(params)},view=>[...view.pixels],{limits});
			assert.equal(reads,0);assert.ok(result.some((n,i)=>i%4!==3&&n!==128));assert.ok(result.filter((_,i)=>i%4===3).every(n=>n===255));
			assert.equal(pixels.byteLength,transfer?0:512*256*4);
		}finally{clearTimeout(timer);}
	}
});

test('intrinsic cancellation at a real processing yield prevents delivery and wipes the allocated output',async()=>{
	const stop=new AbortController(),reason=Object.freeze({cancelled:'at-yield'}),Native=Uint8Array;
	const pixels=new Native(Array.from({length:512*256},()=>[128,128,128,255]).flat());let output:Uint8Array|undefined,consumed=false;
	globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const next=Reflect.construct(target,args) as Uint8Array;
		if(args[0] instanceof Native)output=next;return next;}});
	const timer=setTimeout(()=>{stop.abort(reason);},0);
	try{await assert.rejects(withGrainPixelFrameV1({frame:{descriptor:descriptor(512,256),pixels},effect:effect({amount:100}),signal:stop.signal},
		()=>{consumed=true;},{limits}),error=>error===reason);}
	finally{globalThis.Uint8Array=Native;clearTimeout(timer);}
	assert.equal(consumed,false);assert.ok(output);assert.ok(output.every(n=>n===0));assert.equal(pixels[0],128);assert.equal(pixels[3],255);
});

test('cold limits, descriptor and recipe rejection precede pixel reflection or delivery',async()=>{
	let reads=0,consumes=0;const pixels=Uint8Array.of(1,2,3,255);
	const source=Object.defineProperty({descriptor:descriptor(1025,1)},'pixels',{enumerable:true,get(){reads++;return pixels;}});
	const bad=Object.defineProperty({},'seed',{enumerable:true,get(){reads++;return 1;}});
	for(const input of [{frame:source,effect:effect()}, {frame:{descriptor:descriptor(1,1),pixels},effect:effect(bad)},
		{frame:{descriptor:{...descriptor(1,1),transfer:'pq'},pixels},effect:effect()},
		{frame:{descriptor:descriptor(1,1),pixels},effect:effect(),extra:1},
		{frame:{descriptor:descriptor(1,1),pixels},effect:effect(),signal:{throwIfAborted(){throw Error();}}}])
		await assert.rejects(withGrainPixelFrameV1(input,()=>{consumes++;},{limits}));
	assert.equal(reads,0);assert.equal(consumes,0);
	const stop=new AbortController();stop.abort(null);
	const result=await withGrainPixelFrameV1({frame:{descriptor:descriptor(1,1),pixels},effect:effect(),signal:stop.signal},()=>{consumes++;},{limits})
		.then(()=>({failed:false,reason:undefined as unknown}),(reason:unknown)=>({failed:true,reason}));
	assert.equal(result.failed,true);assert.equal(result.reason,null);assert.equal(consumes,0);
});
