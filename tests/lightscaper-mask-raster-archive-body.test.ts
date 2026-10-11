/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { ScapeArchiveEntry, ScapeAssetDescriptor } from '../src/common/editor/scape-archive-envelope.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import type { BrushMaskResourceReferenceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { ScapeExpandedByteBudget } from '../src/common/editor/scape-expanded-byte-budget.ts';
import { borrowPhotoMaskRasterArchiveSourceV1 } from '../src/lightscaper/archive/mask-raster-archive-source-v1.ts';
import { readPhotoMaskRasterArchiveEntryV1 } from '../src/lightscaper/archive/mask-raster-archive-entry-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const BODY = new Uint8Array([83, 67, 77, 65, 83, 75, 48, 49, 2, 0, 0, 0, 1, 0, 0, 0, 0, 255]);
const sha256 = createHash('sha256').update(BODY).digest('hex');
const reference = Object.freeze({ storageKey: `brush-mask-v1:2:1:${sha256}`, sha256, width: 2, height: 1, byteLength: BODY.length });
const descriptor: ScapeAssetDescriptor = { sourceId: reference.storageKey, entry: `assets/masks/${sha256}.scmask`,
	kind: 'photo-mask-raster', encoding: 'lightscaper-mask-raster-v1', sha256, size: BODY.length };
function entry(body = BODY): ScapeArchiveEntry {
	return { filename: descriptor.entry, directory: false, encrypted: false, compressionMethod: 0, compressedSize: body.length, uncompressedSize: body.length,
		async getData(writable) { const writer = writable.getWriter(); try { for (const value of body) await writer.write(new Uint8Array([value]));
			await writer.close(); } finally { writer.releaseLock(); } } };
}
const budget = () => new ScapeExpandedByteBudget(1_048_592);

test('SCMASK01 extraction authenticates literal header/body and waits for native producer completion before delivery', async t => {
	const source = entry(), produced = deferred<void>(), entered = deferred<void>(), release = deferred<void>();
	const actual = source.getData!; let delivered = false, borrowed: Uint8Array | undefined;
	source.getData = async function (writable) { assert.equal(this, source); await Reflect.apply(actual, source, [writable]); await produced.promise; };
	const counter = budget(), work = readPhotoMaskRasterArchiveEntryV1(source, descriptor, counter, reference, async (ref, bytes) => {
		delivered = true; borrowed = bytes; assert.deepEqual(ref, reference); assert.deepEqual(bytes, BODY); entered.resolve(); await release.promise;
	});
	t.after(async () => { produced.resolve(); release.resolve(); await work.catch(() => undefined); });
	await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(delivered, false);
	produced.resolve(); await entered.promise; assert.equal(await remainsPending(work), true); release.resolve(); await work;
	assert.equal(counter.usedBytes, BODY.length); assert.ok(borrowed?.every(value => value === 0));
});

test('namespace, kind, geometry, size and independently corrupted body never reach writeMaskRaster', async () => {
	let delivered = 0; const corrupt = new Uint8Array(BODY); corrupt[17] = 254;
	for (const [asset, ref, body] of [[descriptor, reference, corrupt], [{ ...descriptor, size: BODY.length + 1 }, reference, BODY],
		[{ ...descriptor, sha256: '4'.repeat(64) }, reference, BODY], [{ ...descriptor, kind: 'audio' }, reference, BODY],
		[{ ...descriptor, entry: 'assets/masks/near.scmask' }, reference, BODY], [descriptor, { ...reference, width: 3 }, BODY]] as const) {
		await assert.rejects(readPhotoMaskRasterArchiveEntryV1(entry(body), asset, budget(), ref, async () => { delivered++; }));
	}
	assert.equal(delivered, 0);
	const wrongHeader = new Uint8Array(BODY); wrongHeader[8] = 3;
	const digest = createHash('sha256').update(wrongHeader).digest('hex'), ref = { ...reference, sha256: digest, storageKey: `brush-mask-v1:2:1:${digest}` };
	const asset = { ...descriptor, sourceId: ref.storageKey, sha256: digest, entry: `assets/masks/${digest}.scmask` };
	await assert.rejects(readPhotoMaskRasterArchiveEntryV1({ ...entry(wrongHeader), filename: asset.entry }, asset, budget(), ref, async () => { delivered++; }));
	assert.equal(delivered, 0);
	const counter = new ScapeExpandedByteBudget(BODY.length - 1);
	await assert.rejects(readPhotoMaskRasterArchiveEntryV1(entry(), descriptor, counter, reference, async () => { delivered++; }));
	assert.equal(delivered, 0);
});

test('borrowed encoded-body backing wipes after held cancellation without consulting shadowed buffer or opaque reason', async t => {
	const stop = new AbortController(), entered = deferred<void>(), release = deferred<void>(); let traps = 0, borrowed: Uint8Array | undefined;
	const reason = new Proxy({}, { get() { traps++; throw Error('Reason read'); }, getPrototypeOf() { traps++; throw Error('Reason prototype'); } });
	const outcome = readPhotoMaskRasterArchiveEntryV1(entry(), descriptor, budget(), reference, async (_ref, bytes) => {
		borrowed = bytes; Object.defineProperty(bytes, 'buffer', { get() { traps++; throw Error('Buffer read'); } }); entered.resolve(); await release.promise;
	}, stop.signal).then(() => ({ failed: false as const }), (error: unknown) => ({ failed: true as const, error }));
	t.after(async () => { release.resolve(); await outcome; });
	await entered.promise; stop.abort(reason); assert.equal(await remainsPending(outcome), true); release.resolve();
	const result = await outcome; assert.ok(result.failed); assert.equal(result.error, reason); assert.equal(traps, 0); assert.ok(borrowed?.every(value => value === 0));
});

test('source receiver/callable is pinned; ignored held body child joins and the private copy wipes', async t => {
	const entered = deferred<void>(), release = deferred<void>(); let reads = 0, traps = 0, borrowed: Uint8Array | undefined;
	const source: MaskRasterSourcePortV1 = { withBytes: new Proxy(async function<Result>(this: unknown, _reference: Readonly<BrushMaskResourceReferenceV1>,
		consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>): Promise<Result> {
		assert.equal(this, source); reads++; const work = Promise.resolve(consume(new Uint8Array(BODY))); void work.catch(() => undefined); return undefined as never;
	}, { get() { traps++; throw Error('Callable reflected'); } }) };
	const read = borrowPhotoMaskRasterArchiveSourceV1(source);
	const work = read(reference, async bytes => { borrowed = bytes; assert.deepEqual(bytes, BODY); entered.resolve(); await release.promise; });
	t.after(async () => { release.resolve(); await work.catch(() => undefined); });
	await entered.promise; source.withBytes = async () => { throw Error('Replacement used'); }; assert.equal(await remainsPending(work), true);
	release.resolve(); await work; await read(reference, async bytes => { assert.deepEqual(bytes, BODY); });
	assert.equal(reads, 2); assert.equal(traps, 0); assert.ok(borrowed?.every(value => value === 0));
});

test('swallowed duplicate delivery is latched; missing/late callbacks and body corruption remain refusals', async () => {
	const duplicate: MaskRasterSourcePortV1 = { async withBytes(_ref, consume) { const first = consume(new Uint8Array(BODY));
		await Promise.resolve(consume(new Uint8Array(BODY))).catch(() => undefined); return await first; } };
	await assert.rejects(borrowPhotoMaskRasterArchiveSourceV1(duplicate)(reference, async () => undefined), /repeat|retired/u);
	const late: { callback?: (bytes: Uint8Array<ArrayBuffer>) => Promise<unknown> } = {};
	const absent: MaskRasterSourcePortV1 = { async withBytes(_ref, consume) { late.callback = bytes => Promise.resolve(consume(bytes)); return undefined as never; } };
	await assert.rejects(borrowPhotoMaskRasterArchiveSourceV1(absent)(reference, async () => undefined), /without|missing/u);
	assert.ok(late.callback); await assert.rejects(late.callback(new Uint8Array(BODY)), /retired/u);
	const bad = new Uint8Array(BODY); bad[16] = 1;
	await assert.rejects(borrowPhotoMaskRasterArchiveSourceV1({ async withBytes(_ref, consume) { return await consume(bad); } })(reference, async () => undefined));
});

test('source replacing a failed forgotten child retains exact opaque child and distinct source cleanup once', async () => {
	const primary = Object.freeze({ child: true }), cleanup = Object.freeze({ source: true });
	const source: MaskRasterSourcePortV1 = { async withBytes(_ref, consume) { await Promise.resolve(consume(new Uint8Array(BODY))).catch(() => undefined); throw cleanup; } };
	let failure: unknown; try { await borrowPhotoMaskRasterArchiveSourceV1(source)(reference, async () => { throw primary; }); } catch (error) { failure = error; }
	assert.ok(failure instanceof AggregateError); assert.deepEqual(failure.errors, [primary, cleanup]); assert.equal(failure.cause, primary);
	const same: MaskRasterSourcePortV1 = { async withBytes(_ref, consume) { return await consume(new Uint8Array(BODY)); } };
	try { await borrowPhotoMaskRasterArchiveSourceV1(same)(reference, async () => { throw primary; }); } catch (error) { failure = error; }
	assert.equal(failure, primary);
});
