/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect, normalizeVideoEffect, serializeVideoEffectsToFfmpegOperations, VIDEO_EFFECT_TYPES } from '../src/common/editor/video-effects.js';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { withPhotoDevelopProxyV1 } from '../src/lightscaper/controller/photo-develop-proxy-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { videoEffectPasses } from '../src/common/editor/ui/video-preview-effects.js';
import { createPostCropVignetteEffectV1 } from '../src/common/editor/video-post-crop-vignette-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const vignette=()=>createVideoEffect('post-crop-vignette-v1',{id:'v',params:{amount:-100}});
const source=()=>new Uint8Array(Array.from({length:9},()=>[128,64,255,127]).flat());
const expected=[16,8,31,127,128,64,255,127,16,8,31,127,128,64,255,127,128,64,255,127,128,64,255,127,16,8,31,127,128,64,255,127,16,8,31,127];
test('optional preview effects retain their existing empty planning behavior before family dispatch',()=>{
	assert.deepEqual(videoEffectPasses(null),[]);assert.deepEqual(videoEffectPasses(undefined),[]);
});
test('registry and scalar preview expose one complete closed recipe and preserve legacy vignette export bytes',()=>{
	assert.equal(VIDEO_EFFECT_TYPES.filter(type=>type==='post-crop-vignette-v1').length,1);
	const effect=vignette();assert.deepEqual(normalizeVideoEffect(effect),effect);assert.equal(Object.keys(effect.params).length,5);
	const operation=serializeVideoEffectsToFfmpegOperations([effect])[0];assert.ok(operation&&'kind' in operation);assert.equal(operation.kind,'post-crop-vignette-v1');
	assert.deepEqual(serializeVideoEffectsToFfmpegOperations([createVideoEffect('vignette')]),[{expression:'vignette=angle=0.7848981633974483:x0=w/2:y0=h/2:mode=forward:eval=init:dither=0',preserveAlpha:true}]);
	assert.deepEqual(videoEffectPasses(effect).map(pass=>pass.code),[28]);
	let calls=0;const hostile={get amount(){calls++;return 0;}};
	assert.throws(()=>createVideoEffect('post-crop-vignette-v1',{params:hostile}));assert.equal(calls,0);
	assert.throws(()=>normalizeVideoEffect({...effect,enabled:false,params:{...effect.params,amount:101}}));
});
test('actual Frame and Photo render literal natural-stage coordinates, exact straight alpha and source immutability',async()=>{
	const pixels=source(),effects=[vignette()];
	assert.deepEqual([...(await applyVideoExactBrowserEffectsFinishing({width:3,height:3,pixels},effects,new AbortController().signal)).pixels],expected);
	assert.deepEqual(await withPhotoDevelopProxyV1({frame:{descriptor:{schemaVersion:1,width:3,height:3,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels},develop:{...defaultImageDevelopStateV1(),effects}},view=>[...view.frame.pixels]),expected);
	assert.deepEqual([...pixels],[...source()]);
});
test('Photo native reference pixels and full histogram bins follow independently pinned two-by-two bytes',async()=>{
	const pixels=new Uint8Array([0,32,64,255,64,128,192,255,128,128,128,255,255,224,16,255]);
	const bytes=[0,16,32,255,32,64,96,255,64,64,64,255,128,112,8,255];
	const effect=createVideoEffect('post-crop-vignette-v1',{id:'v',params:{amount:-100,midpoint:0,roundness:0,feather:100,highlights:0}});
	await withPhotoDevelopProxyV1({frame:{descriptor:{schemaVersion:1,width:2,height:2,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels},develop:{...defaultImageDevelopStateV1(),effects:[effect]}},view=>{
		assert.deepEqual([...view.frame.pixels],bytes);
		for(const[channel,values]of [['red',[0,32,64,128]],['green',[16,64,64,112]],['blue',[8,32,64,96]]]as const){
			const bins=Array.from({length:256},(_,n)=>values.filter(value=>value===n).length);assert.deepEqual([...view.histogram.bins[channel]],bins);
		}
	});
});
test('creation validates complete public scalars before borrowing an ID factory, including disabled and future recipes',()=>{
	let calls=0,traps=0;const create=()=>{calls++;return 'new-vignette';};
	for(const bad of [{enabled:null},{id:undefined},{index:-1},{type:'vignette'},{params:{amount:101}},
		{params:{future:0}},Object.defineProperty({},'params',{enumerable:true,get(){traps++;return {};}})])assert.throws(()=>createPostCropVignetteEffectV1(bad,create));
	assert.equal(calls,0);assert.equal(traps,0);assert.equal(createPostCropVignetteEffectV1({},create).id,'new-vignette');assert.equal(calls,1);
	assert.equal(createPostCropVignetteEffectV1({id:'supplied',enabled:false},create).id,'supplied');assert.equal(calls,1);
});
test('Photo staged frame holds exact opaque cancellation until delivery settles and wipes its output after rejection',async()=>{
	const pixels=source(),entered=deferred<void>(),release=deferred<void>(),stop=new AbortController();let view:Uint8Array|undefined,traps=0;
	const reason=new Proxy({}, {get(){traps++;throw Error();},getPrototypeOf(){traps++;throw Error();}});
	const work=withPhotoDevelopProxyV1({frame:{descriptor:{schemaVersion:1,width:3,height:3,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels},develop:{...defaultImageDevelopStateV1(),effects:[vignette()]},signal:stop.signal},async result=>{view=result.frame.pixels;entered.resolve();await release.promise;});
	const observed=work.then(()=>({ok:true,error:undefined as unknown}),(error:unknown)=>({ok:false,error}));
	await entered.promise;stop.abort(reason);assert.equal(await remainsPending(work),true);release.resolve();const result=await observed;
	assert.equal(result.ok,false);assert.equal(result.error===reason,true);assert.equal(traps,0);assert.ok(view?.every(byte=>byte===0));assert.deepEqual([...pixels],[...source()]);
});
test('natural crop before vignette recomputes centers, while vignette before crop retains the original stage mask',async()=>{
	const pixels=source(),crop=createVideoEffect('develop-geometry-v1',{id:'crop',params:{cropX:0,cropY:0,cropWidth:1/3,cropHeight:1/3}});
	// Use a black corner rather than center: the one-pixel natural crop is its own unchanged center.
	for(const [effects,bytes]of [[[crop,vignette()],[128,64,255,127]],[[vignette(),crop],[16,8,31,127]]]as const){
		const output=await withPhotoDevelopProxyV1({frame:{descriptor:{schemaVersion:1,width:3,height:3,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels},develop:{...defaultImageDevelopStateV1(),effects}},view=>({width:view.frame.descriptor.width,height:view.frame.descriptor.height,pixels:[...view.frame.pixels]}));
		assert.deepEqual(output,{width:1,height:1,pixels:bytes});
	}
	assert.deepEqual([...pixels],[...source()]);
});
