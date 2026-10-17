/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withTexturePixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-texture-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const limits={maximumSidePixels:1024,maximumPixels:262144,maximumBytes:1048576};
const effect=()=>({id:'texture',type:'texture-v1',enabled:true,params:{amount:100}});
function frame(large=false){const width=large?512:3,height=large?256:1;
	return {descriptor:{schemaVersion:1,width,height,sampleFormat:'unorm8',primaries:'srgb',transfer:'srgb'},
		pixels:new Uint8Array(large?Array.from({length:width*height},(_,n)=>{const v=[96,128,160,128][n%4]!;return[v,v,v,127];}).flat()
			:[64,64,64,255,128,128,128,255,192,192,192,255])};}

test('Texture scopes both backings through held consumer success and opaque failure',async()=>{
	for(const fail of [false,true]){
		const gate=deferred<void>(),source=frame();let output:Uint8Array|undefined,traps=0;
		const reason=new Proxy({}, {get(){traps++;throw Error();},getOwnPropertyDescriptor(){traps++;throw Error();},getPrototypeOf(){traps++;throw Error();}});
		const work=withTexturePixelFrameV1({frame:source,effect:effect()},async view=>{output=view.pixels;await gate.promise;if(fail)throw reason;return'used';},{limits});
		const observed=work.then(result=>({failed:false,result,reason:undefined as unknown}),(error:unknown)=>({failed:true,result:'',reason:error}));
		await Promise.resolve();assert.equal(output?.[0],59);assert.equal(await remainsPending(work),true);gate.resolve();
		const result=await observed;assert.equal(result.failed,fail);if(fail)assert.equal(result.reason===reason,true);else assert.equal(result.result,'used');
		assert.equal(traps,0);assert.ok(output?.every(n=>n===0));assert.equal(source.pixels[0],64);
	}
});

test('native cancellation after the callback enters joins it and preserves exact opaque reason without borrowed inspection',async()=>{
	const gate=deferred<void>(),source=frame(),stop=new AbortController();let output:Uint8Array|undefined,traps=0;
	const reason=new Proxy({}, {get(){traps++;throw Error();},getOwnPropertyDescriptor(){traps++;throw Error();},getPrototypeOf(){traps++;throw Error();}});
	Object.defineProperty(stop.signal,'throwIfAborted',{get(){traps++;throw Error('Signal shadow');}});
	const work=withTexturePixelFrameV1({frame:source,effect:effect(),signal:stop.signal},async view=>{
		output=view.pixels;Object.defineProperty(view.pixels,'buffer',{get(){traps++;throw Error('Borrowed backing');}});await gate.promise;
	},{limits});
	const observed=work.then(()=>({failed:false,reason:undefined as unknown}),(error:unknown)=>({failed:true,reason:error}));
	await Promise.resolve();stop.abort(reason);assert.equal(await remainsPending(work),true);gate.resolve();
	const result=await observed;assert.equal(result.failed,true);assert.equal(result.reason===reason,true);assert.equal(traps,0);
	assert.ok(output?.every(n=>n===0));assert.deepEqual([...source.pixels],[64,64,64,255,128,128,128,255,192,192,192,255]);
});

test('real processing yield cancellation joins and wipes both private byte allocations before any delivery',async()=>{
	const source=frame(true),Native=Uint8Array,stop=new AbortController(),reason=Object.freeze({atYield:true}),copies:Uint8Array[]=[];let delivered=false;
	globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const result=Reflect.construct(target,args)as Uint8Array;if(args[0] instanceof Native)copies.push(result);return result;}});
	const timer=setTimeout(()=>{stop.abort(reason);},0);
	try{const result=await withTexturePixelFrameV1({frame:source,effect:effect(),signal:stop.signal},()=>{delivered=true;},{limits})
		.then(()=>({failed:false,reason:undefined as unknown}),(error:unknown)=>({failed:true,reason:error}));
		assert.equal(result.failed,true);assert.equal(result.reason===reason,true);
	}finally{clearTimeout(timer);globalThis.Uint8Array=Native;}
	assert.equal(delivered,false);assert.equal(copies.length,2);assert.ok(copies.every(copy=>copy.every(n=>n===0)));assert.equal(source.pixels[0],96);
});

test('synchronous source/recipe detachment survives transferred input and overridden slice during a real task yield',async()=>{
	const source=frame(true),recipe=effect();let reads=0,fired=false;
	Object.defineProperty(source.pixels,'slice',{value:()=>{reads++;throw Error();}});
	const timer=setTimeout(()=>{fired=true;recipe.params.amount=-100;structuredClone(source.pixels.buffer,{transfer:[source.pixels.buffer]});},0);
	try{const output=await withTexturePixelFrameV1({frame:source,effect:recipe},view=>[...view.pixels],{limits});
		assert.equal(fired,true);assert.equal(source.pixels.byteLength,0);assert.equal(reads,0);assert.equal(output[16],91);
		assert.ok(output.filter((_,n)=>n%4===3).every(n=>n===127));
	}finally{clearTimeout(timer);}
});

test('second owned allocation failure retires the first snapshot and preserves opaque primary and caller bytes',async()=>{
	const source=frame(),Native=Uint8Array;let copies=0,snapshot:Uint8Array|undefined,traps=0;
	const reason=new Proxy({}, {get(){traps++;throw Error();},getOwnPropertyDescriptor(){traps++;throw Error();},getPrototypeOf(){traps++;throw Error();}});
	globalThis.Uint8Array=new Proxy(Native,{construct(target,args){if(args[0] instanceof Native){copies++;if(copies===2)throw reason;
		const next=Reflect.construct(target,args)as Uint8Array;snapshot=next;return next;}return Reflect.construct(target,args);}});
	try{const result=await withTexturePixelFrameV1({frame:source,effect:effect()},()=>assert.fail('No delivery'),{limits})
		.then(()=>({failed:false,reason:undefined as unknown}),(error:unknown)=>({failed:true,reason:error}));
		assert.equal(result.failed,true);assert.equal(result.reason===reason,true);
	}finally{globalThis.Uint8Array=Native;}
	assert.equal(copies,2);assert.equal(traps,0);assert.ok(snapshot?.every(n=>n===0));assert.equal(source.pixels[0],64);
});

test('cold unsupported/oversized/disabled-invalid admission precedes borrowed pixel access and resource delivery',async()=>{
	let reads=0,delivered=0;const source=frame(),getter=Object.defineProperty({},'amount',{enumerable:true,get(){reads++;return 50;}});
	const oversized=Object.defineProperty({descriptor:{...source.descriptor,width:1025}},'pixels',{enumerable:true,get(){reads++;return source.pixels;}});
	for(const input of [{frame:oversized,effect:effect()},{frame:source,effect:{...effect(),params:getter}},
		{frame:source,effect:{...effect(),enabled:false,params:{amount:101}}},{frame:source,effect:{...effect(),type:'texture-v2'}},
		{frame:{...source,descriptor:{...source.descriptor,transfer:'pq'}},effect:effect()},{frame:source,effect:effect(),extra:true}])
		await assert.rejects(withTexturePixelFrameV1(input,()=>{delivered++;},{limits}));
	assert.equal(reads,0);assert.equal(delivered,0);
	const stop=new AbortController();stop.abort(null);
	const result=await withTexturePixelFrameV1({frame:source,effect:effect(),signal:stop.signal},()=>{delivered++;},{limits})
		.then(()=>({failed:false,reason:undefined as unknown}),(reason:unknown)=>({failed:true,reason}));
	assert.equal(result.failed,true);assert.equal(result.reason,null);assert.equal(delivered,0);
});
