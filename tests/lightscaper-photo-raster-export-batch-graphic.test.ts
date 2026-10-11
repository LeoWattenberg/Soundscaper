/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	capturePreparedPhotoRasterBatchGraphicV1,
	normalizePhotoRasterBatchGraphicIntentV1,
	preparePhotoRasterBatchGraphicV1,
	reselectPhotoRasterBatchGraphicV1,
} from '../src/lightscaper/controller/photo-raster-export-batch-graphic-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const ABC = Uint8Array.of(97, 98, 99);
const SHA = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const PLACEMENT = { anchor: 'bottom-right' as const, widthFraction: 0.4, marginFraction: 0.1, opacity: 0.6 };
const intent = () => ({ schemaVersion: 1, kind: 'photo-raster-batch-graphic', contentSha256: SHA, byteLength: 3, ...PLACEMENT });
const request = (body: Blob = new Blob([ABC])) => ({ body, ...PLACEMENT });

test('Light batch graphic intent is closed, detached and entirely scalar', () => {
	const input = intent(), output = normalizePhotoRasterBatchGraphicIntentV1(input);
	assert.deepEqual(output, input); assert.notEqual(output, input); assert.equal(Object.isFrozen(output), true);
	input.opacity = 0; assert.equal(output.opacity, 0.6);
	assert.deepEqual(normalizePhotoRasterBatchGraphicIntentV1(output), output);
	for (const change of [{ schemaVersion: 2 }, { kind: 'graphic' }, { body: new Blob([ABC]) }, { contentSha256: SHA.toUpperCase() },
		{ byteLength: 0 }, { byteLength: 67_108_865 }, { byteLength: 1.5 }, { anchor: 'center' }, { widthFraction: 0 },
		{ widthFraction: Infinity }, { marginFraction: 0.5 }, { opacity: NaN }, { opacity: -0.1 }]) {
		assert.throws(() => normalizePhotoRasterBatchGraphicIntentV1({ ...intent(), ...change }));
	}
	let calls = 0; const getter = { ...intent() };
	Object.defineProperty(getter, 'opacity', { enumerable: true, get() { calls++; return 1; } });
	assert.throws(() => normalizePhotoRasterBatchGraphicIntentV1(getter), /data|accessor/iu); assert.equal(calls, 0);
	assert.throws(() => normalizePhotoRasterBatchGraphicIntentV1(Object.assign(Object.create(intent()) as object, {})));
});

test('Light prepares an independent literal SHA and pins placement before its first yield', async () => {
	const original = new File([ABC], 'mark.png', { type: 'image/png' }), input = request(original);
	const pending = preparePhotoRasterBatchGraphicV1(input); input.opacity = 0; input.anchor = 'top-left' as typeof input.anchor;
	const prepared = await pending;
	assert.deepEqual(prepared.intent, intent()); assert.deepEqual(prepared.request, request(prepared.request.body));
	assert.notEqual(prepared.request.body, original); assert.equal(Object.isFrozen(prepared), true);
	assert.equal(Object.isFrozen(prepared.request), true); assert.equal(Object.isFrozen(prepared.intent), true);
	assert.equal(capturePreparedPhotoRasterBatchGraphicV1(prepared), prepared);
	assert.deepEqual(new Uint8Array(await original.arrayBuffer()), ABC);
});

test('Light reselection accepts equal bytes under another filename and retains persisted placement', async () => {
	const first = await preparePhotoRasterBatchGraphicV1(request(new File([ABC], 'old.png')));
	const persisted = { ...first.intent, anchor: 'top-center', opacity: 0.25 }, pending = reselectPhotoRasterBatchGraphicV1(persisted, new File([ABC], 'renamed.jpg'));
	persisted.opacity = 1;
	const next = await pending;
	assert.equal(next.intent.contentSha256, SHA); assert.equal(next.intent.opacity, 0.25); assert.equal(next.request.opacity, 0.25);
	assert.equal(next.request.anchor, 'top-center'); assert.equal(capturePreparedPhotoRasterBatchGraphicV1(next), next);
	await assert.rejects(reselectPhotoRasterBatchGraphicV1(first.intent, new Blob([Uint8Array.of(97, 98, 100)])), /fingerprint|SHA|changed/iu);
	await assert.rejects(reselectPhotoRasterBatchGraphicV1(first.intent, new Blob([ABC, ABC])), /length|fingerprint|changed/iu);
});

test('Light prepared proof rejects clones and proxies without reflecting forged authority', async () => {
	const prepared = await preparePhotoRasterBatchGraphicV1(request());
	for (const value of [{ ...prepared }, Object.freeze({ intent: prepared.intent, request: prepared.request }), null, undefined, 'prepared']) {
		assert.throws(() => capturePreparedPhotoRasterBatchGraphicV1(value), /prepared|proof/iu);
	}
	let calls = 0;
	const proxy = new Proxy(prepared, { get() { calls++; throw new Error('get'); }, getPrototypeOf() { calls++; throw new Error('prototype'); } });
	assert.throws(() => capturePreparedPhotoRasterBatchGraphicV1(proxy), /prepared|proof/iu); assert.equal(calls, 0);
	const revoked = Proxy.revocable(prepared, {}); revoked.revoke();
	assert.throws(() => capturePreparedPhotoRasterBatchGraphicV1(revoked.proxy), /prepared|proof/iu);
	assert.throws(() => { Object.defineProperty(prepared.request, 'opacity', { value: 0 }); });
});

test('Light native Blob content ignores caller-owned size, slice and read overrides', async () => {
	const body = new Blob([ABC]); let calls = 0;
	for (const key of ['size', 'type', 'slice', 'arrayBuffer']) Object.defineProperty(body, key, { get() { calls++; throw new Error(key); } });
	const prepared = await preparePhotoRasterBatchGraphicV1(request(body));
	assert.equal(prepared.intent.contentSha256, SHA); assert.equal(calls, 0);
	await assert.rejects(preparePhotoRasterBatchGraphicV1(request(new Blob())), /nonempty|limit/iu);
	await assert.rejects(preparePhotoRasterBatchGraphicV1(request(Object.create(Blob.prototype) as Blob)));
});

test('Light hashing uses captured native methods after prototype substitution', async context => {
	const body = new Blob([ABC]); let calls = 0;
	context.mock.method(Blob.prototype, 'slice', () => { calls++; throw new Error('late slice'); });
	context.mock.method(Blob.prototype, 'arrayBuffer', () => { calls++; throw new Error('late read'); });
	const prepared = await preparePhotoRasterBatchGraphicV1(request(body));
	assert.equal(prepared.intent.contentSha256, SHA); assert.equal(calls, 0);
});

test('Light cancellation options reject getters and changed native signal behavior before I/O', async () => {
	let calls = 0; const options = {};
	Object.defineProperty(options, 'signal', { enumerable: true, get() { calls++; throw new Error('signal'); } });
	await assert.rejects(preparePhotoRasterBatchGraphicV1(request(), options), /data|accessor/iu);
	for (const key of ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener']) {
		const signal = new AbortController().signal;
		Object.defineProperty(signal, key, { get() { calls++; throw new Error(key); } });
		await assert.rejects(preparePhotoRasterBatchGraphicV1(request(), { signal }), /native|unmodified/iu);
	}
	const subclass = new AbortController().signal; Object.setPrototypeOf(subclass, Object.create(AbortSignal.prototype) as object);
	await assert.rejects(preparePhotoRasterBatchGraphicV1(request(), { signal: subclass }), /native|unmodified/iu);
	await assert.rejects(preparePhotoRasterBatchGraphicV1(request(), { unexpected: true } as object), /field/iu);
	assert.equal(calls, 0);
});

test('Light pre-cancel preserves an opaque native reason and cannot issue a prepared proof', async () => {
	const stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke(); stop.abort(reason.proxy);
	await rejectsOpaque(preparePhotoRasterBatchGraphicV1(request(), { signal: stop.signal }), reason.proxy);
	await rejectsOpaque(reselectPhotoRasterBatchGraphicV1(intent(), new Blob([ABC]), { signal: stop.signal }), reason.proxy);
});

test('Light held intrinsic hash read joins opaque cancellation and wipes its owned bytes', async context => {
	const original = Blob.prototype.arrayBuffer, entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const reason = Symbol('cancel held hash'); let buffer: ArrayBuffer | undefined;
	context.mock.method(Blob.prototype, 'arrayBuffer', async function (this: Blob) {
		buffer = await original.call(this); entered.resolve(); await release.promise; return buffer;
	});
	// Load an isolated owner while the strictly forwarding native-read witness
	// is installed; no production injection port is introduced for the test.
	const api = await import(new URL('../src/lightscaper/controller/photo-raster-export-batch-graphic-v1.ts?held-read', import.meta.url).href) as typeof import('../src/lightscaper/controller/photo-raster-export-batch-graphic-v1.ts');
	const body = new Blob([ABC]), pending = api.preparePhotoRasterBatchGraphicV1(request(body), { signal: stop.signal });
	await entered.promise; stop.abort(reason);
	Object.defineProperty(stop.signal, 'reason', { get() { throw new Error('late caller getter'); } });
	assert.equal(await remainsPending(pending), true); release.resolve();
	await assert.rejects(pending, error => Object.is(error, reason)); assert.ok(buffer);
	assert.deepEqual([...new Uint8Array(buffer)], [0, 0, 0]);
	assert.deepEqual(new Uint8Array(await original.call(body)), ABC);
});

test('Light successful native hash reads retire their delivered buffers and join multiple bounded spans', async context => {
	const original = Blob.prototype.arrayBuffer, buffers: ArrayBuffer[] = [];
	context.mock.method(Blob.prototype, 'arrayBuffer', async function (this: Blob) { const buffer = await original.call(this); buffers.push(buffer); return buffer; });
	const api = await import(new URL('../src/lightscaper/controller/photo-raster-export-batch-graphic-v1.ts?bounded-spans', import.meta.url).href) as typeof import('../src/lightscaper/controller/photo-raster-export-batch-graphic-v1.ts');
	const body = new Blob([new Uint8Array(4 * 1024 * 1024), ABC]), prepared = await api.preparePhotoRasterBatchGraphicV1(request(body));
	assert.equal(prepared.intent.byteLength, 4 * 1024 * 1024 + 3); assert.equal(buffers.length, 2);
	assert.deepEqual(buffers.map(buffer => buffer.byteLength), [4 * 1024 * 1024, 3]);
	assert.equal(buffers.every(buffer => new Uint8Array(buffer).every(value => value === 0)), true);
});

test('Light native hash rejection retains exact opaque failure without producing authority', async context => {
	const failure = Proxy.revocable({}, {}); failure.revoke();
	context.mock.method(Blob.prototype, 'arrayBuffer', () => Promise.reject(failure.proxy));
	const api = await import(new URL('../src/lightscaper/controller/photo-raster-export-batch-graphic-v1.ts?opaque-read', import.meta.url).href) as typeof import('../src/lightscaper/controller/photo-raster-export-batch-graphic-v1.ts');
	await rejectsOpaque(api.preparePhotoRasterBatchGraphicV1(request()), failure.proxy);
});

async function rejectsOpaque(operation: Promise<unknown>, reason: unknown): Promise<void> {
	await operation.then(() => assert.fail('Expected exact opaque rejection.'), error => { assert.equal(error, reason); });
}
