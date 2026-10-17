/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect, normalizeVideoEffect, serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { videoEffectPasses, EFFECT_CODES, EFFECT_PROGRAM_COUNT } from '../src/common/editor/ui/video-preview-effects.js';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { withPhotoDevelopProxyFrameV1, withPhotoDevelopFullResolutionFrameV1 } from '../src/lightscaper/controller/photo-develop-frame-v1.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { assertTextureFfmpegOperationV1 } from '../src/common/editor/video-texture-v1.ts';
import { appendVideoEffectOperation } from '../src/common/editor/video-effect-ffmpeg.ts';
import { textureReferenceV1 } from './browser/helpers/lightscaper-texture-reference.ts';

const source=()=>new Uint8Array([64,64,64,255,128,128,128,255,192,192,192,255]);
const texture=()=>createVideoEffect('texture-v1',{id:'texture',params:{amount:100}});
const expected=[59,59,59,255,128,128,128,255,197,197,197,255];

test('shared Texture admission, code32 planning and compiled export preserve the exact dual-scale process',()=>{
	const effect=texture();assert.deepEqual(normalizeVideoEffect(effect),effect);
	assert.equal(Object.getOwnPropertyDescriptor(EFFECT_CODES,'texture-v1')?.value as unknown,32);assert.equal(EFFECT_PROGRAM_COUNT,34);
	assert.deepEqual(videoEffectPasses(effect),[{code:32,params0:[256,0,0,0],params1:[0,0,0,0],direction:[0,0]}]);
	const operation=serializeVideoEffectsToFfmpegOperations([effect])[0];assert.ok(operation);assertTextureFfmpegOperationV1(operation);
	const filters:string[]=[];appendVideoEffectOperation({filters,inputLabel:'0:v',outputLabel:'texture',operation,width:3,height:1});
	assert.ok(filters.some(value=>value.includes('geq=')));const before=[...filters];
	assert.throws(()=>appendVideoEffectOperation({filters,inputLabel:'0:v',outputLabel:'forged',operation:{...operation},width:3,height:1}));
	assert.deepEqual(filters,before);assert.throws(()=>normalizeVideoEffect({...effect,enabled:false,params:{amount:101}}));
	assert.deepEqual(videoEffectPasses(createVideoEffect('texture-v1')),[]);
});

test('actual selected Frame and both fixed Photo profiles render the independently literal medium-frequency neighborhood',async()=>{
	const pixels=source(),effect=texture();
	const output=await applyVideoExactBrowserEffectsFinishing({width:3,height:1,pixels},[effect],new AbortController().signal);
	try{assert.deepEqual([...output.pixels],expected);}finally{output.pixels.fill(0);}
	for(const render of [withPhotoDevelopProxyFrameV1,withPhotoDevelopFullResolutionFrameV1]){
		let borrowed:Uint8Array|undefined;
		assert.deepEqual(await render({frame:{descriptor:{schemaVersion:1,width:3,height:1,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels},
			develop:{...defaultPhotoDevelopV1(),effects:[effect]}},view=>{borrowed=view.frame.pixels;return[...view.frame.pixels];}),expected);
		assert.ok(borrowed?.every(byte=>byte===0));
	}
	assert.deepEqual([...pixels],[...source()]);
});

test('Photo natural crop and Texture retain different authored neighborhoods in their actual stage order',async()=>{
	const pixels=source(),effect=texture(),crop=createVideoEffect('develop-geometry-v1',{id:'crop',params:{cropWidth:2/3}});
	const render=async(effects:readonly unknown[])=>withPhotoDevelopProxyFrameV1({frame:{descriptor:{schemaVersion:1,width:3,height:1,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels},
		develop:{...defaultPhotoDevelopV1(),effects}},view=>({width:view.frame.descriptor.width,pixels:[...view.frame.pixels]}));
	assert.deepEqual(await render([crop,effect]),{width:2,pixels:[61,61,61,255,131,131,131,255]});
	assert.deepEqual(await render([effect,crop]),{width:2,pixels:expected.slice(0,8)});assert.deepEqual([...pixels],[...source()]);
});

test('Frame Texture final cancellation joins and wipes both undelivered clones without inspecting the opaque reason',async()=>{
	const pixels=source(),effect=texture(),stop=new AbortController(),nativeSlice=Uint8Array.prototype.slice,copies:Uint8Array[]=[];let reads=0;
	const reason=new Proxy({}, {get(){reads++;throw Error();},getOwnPropertyDescriptor(){reads++;throw Error();},getPrototypeOf(){reads++;throw Error();}});
	Uint8Array.prototype.slice=function(...args:Parameters<typeof nativeSlice>){const copy=Reflect.apply(nativeSlice,this,args)as Uint8Array<ArrayBuffer>;copies.push(copy);
		if(copies.length===2)queueMicrotask(()=>queueMicrotask(()=>stop.abort(reason)));return copy;};
	let outcome:Readonly<{rejected:boolean;reason:unknown}>;
	try{outcome=await applyVideoExactBrowserEffectsFinishing({width:3,height:1,pixels},[effect],stop.signal)
		.then(()=>({rejected:false,reason:undefined}),error=>({rejected:true,reason:error as unknown}));}
	finally{Uint8Array.prototype.slice=nativeSlice;}
	assert.equal(stop.signal.aborted,true);assert.equal(outcome.rejected,true);assert.equal(outcome.reason===reason,true);assert.equal(reads,0);
	assert.equal(copies.length,2);assert.ok(copies.every(copy=>copy.every(byte=>byte===0)));assert.deepEqual([...pixels],[...source()]);
});

test('Texture full-resolution wrapper keeps its fixed larger profile and scoped output instead of widening the proxy',async()=>{
	const original=Array.from({length:2052},(_,n)=>n%2?[160,160,160,127]:[96,96,96,127]).flat(),pixels=new Uint8Array(original);
	const request={frame:{descriptor:{schemaVersion:1,width:2052,height:1,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels},
		develop:{...defaultPhotoDevelopV1(),effects:[texture()]}};
	let calls=0,borrowed:Uint8Array|undefined;await assert.rejects(withPhotoDevelopProxyFrameV1(request,()=>{calls++;}));assert.equal(calls,0);
	await withPhotoDevelopFullResolutionFrameV1(request,view=>{calls++;borrowed=view.frame.pixels;
		assert.deepEqual([...view.frame.pixels],textureReferenceV1(original,2052,100));});
	assert.equal(calls,1);assert.ok(borrowed?.every(byte=>byte===0));assert.deepEqual([...pixels],original);
});
