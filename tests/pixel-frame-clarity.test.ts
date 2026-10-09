/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withClarityPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-clarity-v1.ts';

const limits = { maximumSidePixels: 1024, maximumPixels: 262144, maximumBytes: 1048576 };
const effect = () => ({ id: 'clarity', type: 'clarity-v1', enabled: true, params: { amount: 100 } });
function frame(large = false) { return { descriptor: { schemaVersion: 1, width: large ? 512 : 3, height: large ? 256 : 1,
	sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: new Uint8Array(large
		? Array.from({ length: 512*256*4 }, (_, n) => n%4===3?127:80) : [64,64,64,255,128,128,128,255,192,192,192,255]) }; }
function held() { let release!: () => void; const promise = new Promise<void>(resolve => { release=resolve; }); return { promise, release }; }

test('Clarity joins held success/refusal and retires the scoped output', async () => {
	for(const fail of [false,true]){
		const gate=held(),reason=Object.freeze({ consumer:true });let output:Uint8Array|undefined,settled=false;
		const work=withClarityPixelFrameV1({frame:frame(),effect:effect()},async view=>{output=view.pixels;await gate.promise;if(fail)throw reason;return 'used';},{limits});
		void work.then(()=>{settled=true;},()=>{settled=true;});await Promise.resolve();assert.equal(output?.[0],49);assert.equal(settled,false);gate.release();
		if(fail)await assert.rejects(work,error=>error===reason);else assert.equal(await work,'used');assert.ok(output?.every(n=>n===0));
	}
});

test('held native cancellation joins consumer settlement without opaque reason or signal shadow inspection', async () => {
	const source=frame(),gate=held(),stop=new AbortController();let output:Uint8Array|undefined,settled=false,reads=0;
	const reason=new Proxy({}, {get(){reads++;throw Error();},getOwnPropertyDescriptor(){reads++;throw Error();},getPrototypeOf(){reads++;throw Error();}});
	Object.defineProperty(stop.signal,'throwIfAborted',{get(){reads++;throw Error();}});
	const work=withClarityPixelFrameV1({frame:source,effect:effect(),signal:stop.signal},async view=>{output=view.pixels;await gate.promise;},{limits});
	const observed=work.then(()=>({failed:false,reason:undefined as unknown}),error=>({failed:true,reason:error as unknown}));
	void work.then(()=>{settled=true;},()=>{settled=true;});await Promise.resolve();stop.abort(reason);await Promise.resolve();assert.equal(settled,false);gate.release();
	const result=await observed;assert.equal(result.failed,true);assert.equal(result.reason===reason,true);assert.equal(reads,0);assert.ok(output?.every(n=>n===0));
	assert.deepEqual([...source.pixels],[64,64,64,255,128,128,128,255,192,192,192,255]);
});

test('real task cancellation prevents delivery, while detached source/amount snapshots survive input transfer', async () => {
	const stop=new AbortController(),reason=Object.freeze({stop:true}),source=frame(true);let delivered=false,fired=false;
	const cancel=setTimeout(()=>{fired=true;stop.abort(reason);},0);
	try{await assert.rejects(withClarityPixelFrameV1({frame:source,effect:effect(),signal:stop.signal},()=>{delivered=true;},{limits}),error=>error===reason);}finally{clearTimeout(cancel);}
	assert.equal(fired,true);assert.equal(delivered,false);assert.equal(source.pixels[0],80);
	const input=frame(true),recipe=effect(),change=setTimeout(()=>{recipe.params.amount=-100;structuredClone(input.pixels.buffer,{transfer:[input.pixels.buffer]});},0);
	try{const output=await withClarityPixelFrameV1({frame:input,effect:recipe},view=>[...view.pixels],{limits});
		assert.ok(output.every((byte,n)=>byte===(n%4===3?127:80)));assert.equal(input.pixels.byteLength,0);
	}finally{clearTimeout(change);}
});

test('closed unsupported/bounded source profiles refuse before consumer or parameter getters', async () => {
	let reads=0,consumes=0;const source=frame(),params=Object.defineProperty({},'amount',{enumerable:true,get(){reads++;return 100;}});
	for(const input of [{frame:source,effect:{...effect(),params}}, {frame:{...source,descriptor:{...source.descriptor,width:1025}},effect:effect()},
		{frame:{...source,descriptor:{...source.descriptor,transfer:'pq'}},effect:effect()}, {frame:source,effect:{...effect(),type:'color-adjust'}}]) {
		await assert.rejects(withClarityPixelFrameV1(input,()=>{consumes++;},{limits}));
	}
	assert.equal(reads,0);assert.equal(consumes,0);
});

test('opaque second output allocation failure wipes the owned snapshot and preserves caller bytes', async () => {
	const source=frame(),Native=Uint8Array;let copied=0,reads=0,snapshot:Uint8Array|undefined;
	const reason=new Proxy({}, {get(){reads++;throw Error();},getOwnPropertyDescriptor(){reads++;throw Error();},getPrototypeOf(){reads++;throw Error();}});
	globalThis.Uint8Array=new Proxy(Native,{construct(target,args){if(args[0] instanceof Native){copied++;if(copied===2)throw reason;
		const result=Reflect.construct(target,args)as Uint8Array;snapshot=result;return result;}return Reflect.construct(target,args);}});
	let result:Readonly<{failed:boolean;reason:unknown}>;
	try{result=await withClarityPixelFrameV1({frame:source,effect:effect()},()=>assert.fail('No failed allocation delivery'),{limits})
		.then(()=>({failed:false,reason:undefined}),error=>({failed:true,reason:error as unknown}));}finally{globalThis.Uint8Array=Native;}
	assert.equal(result.failed,true);assert.equal(result.reason===reason,true);assert.equal(reads,0);assert.equal(copied,2);assert.ok(snapshot?.every(n=>n===0));
	assert.deepEqual([...source.pixels],[64,64,64,255,128,128,128,255,192,192,192,255]);
});
