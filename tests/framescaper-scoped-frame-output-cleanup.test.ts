/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';

const effect=(type:string,params={})=>({id:'effect',type,enabled:true,params});

for(const [name,recipe,copyCount]of [
	['HSL CPU',[effect('hsl-mixer-v1',{redHue:60})],1],
	['geometry',[effect('develop-geometry-v1')],2],
] as const)test(`actual Frame ${name} post-consumer cancellation wipes undelivered clones and joins kernel cleanup`,async()=>{
	const pixels=new Uint8Array([255,0,0,127]),source=[...pixels],stop=new AbortController();
	let traps=0;
	const reason=new Proxy({}, {get(){traps++;throw Error('opaque');},getPrototypeOf(){traps++;throw Error('opaque');},
		getOwnPropertyDescriptor(){traps++;throw Error('opaque');}});
	Object.defineProperty(stop.signal,'throwIfAborted',{get(){traps++;throw Error('shadow');}});
	const intrinsic=Uint8Array.prototype.slice,copies:Uint8Array[]=[],borrowed:Uint8Array[]=[];
	Uint8Array.prototype.slice=function(...args:Parameters<typeof intrinsic>){
		const copy=Reflect.apply(intrinsic,this,args) as ReturnType<typeof intrinsic>;borrowed.push(this);copies.push(copy);return copy;
	};
	try{
		queueMicrotask(()=>{stop.abort(reason);});
		const result=await applyVideoExactBrowserEffectsFinishing({width:1,height:1,pixels},recipe,stop.signal)
			.then(()=>({rejected:false,reason:undefined as unknown}),failure=>({rejected:true,reason:failure as unknown}));
		assert.equal(result.rejected,true);assert.equal(result.reason,reason);assert.equal(traps,0);
		assert.equal(copies.length,copyCount,'the actual scoped consumer created its output before cancellation');
		assert.ok(copies.every(copy=>copy.every(byte=>byte===0)),'every undelivered Frame clone must be wiped');
		assert.ok(borrowed.filter(copy=>copy.buffer!==pixels.buffer).every(copy=>copy.every(byte=>byte===0)),'kernel settlement must precede rejection');
		assert.deepEqual([...pixels],source);
	}finally{Uint8Array.prototype.slice=intrinsic;}
});

test('actual Frame delivered CPU and geometry outputs retain ownership after a later abort',async()=>{
	for(const recipe of [[effect('hsl-mixer-v1',{redHue:60})],[effect('develop-geometry-v1')]]){
		const pixels=new Uint8Array([255,0,0,127]),stop=new AbortController();
		const output=await applyVideoExactBrowserEffectsFinishing({width:1,height:1,pixels},recipe,stop.signal);
		const expected=recipe[0]!.type==='hsl-mixer-v1'?[255,255,0,127]:[255,0,0,127];
		stop.abort(null);await Promise.resolve();
		assert.deepEqual([...output.pixels],expected);assert.deepEqual([...pixels],[255,0,0,127]);
	}
});
