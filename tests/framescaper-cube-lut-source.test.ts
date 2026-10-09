/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import { createFramescaperCubeLutSourceFinishing } from '../src/framescaper/cube-lut-source-finishing.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const TEXT = 'LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1';
const BODY = new TextEncoder().encode(TEXT), PARSED = parseCubeLutV1(TEXT);
const REF = { storageKey: `lut-sha256:${PARSED.sha256}`, sha256: PARSED.sha256, byteLength: PARSED.byteLength,
	size: PARSED.size, domainMin: PARSED.domainMin, domainMax: PARSED.domainMax };
const blob = (bytes = BODY) => new Blob([new Uint8Array(bytes)]);
function opaque() {
	let traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('opaque get'); }, getPrototypeOf() { traps++; throw Error('opaque prototype'); },
		getOwnPropertyDescriptor() { traps++; throw Error('opaque descriptor'); } });
	return { reason, traps: () => traps };
}
const outcome = <Value>(promise: Promise<Value>) => promise.then(value => ({ failed: false as const, value }),
	(error: unknown) => ({ failed: true as const, error }));

test('one exact native body is authenticated and borrowed until consumer settlement, then raw backing is wiped', async () => {
	let loads = 0; const store = { async loadMediaAsset(key: string) { assert.equal(this, store); assert.equal(key, REF.storageKey); loads++; return blob(); } };
	const source = createFramescaperCubeLutSourceFinishing(store), entered = deferred<void>(), held = deferred<void>();
	let raw: Uint8Array | undefined;
	const work = source.withBytes(REF, async bytes => { raw = bytes; assert.deepEqual(bytes, BODY); entered.resolve(); await held.promise; return 'delivered'; });
	await entered.promise; const closing = source.close(); assert.equal(source.close(), closing);
	assert.equal(await remainsPending(closing), true); assert.equal(await remainsPending(work), true);
	held.resolve(); assert.equal(await work, 'delivered'); await closing;
	assert.equal(loads, 1); assert.equal(raw?.every(value => value === 0), true);
	await assert.rejects(source.withBytes(REF, () => undefined), /closed/iu);
});

test('the callable, receiver and complete reference are pinned before acquisition without reading bind or Blob shadows', async () => {
	const release = deferred<Blob>(), entered = deferred<void>(); let calls = 0, traps = 0;
	const store = { loadMediaAsset: new Proxy(function (this: unknown, key: string) {
		assert.equal(this, store); assert.equal(key, REF.storageKey); calls++; entered.resolve(); return release.promise;
	}, { get() { traps++; throw Error('function metadata read'); } }) };
	const source = createFramescaperCubeLutSourceFinishing(store), ref = { ...REF, domainMin: [...REF.domainMin] as [number, number, number] };
	const work = source.withBytes(ref, bytes => assert.deepEqual(bytes, BODY)); await entered.promise;
	store.loadMediaAsset = () => { throw Error('replacement used'); }; ref.domainMin[0] = -1;
	const asset = blob(); Object.defineProperty(asset, 'arrayBuffer', { get() { traps++; throw Error('Blob method shadow'); } });
	release.resolve(asset); await work; await source.close(); assert.equal(calls, 1); assert.equal(traps, 0);
});

test('missing, wrong native size, digest and parser geometry refuse before body delivery while preserving source bytes', async () => {
	let delivered = 0; const bad = new Uint8Array(BODY); bad[bad.length - 1] = 48;
	for (const asset of [null, blob(new Uint8Array(BODY.length + 1)), blob(bad)]) {
		const source = createFramescaperCubeLutSourceFinishing({ async loadMediaAsset() { return asset; } });
		await assert.rejects(source.withBytes(REF, () => { delivered++; })); await source.close();
	}
	const source = createFramescaperCubeLutSourceFinishing({ async loadMediaAsset() { return blob(); } });
	await assert.rejects(source.withBytes({ ...REF, domainMax: [2, 1, 1] }, () => { delivered++; })); await source.close();
	assert.equal(delivered, 0); assert.deepEqual(new TextEncoder().encode(TEXT), BODY);
});

test('overlap refuses before borrowed reflection and Close joins held opaque cancellation without swallowing the operation reason', async () => {
	const held = deferred<void>(), entered = deferred<void>(), failure = opaque(), stop = new AbortController();
	const source = createFramescaperCubeLutSourceFinishing({ async loadMediaAsset() { return blob(); } });
	let raw: Uint8Array | undefined, inspected = 0;
	const work = outcome(source.withBytes(REF, async bytes => { raw = bytes; entered.resolve(); await held.promise; }, { signal: stop.signal }));
	await entered.promise;
	await assert.rejects(source.withBytes(new Proxy(REF, { ownKeys() { inspected++; throw Error('overlap read'); } }), () => undefined), /overlap|active/iu);
	stop.abort(failure.reason); const closing = source.close(); assert.equal(await remainsPending(closing), true);
	held.resolve(); const result = await work; assert.equal(result.failed, true); if (result.failed) assert.equal(result.error, failure.reason);
	await closing; assert.equal(raw?.every(value => value === 0), true); assert.equal(inspected, 0); assert.equal(failure.traps(), 0);
});

test('native cold refusal precedes reference traversal and synchronous source reentry cannot open a second body', async () => {
	const failure = opaque(), stop = new AbortController(); stop.abort(failure.reason); let inspected = 0, loads = 0;
	const source = createFramescaperCubeLutSourceFinishing({ async loadMediaAsset() { loads++; return blob(); } });
	const result = await outcome(source.withBytes(new Proxy(REF, { ownKeys() { inspected++; throw Error('cold reference read'); } }), () => undefined, { signal: stop.signal }));
	assert.equal(result.failed, true); if (result.failed) assert.equal(result.error, failure.reason);
	assert.equal(inspected, 0); assert.equal(loads, 0); assert.equal(failure.traps(), 0); await source.close();
	let reentry: Promise<unknown> | undefined;
	const reentrant = createFramescaperCubeLutSourceFinishing({ async loadMediaAsset() {
		loads++; reentry = outcome(reentrant.withBytes(new Proxy(REF, { ownKeys() { inspected++; throw Error('reentry read'); } }), () => undefined)); return blob();
	} });
	await reentrant.withBytes(REF, () => undefined); assert.ok(reentry); assert.equal((await reentry as { failed: boolean }).failed, true);
	assert.equal(loads, 1); assert.equal(inspected, 0); await reentrant.close();
});

test('Close during closed reference reflection refuses before native body acquisition', async () => {
	let loads = 0, closing: Promise<void> | undefined;
	const source = createFramescaperCubeLutSourceFinishing({ async loadMediaAsset() { loads++; return blob(); } });
	const ref = new Proxy(REF, { ownKeys(target) { closing = source.close(); return Reflect.ownKeys(target); } });
	await assert.rejects(source.withBytes(ref, () => undefined), /closed|retired/iu);
	assert.equal(loads, 0); assert.ok(closing); await closing;
});
