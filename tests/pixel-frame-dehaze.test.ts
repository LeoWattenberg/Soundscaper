/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withDehazePixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-dehaze-v1.ts';
import { DEHAZE_SOURCE_V1 } from './helpers/video-dehaze-reference.ts';

const limits = { maximumSidePixels: 1024, maximumPixels: 262144, maximumBytes: 1048576 };
const effect = () => ({ id: 'dehaze', type: 'dehaze-v1', enabled: true, params: { amount: 100 } });
function frame(large = false) { return { descriptor: { schemaVersion: 1, width: large ? 512 : 2, height: large ? 256 : 2,
	sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: new Uint8Array(large ? Array.from({ length: 512 * 256 * 4 }, (_, n) => n % 4 === 3 ? 255 : 128) : DEHAZE_SOURCE_V1) }; }
function held() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

test('Dehaze joins held consumers and wipes captured output backing through fulfillment or opaque refusal', async () => {
	for (const fail of [false,true]) {
		const source = frame(), gate = held(), failure = Object.freeze({ consumer: 'refused' }); let output: Uint8Array | undefined, settled = false;
		const work = withDehazePixelFrameV1({ frame: source, effect: effect() }, async value => {
			output = value.pixels; await gate.promise; if (fail) throw failure; return 'used';
		}, { limits });
		void work.then(() => { settled = true; }, () => { settled = true; }); await Promise.resolve();
		assert.equal(output?.[0],6); assert.equal(settled,false); gate.release();
		if (fail) await assert.rejects(work,error => error === failure); else assert.equal(await work,'used');
		assert.ok(output?.every(byte => byte === 0)); assert.deepEqual([...source.pixels],DEHAZE_SOURCE_V1);
	}
});

test('native cancellation preserves an opaque reason without reading mutable signal shadows or escaping a held consumer', async () => {
	const stop = new AbortController(), gate = held(); let reads = 0, output: Uint8Array | undefined, settled = false;
	const reason = new Proxy({}, { get() { reads++; throw Error(); }, getOwnPropertyDescriptor() { reads++; throw Error(); }, getPrototypeOf() { reads++; throw Error(); } });
	Object.defineProperty(stop.signal,'throwIfAborted',{ get() { reads++; throw Error('shadow'); } });
	const work = withDehazePixelFrameV1({ frame: frame(), effect: effect(), signal: stop.signal }, async value => { output = value.pixels; await gate.promise; }, { limits });
	void work.then(() => { settled = true; }, () => { settled = true; }); await Promise.resolve(); stop.abort(reason); await Promise.resolve();
	assert.equal(settled,false); gate.release();
	const result = await work.then(() => ({ failed: false, reason: undefined as unknown }), error => ({ failed: true, reason: error as unknown }));
	assert.equal(result.failed,true); assert.equal(result.reason === reason,true); assert.equal(reads,0); assert.ok(output?.every(byte => byte === 0));
});

test('positive Dehaze yields to native cancellation before delivery and retains the immutable caller bytes', async () => {
	const stop = new AbortController(),source = frame(true),before = source.pixels.slice(),Native = Uint8Array,owned: Uint8Array[] = [];
	let consumed = false,fired = false,reads = 0;
	const reason = new Proxy({}, { get() { reads++; throw Error(); },getOwnPropertyDescriptor() { reads++; throw Error(); },getPrototypeOf() { reads++; throw Error(); } });
	globalThis.Uint8Array = new Proxy(Native,{ construct(target,args) {
		const result = Reflect.construct(target,args) as Uint8Array; if (args[0] instanceof Native) owned.push(result); return result;
	} });
	const timer = setTimeout(() => { fired = true; stop.abort(reason); },0);
	let result: Readonly<{ failed: boolean;reason: unknown }>;
	try { result = await withDehazePixelFrameV1({ frame: source,effect: effect(),signal: stop.signal },() => { consumed = true; },{ limits })
		.then(() => ({ failed: false,reason: undefined }),error => ({ failed: true,reason: error as unknown })); }
	finally { clearTimeout(timer); globalThis.Uint8Array = Native; }
	assert.equal(result.failed,true); assert.equal(result.reason === reason,true); assert.equal(reads,0);
	assert.equal(fired,true); assert.equal(consumed,false); assert.equal(owned.length,2); assert.ok(owned.every(bytes => bytes.every(byte => byte === 0)));
	assert.deepEqual(source.pixels,before);
});

test('source transfer and mutable settings after a real yield cannot replace the admitted atmospheric snapshot', async () => {
	for (const transfer of [false,true]) {
		const source = frame(true), operation = effect(); let fired = false;
		const timer = setTimeout(() => { fired = true; operation.params.amount = -100;
			if (transfer) structuredClone(source.pixels.buffer,{ transfer: [source.pixels.buffer] }); else source.pixels.fill(0);
		},0);
		try {
			const output = await withDehazePixelFrameV1({ frame: source,effect: operation },value => [...value.pixels],{ limits });
			assert.equal(fired,true); assert.ok(output.every((byte,n) => byte === (n % 4 === 3 ? 255 : 14)));
			assert.equal(source.pixels.byteLength,transfer ? 0 : 512 * 256 * 4);
		} finally { clearTimeout(timer); }
	}
});

test('admission rejects unsupported depth, geometry, accessors and future envelopes before reading pixels or delivering', async () => {
	let reads = 0, consumes = 0; const source = frame();
	const getter = Object.defineProperty({},'amount',{ enumerable: true,get() { reads++; return 100; } });
	const oversize = Object.defineProperty({ descriptor: { ...source.descriptor,width: 1025 } },'pixels',{ enumerable: true,get() { reads++; return source.pixels; } });
	for (const input of [{ frame: source,effect: { ...effect(),params: getter } },{ frame: oversize,effect: effect() },
		{ frame: { ...source,descriptor: { ...source.descriptor,transfer: 'pq' } },effect: effect() },
		{ frame: { ...source,descriptor: { ...source.descriptor,sampleFormat: 'float32' } },effect: effect() },
		{ frame: source,effect: { ...effect(),type: 'dehaze' } },{ frame: source,effect: effect(),future: 1 }]) {
		await assert.rejects(withDehazePixelFrameV1(input,() => { consumes++; },{ limits }));
	}
	assert.equal(reads,0); assert.equal(consumes,0);
});

test('second allocation refusal wipes the owned source and preserves its opaque failure without reflection', async () => {
	const source = frame(), Native = Uint8Array; let snapshot: Uint8Array | undefined, reads = 0, copied = 0;
	const failure = new Proxy({}, { get() { reads++; throw Error(); },getOwnPropertyDescriptor() { reads++; throw Error(); },getPrototypeOf() { reads++; throw Error(); } });
	globalThis.Uint8Array = new Proxy(Native,{ construct(target,args) {
		if (args[0] instanceof Native) { copied++; if (copied === 2) throw failure; const result = Reflect.construct(target,args) as Uint8Array; snapshot = result; return result; }
		return Reflect.construct(target,args);
	} });
	let result: Readonly<{ failed: boolean;reason: unknown }>;
	try { result = await withDehazePixelFrameV1({ frame: source,effect: effect() },() => assert.fail('No delivery after allocation refusal'),{ limits })
		.then(() => ({ failed: false,reason: undefined }),error => ({ failed: true,reason: error as unknown })); }
	finally { globalThis.Uint8Array = Native; }
	assert.equal(result.failed,true); assert.equal(result.reason === failure,true); assert.equal(reads,0); assert.equal(copied,2);
	assert.ok(snapshot?.every(byte => byte === 0)); assert.deepEqual([...source.pixels],DEHAZE_SOURCE_V1);
});

test('consumer buffer shadows cannot redirect captured backing cleanup into caller-owned memory', async () => {
	let output: Uint8Array | undefined; const alien = new Uint8Array([1,2,3,4]);
	await withDehazePixelFrameV1({ frame: frame(),effect: effect() },value => {
		output = value.pixels; Object.defineProperty(value.pixels,'buffer',{ get() { assert.fail('Consumer shadow must never run'); } });
		Object.defineProperty(value.pixels,'byteLength',{ value: alien.byteLength });
	},{ limits });
	assert.ok(output?.every(byte => byte === 0)); assert.deepEqual([...alien],[1,2,3,4]);
});
