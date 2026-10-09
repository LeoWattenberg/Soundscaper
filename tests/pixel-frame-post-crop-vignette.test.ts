/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withPostCropVignettePixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-post-crop-vignette-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const limits={maximumSidePixels:1024,maximumPixels:262144,maximumBytes:1048576};
const descriptor=(width:number,height:number)=>({schemaVersion:1,width,height,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'});
const effect=(params:unknown={},enabled=true)=>({id:'post-crop',type:'post-crop-vignette-v1',enabled,params});
async function render(source:readonly number[],width:number,height:number,params:unknown={},enabled=true) {
	const pixels=new Uint8Array(source);let borrowed:Uint8Array|undefined;
	const result=await withPostCropVignettePixelFrameV1({frame:{descriptor:descriptor(width,height),pixels},effect:effect(params,enabled)},view=>{borrowed=view.pixels;return [...view.pixels];},{limits});
	assert.deepEqual([...pixels],source);assert.ok(borrowed?.every(n=>n===0));return result;
}

test('literal 3x3 natural-coordinate corner vignette preserves current stage center, edges and alpha',async()=>{
	const source=Array.from({length:9},()=>[128,64,255,127]).flat();
	assert.deepEqual(await render(source,3,3,{amount:-100}),[16,8,31,127,128,64,255,127,16,8,31,127,
		128,64,255,127,128,64,255,127,128,64,255,127,16,8,31,127,128,64,255,127,16,8,31,127]);
	assert.deepEqual(await render(source,3,3,{amount:0}),source);assert.deepEqual(await render(source,3,3,{amount:-100},false),source);
});

test('every alpha byte is exact and alpha-zero centers retain their hidden original RGB',async()=>{
	const source=Array.from({length:256},(_,n)=>[17,93,245,n]).flat();
	const result=await render(source,256,1,{amount:-100,midpoint:0,feather:0,roundness:100});
	assert.deepEqual(result.filter((_,n)=>n%4===3),Array.from({length:256},(_,n)=>n));assert.deepEqual(result.slice(0,4),source.slice(0,4));
	assert.deepEqual(result.slice(4,8),[0,0,0,1]);assert.deepEqual(result.slice(-4),[0,0,0,255]);
});

test('original channel maximum protects all channels together before changing any byte',async()=>{
	assert.deepEqual(await render([255,1,93,127,128,64,32,255],2,1,{amount:-100,midpoint:0,feather:0,highlights:100}),
		[255,1,93,127,65,32,16,255]);
	assert.deepEqual(await render([128,64,32,255],1,1,{amount:100,midpoint:0,feather:0}),[128,64,32,255],'The one-pixel center is unchanged.');
});

test('owning profile and byte limits refuse cold, while source subviews and hostile slice methods remain intact',async()=>{
	const pixels=Uint8Array.of(7,17,93,245,127,9),view=pixels.subarray(1,5);let reads=0;
	Object.defineProperty(view,'slice',{value:()=>{reads++;throw Error('Borrowed slice');}});
	assert.deepEqual(await withPostCropVignettePixelFrameV1({frame:{descriptor:descriptor(1,1),pixels:view},effect:effect({amount:-100})},frame=>[...frame.pixels],{limits}),[17,93,245,127]);
	assert.equal(reads,0);assert.deepEqual([...pixels],[7,17,93,245,127,9]);
	for(const desc of [{...descriptor(1,1),transfer:'linear'},{...descriptor(1,1),sampleFormat:'float32'},descriptor(1025,1)]) {
		await assert.rejects(withPostCropVignettePixelFrameV1({frame:{descriptor:desc,pixels:view},effect:effect()},()=>assert.fail('Cold refusal'),{limits}));
	}
});

test('frame, settings and captured backing detach before borrowed delivery and caller mutations',async()=>{
	const pixels=new Uint8Array(Array.from({length:9},()=>[128,128,128,255]).flat()),params={amount:-100},entered=deferred<void>(),release=deferred<void>();let borrowed:Uint8Array|undefined;
	const work=withPostCropVignettePixelFrameV1({frame:{descriptor:descriptor(3,3),pixels},effect:effect(params)},async frame=>{borrowed=frame.pixels;entered.resolve();await release.promise;return [...frame.pixels];},{limits});
	await entered.promise;pixels.fill(255);params.amount=100;release.resolve();const result=await work;
	assert.equal(result[0],16);assert.equal(result[16],128);assert.ok(borrowed?.every(n=>n===0));assert.ok(pixels.every(n=>n===255));
});

test('opaque caller cancellation joins held delivery and wipes output without probing the reason',async()=>{
	const stop=new AbortController(),entered=deferred<void>(),release=deferred<void>(),pixels=Uint8Array.of(7,19,233,127);let borrowed:Uint8Array|undefined,traps=0;
	const reason=new Proxy({}, {get(){traps++;throw Error();},getPrototypeOf(){traps++;throw Error();}});
	const work=withPostCropVignettePixelFrameV1({frame:{descriptor:descriptor(1,1),pixels},effect:effect(),signal:stop.signal},async frame=>{
		borrowed=frame.pixels;Object.defineProperty(frame.pixels,'buffer',{get(){throw Error('Borrowed buffer property');}});entered.resolve();await release.promise;
	},{limits});
	const observed=work.then(()=>({failed:false,reason:undefined as unknown}),(error:unknown)=>({failed:true,reason:error}));
	await entered.promise;stop.abort(reason);assert.equal(await remainsPending(work),true);release.resolve();const result=await observed;
	assert.equal(result.failed,true);assert.equal(result.reason===reason,true);assert.equal(traps,0);assert.ok(borrowed?.every(n=>n===0));assert.deepEqual([...pixels],[7,19,233,127]);
});

test('consumer failure retires the captured buffer and an already aborted signal allocates no delivery',async()=>{
	const pixels=Uint8Array.of(7,19,233,255),failure=Object.freeze({failed:true});let borrowed:Uint8Array|undefined;
	await assert.rejects(withPostCropVignettePixelFrameV1({frame:{descriptor:descriptor(1,1),pixels},effect:effect()},frame=>{borrowed=frame.pixels;throw failure;},{limits}),error=>error===failure);
	assert.ok(borrowed?.every(n=>n===0));const stop=new AbortController();stop.abort(null);
	const observed=await withPostCropVignettePixelFrameV1({frame:{descriptor:descriptor(1,1),pixels},effect:effect(),signal:stop.signal},()=>assert.fail('No delivery'),{limits}).then(()=>({failed:false,reason:undefined as unknown}),(error:unknown)=>({failed:true,reason:error}));
	assert.equal(observed.failed,true);assert.equal(observed.reason,null);assert.deepEqual([...pixels],[7,19,233,255]);
});
