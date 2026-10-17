/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect, normalizeVideoEffect, serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { videoEffectPasses, EFFECT_CODES, EFFECT_PROGRAM_COUNT } from '../src/common/editor/ui/video-preview-effects.js';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { withPhotoDevelopProxyFrameV1, withPhotoDevelopFullResolutionFrameV1 } from '../src/lightscaper/controller/photo-develop-frame-v1.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { isCompiledNoiseReductionOperationV1 } from '../src/common/editor/video-noise-reduction-ffmpeg-v1.ts';
import { appendVideoEffectOperation } from '../src/common/editor/video-effect-ffmpeg.ts';

const source = () => new Uint8Array([100,100,100,255,200,200,200,255,100,100,100,255]);
const noise = () => createVideoEffect('noise-reduction-v1',{id:'noise',params:{luminance:100,luminanceDetail:0}});
const expected = [125,125,125,255,150,150,150,255,125,125,125,255];

test('shared noise normalization, preview planning and export keep one exact process without changing legacy types',()=>{
	const effect=noise(); assert.deepEqual(normalizeVideoEffect(effect),effect);
	assert.equal(EFFECT_CODES['noise-reduction-v1'],30); assert.equal(EFFECT_PROGRAM_COUNT,34);
	assert.deepEqual(videoEffectPasses(effect),[{code:30,params0:[256,0,0,0],params1:[128,128,0,0],direction:[0,0]}]);
	const operation=serializeVideoEffectsToFfmpegOperations([effect])[0]; assert.ok(operation);
	assert.ok(isCompiledNoiseReductionOperationV1(operation)); assert.equal(operation.kind,'noise-reduction-v1');
	const filters:string[]=[]; appendVideoEffectOperation({filters,inputLabel:'0:v',outputLabel:'noise',operation,width:3,height:1});
	assert.ok(filters.some(value=>value.includes('geq='))); const originalFilters=[...filters];
	assert.throws(()=>appendVideoEffectOperation({filters,inputLabel:'0:v',outputLabel:'copy',operation:{...operation},width:3,height:1}));
	assert.deepEqual(filters,originalFilters);
	assert.throws(()=>normalizeVideoEffect({...effect,enabled:false,params:{color:101}}));
	assert.deepEqual(videoEffectPasses(createVideoEffect('noise-reduction-v1')),[]);
});

test('actual Frame and both named Photo profiles evaluate the same original RGB-noise neighborhood',async()=>{
	const pixels=source(),effect=noise();
	assert.deepEqual([...(await applyVideoExactBrowserEffectsFinishing({width:3,height:1,pixels},[effect],new AbortController().signal)).pixels],expected);
	const frame={descriptor:{schemaVersion:1,width:3,height:1,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels};
	for(const render of [withPhotoDevelopProxyFrameV1,withPhotoDevelopFullResolutionFrameV1]) assert.deepEqual(await render({frame,develop:{...defaultPhotoDevelopV1(),effects:[effect]}},view=>[...view.frame.pixels]),expected);
	assert.deepEqual([...pixels],[...source()]);
});

test('Frame noise cancellation joins post-consumer refusal and wipes every undelivered clone without reading the opaque reason',async()=>{
	const pixels=source(),stop=new AbortController(),nativeSlice=Uint8Array.prototype.slice,copies:Uint8Array[]=[]; let reads=0;
	const reason=new Proxy({}, {get(){reads++;throw Error();},getOwnPropertyDescriptor(){reads++;throw Error();},getPrototypeOf(){reads++;throw Error();}});
	Uint8Array.prototype.slice=function(...args:Parameters<typeof nativeSlice>){const copy=Reflect.apply(nativeSlice,this,args)as Uint8Array<ArrayBuffer>;copies.push(copy);return copy;};
	let outcome:Readonly<{rejected:boolean;reason:unknown}>;
	try{queueMicrotask(()=>stop.abort(reason));outcome=await applyVideoExactBrowserEffectsFinishing({width:3,height:1,pixels},[noise()],stop.signal)
		.then(()=>({rejected:false,reason:undefined}),error=>({rejected:true,reason:error as unknown}));}
	finally{Uint8Array.prototype.slice=nativeSlice;}
	assert.equal(outcome.rejected,true);assert.equal(outcome.reason===reason,true);assert.equal(reads,0);assert.equal(copies.length,2);
	assert.ok(copies.every(copy=>copy.every(byte=>byte===0)));assert.deepEqual([...pixels],[...source()]);
});

test('Photo crop and RGB-noise processing retain authored order and current natural neighborhoods',async()=>{
	const pixels=source(),effect=noise(),crop=createVideoEffect('develop-geometry-v1',{id:'crop',params:{cropWidth:2/3}});
	const render=async(effects:readonly unknown[])=>withPhotoDevelopProxyFrameV1({frame:{descriptor:{schemaVersion:1,width:3,height:1,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels},
		develop:{...defaultPhotoDevelopV1(),effects}},view=>({width:view.frame.descriptor.width,pixels:[...view.frame.pixels]}));
	assert.deepEqual(await render([crop,effect]),{width:2,pixels:[125,125,125,255,175,175,175,255]});
	assert.deepEqual(await render([effect,crop]),{width:2,pixels:[125,125,125,255,150,150,150,255]}); assert.deepEqual([...pixels],[...source()]);
});

test('Frame noise refuses cancellation between the kernel check and final outer delivery and wipes that output',async()=>{
	const pixels=source(),effect=noise(),stop=new AbortController(),nativeSlice=Uint8Array.prototype.slice,copies:Uint8Array[]=[];let reads=0;
	const reason=new Proxy({}, {get(){reads++;throw Error();},getOwnPropertyDescriptor(){reads++;throw Error();},getPrototypeOf(){reads++;throw Error();}});
	Uint8Array.prototype.slice=function(...args:Parameters<typeof nativeSlice>){
		const copy=Reflect.apply(nativeSlice,this,args)as Uint8Array<ArrayBuffer>;copies.push(copy);
		if(copies.length===2)queueMicrotask(()=>queueMicrotask(()=>stop.abort(reason)));
		return copy;
	};
	let outcome:Readonly<{rejected:boolean;reason:unknown}>;
	try{outcome=await applyVideoExactBrowserEffectsFinishing({width:3,height:1,pixels},[effect],stop.signal)
		.then(()=>({rejected:false,reason:undefined}),error=>({rejected:true,reason:error as unknown}));}
	finally{Uint8Array.prototype.slice=nativeSlice;}
	assert.equal(stop.signal.aborted,true);assert.equal(outcome.rejected,true);assert.equal(outcome.reason===reason,true);assert.equal(reads,0);
	assert.equal(copies.length,2);assert.ok(copies.every(copy=>copy.every(byte=>byte===0)));assert.deepEqual([...pixels],[...source()]);
});

test('noise retains the fixed full-resolution profile beyond proxy bounds and retires its borrowed output',async()=>{
	const pixels=new Uint8Array(Array.from({length:2052},(_,index)=>index%2===0?[100,100,100,255]:[200,200,200,255]).flat());
	const request={frame:{descriptor:{schemaVersion:1,width:2052,height:1,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels},develop:{...defaultPhotoDevelopV1(),effects:[noise()]}};
	let calls=0,borrowed:Uint8Array|undefined;
	await assert.rejects(withPhotoDevelopProxyFrameV1(request,()=>{calls++;}));assert.equal(calls,0);
	await withPhotoDevelopFullResolutionFrameV1(request,view=>{
		calls++;borrowed=view.frame.pixels;assert.equal(view.frame.descriptor.width,2052);
		assert.deepEqual([...view.frame.pixels.slice(0,8)],[125,125,125,255,150,150,150,255]);
		assert.deepEqual([...view.frame.pixels.slice(-8)],[150,150,150,255,175,175,175,255]);
	});
	assert.equal(calls,1);assert.ok(borrowed?.every(byte=>byte===0));
	assert.deepEqual([...pixels.slice(0,8)],[100,100,100,255,200,200,200,255]);
});
