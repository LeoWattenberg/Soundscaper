/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { BRUSH_MASK_RESOURCE_LIMITS_V1, normalizeBrushMaskResourceReferenceV1,
	withBrushMaskResourceV1, withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { assertDeepFrozen } from './helpers/frozen-contract-assertions.ts';
import { deferred, settle } from './helpers/async-test-control.ts';

// Independent SHA256 of literal SCMASK01, LE 4x1, then alpha [0,64,128,255].
const HASH = '523ccc7dab4d9c2c2871517d78dd21da4863fedb5cbe4b3f000175f67882ef76';
const KEY = `brush-mask-v1:4:1:${HASH}`;
const LITERAL = [83, 67, 77, 65, 83, 75, 48, 49, 4, 0, 0, 0, 1, 0, 0, 0, 0, 64, 128, 255];
const body = () => new Uint8Array(LITERAL);

test('brush reference is a frozen exact namespace/dimension/digest identity with independent literal bytes', async () => {
	const reference = normalizeBrushMaskResourceReferenceV1(KEY);
	assert.deepEqual(reference, { storageKey: KEY, sha256: HASH, width: 4, height: 1, byteLength: 20 });
	assertDeepFrozen(reference);
	assert.equal(BRUSH_MASK_RESOURCE_LIMITS_V1.maximumSide, 1024);
	assert.equal(BRUSH_MASK_RESOURCE_LIMITS_V1.maximumPixels, 1_048_576);
	assert.equal(BRUSH_MASK_RESOURCE_LIMITS_V1.maximumBodyBytes, 1_048_592);
	assert.deepEqual(await withBrushMaskResourceV1({ reference, bytes: body() }, resource => [...resource.alpha]), [0, 64, 128, 255]);
	assert.deepEqual(normalizeBrushMaskResourceReferenceV1(`brush-mask-v1:1024:1024:${HASH}`),
		{ storageKey: `brush-mask-v1:1024:1024:${HASH}`, sha256: HASH, width: 1024, height: 1024, byteLength: 1_048_592 });
});

test('brush primitive parser refuses aliases, unknown versions, invalid dimensions and opaque objects without reflection', () => {
	let reflected = 0;
	const opaque = new Proxy({}, { ownKeys() { reflected++; throw Error('Reference reflected'); } });
	for (const value of [opaque, {}, null, undefined, 1, KEY.toUpperCase(), `${KEY}:extra`, KEY.replace('v1', 'v2'),
		KEY.replace(':4:', ':04:'), KEY.replace(':4:', ':+4:'), KEY.replace(':4:', ':0:'), KEY.replace(':4:', ':1025:'),
		KEY.replace(':1:', ':1.0:'), KEY.replace(HASH, 'a'.repeat(63))]) assert.throws(() => normalizeBrushMaskResourceReferenceV1(value));
	assert.equal(reflected, 0);
});

test('scoped encoder emits literal header/digest, detaches input before yielding and wipes its delivered body', async () => {
	const alpha = new Uint8Array([0, 64, 128, 255]), entered = deferred<void>(), release = deferred<void>();
	let borrowed: Uint8Array | undefined;
	const work = withPreparedBrushMaskResourceV1({ width: 4, height: 1, alpha }, async prepared => {
		borrowed = prepared.bytes; assert.deepEqual([...prepared.bytes], LITERAL); assert.equal(prepared.reference.storageKey, KEY);
		assertDeepFrozen(prepared.reference); entered.resolve(); await release.promise;
		return await withBrushMaskResourceV1(prepared, resource => [...resource.alpha]);
	});
	alpha.fill(9);
	try { await Promise.race([entered.promise, work]); assert.deepEqual([...borrowed!], LITERAL); }
	finally { release.resolve(); }
	assert.deepEqual(await work, [0, 64, 128, 255]); assert.ok(borrowed?.every(value => value === 0)); assert.deepEqual([...alpha], [9, 9, 9, 9]);
});

test('prepared body cleanup pins backing before a borrower shadows buffer and preserves its exact opaque primary', async () => {
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); let borrowed: Uint8Array | undefined, getters = 0;
	const cleanupImpostor = Object.freeze({ cleanup: 'caller buffer getter' });
	const result = await withPreparedBrushMaskResourceV1({ width: 4, height: 1, alpha: new Uint8Array([0, 64, 128, 255]) }, prepared => {
		borrowed = prepared.bytes;
		Object.defineProperty(prepared.bytes, 'buffer', { get() { getters++; throw cleanupImpostor; } });
		throw opaque.proxy;
	}).then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
	assert.equal(getters, 0); assert.equal(Object.is(result.error, opaque.proxy), true); assert.ok(borrowed?.every(value => value === 0));
});

test('complete body authentication rejects framing, length and digest errors before delivering any alpha', async () => {
	let delivered = 0;
	for (const change of [(bytes: Uint8Array) => { bytes[0] = 0; }, (bytes: Uint8Array) => { bytes[7] = 50; },
		(bytes: Uint8Array) => { bytes[8] = 3; }, (bytes: Uint8Array) => { bytes[12] = 2; }, (bytes: Uint8Array) => { bytes[19] = 254; }]) {
		const bytes = body(); change(bytes);
		await assert.rejects(withBrushMaskResourceV1({ reference: KEY, bytes }, () => { delivered++; }));
	}
	for (const bytes of [body().slice(0, -1), new Uint8Array([...LITERAL, 0])]) {
		await assert.rejects(withBrushMaskResourceV1({ reference: KEY, bytes }, () => { delivered++; }));
	}
	await assert.rejects(withBrushMaskResourceV1({ reference: KEY.replace(HASH, '0'.repeat(64)), bytes: body() }, () => { delivered++; }));
	assert.equal(delivered, 0);
});

test('closed request/reference and native exact backing admission execute no caller geometry getters', async () => {
	let getters = 0, delivered = 0;
	const shadow = Object.defineProperty(body(), 'byteLength', { get() { getters++; return 20; } });
	const accessor = Object.defineProperty({ reference: KEY }, 'bytes', { enumerable: true, get() { getters++; return body(); } });
	const reference = Object.defineProperty({ ...normalizeBrushMaskResourceReferenceV1(KEY) }, 'width', { enumerable: true, get() { getters++; return 4; } });
	for (const value of [accessor, { reference, bytes: body() }, { reference: KEY, bytes: shadow },
		{ reference: KEY, bytes: new Uint8Array(new SharedArrayBuffer(20)) },
		{ reference: KEY, bytes: new Uint8Array(new ArrayBuffer(21), 1, 20) },
		{ reference: KEY, bytes: new Uint8Array(Reflect.construct(ArrayBuffer, [20, { maxByteLength: 40 }]) as ArrayBuffer) },
		{ reference: KEY, bytes: body(), future: true }]) {
		await assert.rejects(withBrushMaskResourceV1(value, () => { delivered++; }));
	}
	assert.equal(getters, 0); assert.equal(delivered, 0);
	for (const value of [{ width: 1025, height: 1, alpha: new Uint8Array(1025) }, { width: 4, height: 1, alpha: new Uint8Array(3) },
		{ width: -0, height: 1, alpha: new Uint8Array() }, { width: 4, height: 1, alpha: new Uint8Array(new ArrayBuffer(5), 0, 4) }]) {
		await assert.rejects(withPreparedBrushMaskResourceV1(value, () => { delivered++; }));
	}
	assert.equal(delivered, 0);
});

test('held borrowed alpha joins cancellation, retains the exact opaque first reason, and wipes only after release', async () => {
	const source = body(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); const reason = opaque.proxy;
	let borrowed: Uint8Array | undefined, settled = false;
	const work = withBrushMaskResourceV1({ reference: KEY, bytes: source, signal: stop.signal }, async resource => {
		borrowed = resource.alpha; assert.deepEqual([...resource.alpha], [0, 64, 128, 255]); entered.resolve(); await release.promise;
	});
	const outcome = work.then(() => ({ failed: false, error: undefined as unknown }), (error: unknown) => ({ failed: true, error }));
	void outcome.then(() => { settled = true; });
	try {
		await Promise.race([entered.promise, work]); stop.abort(reason); source.fill(13); await settle(3);
		assert.equal(settled, false); assert.deepEqual([...borrowed!], [0, 64, 128, 255]);
	} finally { release.resolve(); await outcome; }
	const result = await outcome; assert.equal(result.failed, true); assert.equal(Object.is(result.error, reason), true);
	assert.ok(borrowed?.every(value => value === 0)); assert.ok(source.every(value => value === 13));
});

test('pre-cancelled and shadowed native signals refuse without bytes reflection; consumer opaque failure survives wipe', async () => {
	const stop = new AbortController(), reason = Object.freeze({ cancelled: true }); stop.abort(reason);
	let reflected = 0, delivered = 0;
	const bytes = new Proxy({}, { ownKeys() { reflected++; throw Error('Cancelled body reflected'); } });
	const result = await withBrushMaskResourceV1({ reference: KEY, bytes, signal: stop.signal }, () => { delivered++; }).catch((error: unknown) => error);
	assert.equal(result, reason); assert.equal(reflected, 0); assert.equal(delivered, 0);
	const signal = new AbortController().signal; Object.defineProperty(signal, 'throwIfAborted', { value() {} });
	await assert.rejects(withBrushMaskResourceV1({ reference: KEY, bytes: body(), signal }, () => { delivered++; }));
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); let borrowed: Uint8Array | undefined;
	const failure = await withBrushMaskResourceV1({ reference: KEY, bytes: body() }, resource => { borrowed = resource.alpha; throw opaque.proxy; }).then(
		() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
	assert.equal(Object.is(failure.error, opaque.proxy), true); assert.ok(borrowed?.every(value => value === 0)); assert.equal(delivered, 0);
});
