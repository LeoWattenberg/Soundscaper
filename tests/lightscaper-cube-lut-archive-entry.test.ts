/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { readPhotoCubeLutArchiveEntryV1 } from '../src/lightscaper/archive/cube-lut-archive-entry-v1.ts';
import type { ScapeArchiveEntry, ScapeAssetDescriptor } from '../src/common/editor/scape-archive-envelope.ts';
import { ScapeExpandedByteBudget } from '../src/common/editor/scape-expanded-byte-budget.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const BODY = new TextEncoder().encode('LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n');
const sha256 = createHash('sha256').update(BODY).digest('hex');
const reference = { storageKey: `lut-sha256:${sha256}`, sha256, byteLength: BODY.length, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
const descriptor: ScapeAssetDescriptor = { sourceId: reference.storageKey, entry: `assets/luts/${sha256}.cube`, kind: 'photo-cube-lut',
	encoding: 'lightscaper-cube-utf8-v1', sha256, size: BODY.length };
function entry(body = BODY): ScapeArchiveEntry {
	return { filename: descriptor.entry, directory: false, encrypted: false, compressionMethod: 0, compressedSize: body.length, uncompressedSize: body.length,
		async getData(writable) { const writer = writable.getWriter(); try { for (const value of body) await writer.write(new Uint8Array([value]));
			await writer.close(); } finally { writer.releaseLock(); } } };
}
const budget = () => new ScapeExpandedByteBudget(16_777_216);

test('exact UTF8 body/parser/digest proof and extractor completion precede delivery; raw copy wipes after the held consumer', async () => {
	const entered = deferred<void>(), release = deferred<void>(), produced = deferred<void>(), source = entry(); let output: Uint8Array | undefined, delivered = false;
	const getData = source.getData!; source.getData = async function (target, options) { assert.equal(this, source); await Reflect.apply(getData, source, [target, options]); await produced.promise; };
	const work = readPhotoCubeLutArchiveEntryV1(source, descriptor, budget(), reference, async (ref, body) => {
		delivered = true; assert.deepEqual(ref, reference); assert.deepEqual(body, BODY); output = body; entered.resolve(); await release.promise;
	});
	await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(delivered, false); produced.resolve(); await entered.promise;
	assert.equal(await remainsPending(work), true); release.resolve(); await work; assert.ok(output); assert.ok(output.every(value => value === 0));
});

test('body corruption, exact namespace/geometry and descriptor sizes refuse before provisional writeLut', async () => {
	let calls = 0; const consume = async () => { calls++; }, bad = new Uint8Array(BODY); bad[bad.length - 2] = 48;
	for (const [asset, ref, bytes] of [[descriptor, reference, bad], [{ ...descriptor, size: BODY.length + 1 }, reference, BODY],
		[{ ...descriptor, sha256: '4'.repeat(64) }, reference, BODY], [{ ...descriptor, kind: 'audio' }, reference, BODY],
		[descriptor, { ...reference, domainMax: [2, 1, 1] }, BODY], [{ ...descriptor, entry: 'assets/luts/other.cube' }, reference, BODY]] as const) {
		await assert.rejects(readPhotoCubeLutArchiveEntryV1(entry(bytes), asset, budget(), ref, consume));
	}
	assert.equal(calls, 0);
});

test('pinned extractor callable/receiver survive replacements and borrowed bind tripwires', async () => {
	const started = deferred<void>(), release = deferred<void>(), source = entry(); let traps = 0, calls = 0;
	const original = source.getData!; source.getData = new Proxy(async function (this: unknown, writable: WritableStream<Uint8Array>) {
		assert.equal(this, source); calls++; started.resolve(); await release.promise; return Reflect.apply(original, source, [writable]);
	}, { get() { traps++; throw Error('Borrowed function reflected'); } });
	const work = readPhotoCubeLutArchiveEntryV1(source, descriptor, budget(), reference, async () => undefined);
	await started.promise; source.getData = async () => { throw Error('Replaced extractor'); }; release.resolve(); await work;
	assert.equal(calls, 1); assert.equal(traps, 0);
});

test('held native cancellation joins producer/consumer and wipes the captured backing without reason inspection', async () => {
	const stop = new AbortController(), entered = deferred<void>(), release = deferred<void>(); let output: Uint8Array | undefined, traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('Reason inspected'); }, getPrototypeOf() { traps++; throw Error('Reason prototype'); } });
	let failure: unknown; const work = readPhotoCubeLutArchiveEntryV1(entry(), descriptor, budget(), reference, async (_ref, body) => {
		output = body; Object.defineProperty(body, 'buffer', { get() { throw Error('Shadowed buffer used'); } }); entered.resolve(); await release.promise;
	}, stop.signal).catch((error: unknown) => { failure = error; });
	await entered.promise; stop.abort(reason); assert.equal(await remainsPending(work), true); release.resolve(); await work;
	assert.equal(failure, reason); assert.ok(output?.every(value => value === 0)); assert.equal(traps, 0);
});

test('extractor failure after actual writes never delivers a body and native cold refusal never invokes getData', async () => {
	const source = entry(); const original = source.getData!; const reason = Object.freeze({ native: true }); let calls = 0, delivered = 0;
	source.getData = async target => { calls++; await Reflect.apply(original, source, [target]); throw reason; };
	let failure: unknown; try { await readPhotoCubeLutArchiveEntryV1(source, descriptor, budget(), reference, async () => { delivered++; }); }
	catch (error) { failure = error; } assert.equal(failure, reason); assert.equal(delivered, 0);
	const stop = new AbortController(); stop.abort(reason);
	try { await readPhotoCubeLutArchiveEntryV1(source, descriptor, budget(), reference, async () => undefined, stop.signal); } catch (error) { failure = error; }
	assert.equal(failure, reason); assert.equal(calls, 1);
});
