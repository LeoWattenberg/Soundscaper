/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withDetailSharpenPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-sharpen-v1.ts';

const limits = { maximumSidePixels: 1024, maximumPixels: 262144, maximumBytes: 1048576 };
const effect = () => ({ id: 'sharp', type: 'detail-sharpen-v1', enabled: true, params: { amount: 100 } });
function frame(large = false) { return { descriptor: { schemaVersion: 1, width: large ? 512 : 3, height: large ? 256 : 1,
	sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' },
	pixels: new Uint8Array(large ? Array.from({ length: 512 * 256 * 4 }, (_, n) => n % 4 === 3 ? 127 : 80)
		: [40,40,40,255,100,100,100,255,160,160,160,255]) }; }
function held() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

test('detail sharpening joins a held consumer and wipes its output on fulfillment and refusal', async () => {
	for (const fail of [false, true]) {
		const gate = held(), failure = Object.freeze({ consumer: 'refused' }); let output: Uint8Array | undefined, settled = false;
		const work = withDetailSharpenPixelFrameV1({ frame: frame(), effect: effect() }, async value => {
			output = value.pixels; await gate.promise; if (fail) throw failure; return 'used';
		}, { limits });
		void work.then(() => { settled = true; }, () => { settled = true; }); await Promise.resolve();
		assert.equal(output?.[0], 25); assert.equal(settled, false); gate.release();
		if (fail) await assert.rejects(work, error => error === failure); else assert.equal(await work, 'used');
		assert.ok(output?.every(byte => byte === 0));
	}
});

test('held detail consumer cancellation preserves opaque native identity without inspecting shadows or reason', async () => {
	const stop = new AbortController(), gate = held(); let reads = 0, output: Uint8Array | undefined, settled = false;
	const reason = new Proxy({}, { get() { reads++; throw Error('opaque get'); }, getOwnPropertyDescriptor() { reads++; throw Error('opaque descriptor'); },
		getPrototypeOf() { reads++; throw Error('opaque prototype'); } });
	Object.defineProperty(stop.signal, 'throwIfAborted', { get() { reads++; throw Error('shadow'); } });
	const work = withDetailSharpenPixelFrameV1({ frame: frame(), effect: effect(), signal: stop.signal }, async value => {
		output = value.pixels; await gate.promise;
	}, { limits });
	void work.then(() => { settled = true; }, () => { settled = true; }); await Promise.resolve(); stop.abort(reason); await Promise.resolve();
	assert.equal(settled, false); gate.release();
	const result = await work.then(() => ({ failed: false, reason: undefined as unknown }), error => ({ failed: true, reason: error as unknown }));
	assert.equal(result.failed, true); assert.equal(result.reason === reason, true); assert.equal(reads, 0); assert.ok(output?.every(byte => byte === 0));
});

test('detail kernel yields a real task and refuses delivery after cancellation without mutating source', async () => {
	const stop = new AbortController(), reason = Object.freeze({ stopped: true }), source = frame(true); let consumed = false, fired = false;
	const timer = setTimeout(() => { fired = true; stop.abort(reason); }, 0);
	try { await assert.rejects(withDetailSharpenPixelFrameV1({ frame: source, effect: effect(), signal: stop.signal }, () => { consumed = true; }, { limits }), error => error === reason); }
	finally { clearTimeout(timer); }
	assert.equal(fired, true); assert.equal(consumed, false); assert.equal(source.pixels[0], 80);
});

test('detail source and parameters detach before yielding, including native source transfer', async () => {
	for (const transfer of [false, true]) {
		const source = frame(true), operation = effect();
		const timer = setTimeout(() => { operation.params.amount = 200;
			if (transfer) structuredClone(source.pixels.buffer, { transfer: [source.pixels.buffer] }); else source.pixels.fill(0);
		}, 0);
		try {
			const result = await withDetailSharpenPixelFrameV1({ frame: source, effect: operation }, value => [...value.pixels], { limits });
			assert.equal(result.length, 512 * 256 * 4); assert.ok(result.every((byte, n) => byte === (n % 4 === 3 ? 127 : 80)));
			if (transfer) assert.equal(source.pixels.byteLength, 0); else assert.equal(source.pixels[0], 0);
		} finally { clearTimeout(timer); }
	}
});

test('source admission is closed and bounded before invoking the detail consumer', async () => {
	let reads = 0, consumes = 0; const source = frame();
	const getter = Object.defineProperty({}, 'amount', { enumerable: true, get() { reads++; return 100; } });
	for (const input of [
		{ frame: source, effect: { ...effect(), params: getter } },
		{ frame: { ...source, descriptor: { ...source.descriptor, width: 1025 } }, effect: effect() },
		{ frame: { ...source, descriptor: { ...source.descriptor, transfer: 'pq' } }, effect: effect() },
		{ frame: source, effect: { ...effect(), type: 'sharpen' } },
	]) await assert.rejects(withDetailSharpenPixelFrameV1(input, () => { consumes++; }, { limits }));
	assert.equal(reads, 0); assert.equal(consumes, 0);
});

test('failed second backing allocation wipes the already-owned snapshot and preserves opaque failure identity', async () => {
	const source=frame(),Native=Uint8Array;let snapshot:Uint8Array|undefined,reads=0,copied=0;
	const failure=new Proxy({}, {get(){reads++;throw Error();},getOwnPropertyDescriptor(){reads++;throw Error();},getPrototypeOf(){reads++;throw Error();}});
	globalThis.Uint8Array=new Proxy(Native,{construct(target,args){
		if(args[0] instanceof Native){copied++;if(copied===2)throw failure;const result=Reflect.construct(target,args) as Uint8Array;snapshot=result;return result;}
		return Reflect.construct(target,args);
	}});
	let result:Readonly<{failed:boolean;reason:unknown}>;
	try{result=await withDetailSharpenPixelFrameV1({frame:source,effect:effect()},()=>assert.fail('Allocation failure cannot deliver'),{limits})
		.then(()=>({failed:false,reason:undefined}),error=>({failed:true,reason:error as unknown}));}
	finally{globalThis.Uint8Array=Native;}
	assert.equal(result.failed,true);assert.equal(result.reason===failure,true);assert.equal(reads,0);assert.equal(copied,2);
	assert.ok(snapshot);assert.ok(snapshot.every(byte=>byte===0));assert.deepEqual([...source.pixels],[40,40,40,255,100,100,100,255,160,160,160,255]);
});
