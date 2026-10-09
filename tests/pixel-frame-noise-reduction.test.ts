/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withNoiseReductionPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-noise-reduction-v1.ts';

const limits = { maximumSidePixels: 1024, maximumPixels: 262144, maximumBytes: 1048576 };
const effect = () => ({ id: 'noise', type: 'noise-reduction-v1', enabled: true, params: { luminance: 100, luminanceDetail: 0, color: 100, colorDetail: 0 } });
function frame(large = false) { return { descriptor: { schemaVersion: 1, width: large ? 512 : 3, height: large ? 256 : 1,
	sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: new Uint8Array(large ? Array.from({ length: 512 * 256 * 4 }, (_, n) => n % 4 === 3 ? 127 : 80)
		: [40,40,40,255,100,100,100,255,160,160,160,255]) }; }
function held() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

test('noise reduction joins held fulfillment and refusal and wipes the output backing', async () => {
	for (const fail of [false, true]) {
		const gate = held(), failure = Object.freeze({ consumer: 'refused' }); let output: Uint8Array | undefined, settled = false;
		const work = withNoiseReductionPixelFrameV1({ frame: frame(), effect: effect() }, async value => {
			output = value.pixels; await gate.promise; if (fail) throw failure; return 'used';
		}, { limits });
		void work.then(() => { settled = true; }, () => { settled = true; }); await Promise.resolve();
		assert.equal(output?.[0], 55); assert.equal(settled, false); gate.release();
		if (fail) await assert.rejects(work, error => error === failure); else assert.equal(await work, 'used');
		assert.ok(output?.every(byte => byte === 0));
	}
});

test('native cancellation joins a held consumer and never reads opaque reasons or mutable signal shadows', async () => {
	const stop = new AbortController(), gate = held(); let reads = 0, output: Uint8Array | undefined, settled = false;
	const reason = new Proxy({}, { get() { reads++; throw Error(); }, getOwnPropertyDescriptor() { reads++; throw Error(); }, getPrototypeOf() { reads++; throw Error(); } });
	Object.defineProperty(stop.signal, 'throwIfAborted', { get() { reads++; throw Error('shadow'); } });
	const work = withNoiseReductionPixelFrameV1({ frame: frame(), effect: effect(), signal: stop.signal }, async value => { output = value.pixels; await gate.promise; }, { limits });
	void work.then(() => { settled = true; }, () => { settled = true; }); await Promise.resolve(); stop.abort(reason); await Promise.resolve();
	assert.equal(settled, false); gate.release();
	const result = await work.then(() => ({ failed: false, reason: undefined as unknown }), error => ({ failed: true, reason: error as unknown }));
	assert.equal(result.failed, true); assert.equal(result.reason === reason, true); assert.equal(reads, 0); assert.ok(output?.every(byte => byte === 0));
});

test('noise reduction yields to native cancellation before delivery and retains the caller source', async () => {
	const stop = new AbortController(), reason = Object.freeze({ stopped: true }), source = frame(true); let consumed = false, fired = false;
	const timer = setTimeout(() => { fired = true; stop.abort(reason); }, 0);
	try { await assert.rejects(withNoiseReductionPixelFrameV1({ frame: source, effect: effect(), signal: stop.signal }, () => { consumed = true; }, { limits }), error => error === reason); }
	finally { clearTimeout(timer); }
	assert.equal(fired, true); assert.equal(consumed, false); assert.equal(source.pixels[0], 80);
});

test('native source transfer and settings mutation after a real yield cannot change the admitted noise operation', async () => {
	for (const transfer of [false, true]) {
		const source = frame(true), operation = effect();
		const timer = setTimeout(() => { operation.params.luminance = 0; operation.params.color = 0;
			if (transfer) structuredClone(source.pixels.buffer, { transfer: [source.pixels.buffer] }); else source.pixels.fill(0);
		}, 0);
		try {
			const result = await withNoiseReductionPixelFrameV1({ frame: source, effect: operation }, value => [...value.pixels], { limits });
			assert.equal(result.length, 512 * 256 * 4); assert.ok(result.every((byte, n) => byte === (n % 4 === 3 ? 127 : 80)));
			if (transfer) assert.equal(source.pixels.byteLength, 0); else assert.equal(source.pixels[0], 0);
		} finally { clearTimeout(timer); }
	}
});

test('noise admission refuses geometry, formats, accessors and unknown fields before consuming or reading pixels', async () => {
	let reads = 0, consumes = 0; const source = frame();
	const getter = Object.defineProperty({}, 'color', { enumerable: true, get() { reads++; return 100; } });
	const oversize = Object.defineProperty({ descriptor: { ...source.descriptor, width: 1025 } }, 'pixels', { enumerable: true, get() { reads++; return source.pixels; } });
	for (const input of [{ frame: source, effect: { ...effect(), params: getter } }, { frame: oversize, effect: effect() },
		{ frame: { ...source, descriptor: { ...source.descriptor, transfer: 'pq' } }, effect: effect() },
		{ frame: { ...source, descriptor: { ...source.descriptor, sampleFormat: 'unorm16' } }, effect: effect() },
		{ frame: source, effect: { ...effect(), type: 'denoise' } }, { frame: source, effect: effect(), future: 1 }]) {
		await assert.rejects(withNoiseReductionPixelFrameV1(input, () => { consumes++; }, { limits }));
	}
	assert.equal(reads, 0); assert.equal(consumes, 0);
});

test('failure of the second allocation wipes the owned snapshot and preserves the opaque failure', async () => {
	const source = frame(), Native = Uint8Array; let snapshot: Uint8Array | undefined, reads = 0, copied = 0;
	const failure = new Proxy({}, { get() { reads++; throw Error(); }, getOwnPropertyDescriptor() { reads++; throw Error(); }, getPrototypeOf() { reads++; throw Error(); } });
	globalThis.Uint8Array = new Proxy(Native, { construct(target, args) {
		if (args[0] instanceof Native) { copied++; if (copied === 2) throw failure; const result = Reflect.construct(target, args) as Uint8Array; snapshot = result; return result; }
		return Reflect.construct(target, args);
	} });
	let result: Readonly<{ failed: boolean; reason: unknown }>;
	try { result = await withNoiseReductionPixelFrameV1({ frame: source, effect: effect() }, () => assert.fail('No delivery after allocation failure'), { limits })
		.then(() => ({ failed: false, reason: undefined }), error => ({ failed: true, reason: error as unknown })); }
	finally { globalThis.Uint8Array = Native; }
	assert.equal(result.failed, true); assert.equal(result.reason === failure, true); assert.equal(reads, 0); assert.equal(copied, 2);
	assert.ok(snapshot); assert.ok(snapshot.every(byte => byte === 0)); assert.deepEqual([...source.pixels], [40,40,40,255,100,100,100,255,160,160,160,255]);
});
