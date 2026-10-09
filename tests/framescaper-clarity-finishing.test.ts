/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeClarityEffectV1 } from '../src/common/editor/video-clarity-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { withPhotoDevelopProxyV1 } from '../src/lightscaper/controller/photo-develop-proxy-v1.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';

const pixels=()=>new Uint8Array([64,64,64,255,128,128,128,255,192,192,192,255]);
const clarity=(amount=100)=>normalizeClarityEffectV1(createVideoEffect('clarity-v1',{id:'clarity',params:{amount}}));

test('actual Frame Clarity scoped clone cancellation retires all undelivered copies and preserves opaque reason/source',async()=>{
	const source=pixels(),stop=new AbortController(),nativeSlice=Uint8Array.prototype.slice,copies:Uint8Array[]=[];let reads=0;
	const reason=new Proxy({}, {get(){reads++;throw Error();},getOwnPropertyDescriptor(){reads++;throw Error();},getPrototypeOf(){reads++;throw Error();}});
	Uint8Array.prototype.slice=function(...args:Parameters<typeof nativeSlice>){const copy=Reflect.apply(nativeSlice,this,args)as Uint8Array<ArrayBuffer>;copies.push(copy);return copy;};
	let outcome:Readonly<{rejected:boolean;reason:unknown}>;
	try{queueMicrotask(()=>stop.abort(reason));outcome=await applyVideoExactBrowserEffectsFinishing({width:3,height:1,pixels:source},[clarity()],stop.signal)
		.then(()=>({rejected:false,reason:undefined}),error=>({rejected:true,reason:error as unknown}));}
	finally{Uint8Array.prototype.slice=nativeSlice;}
	assert.equal(outcome.rejected,true);assert.equal(outcome.reason===reason,true);assert.equal(reads,0);
	assert.equal(copies.length,2);assert.ok(copies.every(copy=>copy.every(n=>n===0)));assert.deepEqual([...source],[...pixels()]);
});

test('successful Frame Clarity transfers a distinct live result while neutral/disabled retain exact source bytes',async()=>{
	const source=pixels();
	for(const effect of [clarity(),clarity(0),{...clarity(),enabled:false}]){
		const output=await applyVideoExactBrowserEffectsFinishing({width:3,height:1,pixels:source},[effect],new AbortController().signal);
		assert.notStrictEqual(output.pixels,source);assert.deepEqual([...output.pixels],effect.enabled&&effect.params.amount!==0?[49,49,49,255,128,128,128,255,206,206,206,255]:[...source]);
		output.pixels.fill(0);assert.deepEqual([...source],[...pixels()]);
	}
});

test('Photo natural crop and Clarity preserve authored order rather than sampling outside the delivered crop',async()=>{
	const source=pixels(),crop=createVideoEffect('develop-geometry-v1',{id:'crop',params:{cropWidth:2/3}});
	const render=async(effects:readonly unknown[])=>withPhotoDevelopProxyV1({frame:{descriptor:{schemaVersion:1,width:3,height:1,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},pixels:source},
		develop:{...defaultPhotoDevelopV1(),effects}},view=>({width:view.frame.descriptor.width,pixels:[...view.frame.pixels]}));
	// The cropped two-pixel source has literal left/right bin sums42/22 give means86/106; signed common offsets -11/+22.
	assert.deepEqual(await render([crop,clarity()]),{width:2,pixels:[53,53,53,255,150,150,150,255]});
	assert.deepEqual(await render([clarity(),crop]),{width:2,pixels:[49,49,49,255,128,128,128,255]});
	assert.deepEqual([...source],[...pixels()]);
});
