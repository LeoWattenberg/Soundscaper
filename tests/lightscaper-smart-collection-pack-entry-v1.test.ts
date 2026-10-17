/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { ScapeArchiveEntry, ScapeAssetDescriptor } from '../src/common/editor/scape-archive-envelope.ts';
import { ScapeExpandedByteBudget } from '../src/common/editor/scape-expanded-byte-budget.ts';
import { digestScapeBytes } from '../src/common/editor/scape-byte-stream.ts';
import { readPhotoSmartCollectionPackEntryV1 } from '../src/lightscaper/archive/smart-collection-pack-entry-v1.ts';
import { encodePhotoSmartCollectionPackV1 } from '../src/lightscaper/archive/smart-collection-pack-v1.ts';
import { normalizePhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';

const recipe = normalizePhotoSmartCollectionV1({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: 'catalog',
	id: 'saved', revision: 9, name: 'Metadata selection', query: { schemaVersion: 2, kind: 'photo-catalog-query', text: 'needle',
		filter: null, sort: { field: 'capture-time', direction: 'descending' }, predicate: { kind: 'text', column: 'lens', operator: 'equals', value: 'Lens' } } });
async function encoded() {
	const parts: Uint8Array<ArrayBuffer>[] = [];
	for await (const part of encodePhotoSmartCollectionPackV1([recipe])) parts.push(new Uint8Array(part));
	return new Uint8Array(await new Blob(parts).arrayBuffer());
}
function descriptor(bytes: Uint8Array): ScapeAssetDescriptor {
	return { sourceId: 'saved-pack', entry: 'assets/saved-collection-pack-000001.bin', kind: 'photo-smart-collection-pack',
		encoding: 'lightscaper-smart-collection-pack-v1', size: bytes.byteLength, sha256: digestScapeBytes(bytes) };
}
function entry(bytes: Uint8Array, emit?: (writer: WritableStreamDefaultWriter<Uint8Array>) => Promise<void>): ScapeArchiveEntry {
	return { filename: 'assets/saved-collection-pack-000001.bin', directory: false, encrypted: false, compressionMethod: 0,
		compressedSize: bytes.byteLength, uncompressedSize: bytes.byteLength, async getData(writable) {
			const writer = writable.getWriter(); try {
				if (emit) await emit(writer); else { await writer.write(bytes); await writer.close(); }
			} finally { writer.releaseLock(); }
		} };
}
function deferred<T>() {
	let resolve!: (value: T) => void; const promise = new Promise<T>(accept => { resolve = accept; }); return { promise, resolve };
}

test('authenticated saved entry preserves the complete recipe and exact descriptor digest/size', async () => {
	const bytes = await encoded(); let staged = 0;
	assert.equal(await readPhotoSmartCollectionPackEntryV1(entry(bytes), descriptor(bytes), new ScapeExpandedByteBudget(bytes.length),
		async value => { staged += 1; assert.deepEqual(value, recipe); }), 1);
	assert.equal(staged, 1);
});

test('trailer failure after staging remains joined and cannot fabricate authenticated success', { timeout: 2_000 }, async () => {
	const bytes = await encoded(), failure = new Error('saved entry trailer failed'); let staged = 0;
	await assert.rejects(readPhotoSmartCollectionPackEntryV1(entry(bytes, async writer => { await writer.write(bytes); throw failure; }),
		descriptor(bytes), new ScapeExpandedByteBudget(bytes.length), async () => { staged += 1; }), error => error === failure);
	assert.equal(staged, 1);
});

test('provisional staging failure unblocks extraction and preserves its exact identity', { timeout: 2_000 }, async () => {
	const bytes = await encoded(), failure = new Error('saved storage quota');
	await assert.rejects(readPhotoSmartCollectionPackEntryV1(entry(bytes), descriptor(bytes), new ScapeExpandedByteBudget(bytes.length),
		async () => { throw failure; }), error => error === failure);
});

test('digest, length, expanded-byte and actual4MiB emission bounds remain authoritative', async () => {
	const bytes = await encoded(), asset = descriptor(bytes);
	await assert.rejects(readPhotoSmartCollectionPackEntryV1(entry(bytes), { ...asset, sha256: '0'.repeat(64) },
		new ScapeExpandedByteBudget(bytes.length), async () => {}), /SHA-256/iu);
	await assert.rejects(readPhotoSmartCollectionPackEntryV1(entry(bytes), { ...asset, size: bytes.length + 1 },
		new ScapeExpandedByteBudget(bytes.length + 1), async () => {}), /length|size/iu);
	await assert.rejects(readPhotoSmartCollectionPackEntryV1(entry(bytes), asset, new ScapeExpandedByteBudget(bytes.length - 1), async () => {}), /expanded-byte/iu);
	const oversized = new Uint8Array(4 * 1024 * 1024 + 1);
	await assert.rejects(readPhotoSmartCollectionPackEntryV1(entry(oversized), descriptor(oversized),
		new ScapeExpandedByteBudget(oversized.length), async () => {}), /chunk bound/iu);
});

test('invalid consumer, native signal or descriptor capacity refuses before getData starts', async () => {
	const bytes = await encoded(), asset = descriptor(bytes); let started = 0;
	const source = entry(bytes, async writer => { started += 1; await writer.write(bytes); await writer.close(); });
	await assert.rejects(async () => await readPhotoSmartCollectionPackEntryV1(source, asset, new ScapeExpandedByteBudget(bytes.length),
		undefined as unknown as (value: typeof recipe) => Promise<void>));
	await assert.rejects(readPhotoSmartCollectionPackEntryV1(source, asset, new ScapeExpandedByteBudget(bytes.length), async () => {}, {} as AbortSignal));
	await assert.rejects(async () => await readPhotoSmartCollectionPackEntryV1(source, { ...asset, size: 8_388_609 },
		new ScapeExpandedByteBudget(8_388_609), async () => {})); assert.equal(started, 0);
});

test('cancel joins held consumer and genuine extraction settlement with opaque abort reason and late shadows', { timeout: 2_000 }, async () => {
	const bytes = await encoded(), stop = new AbortController(), consumed = deferred<void>(), release = deferred<void>();
	const producing = deferred<void>(), producerRelease = deferred<void>(); let settled = false, shadows = 0, traps = 0;
	const reason = new Proxy({}, { get() { traps += 1; throw new Error('reason accessed'); }, getPrototypeOf() { traps += 1; throw new Error('reason prototype'); } });
	const source = entry(bytes, async writer => { await writer.write(bytes); producing.resolve(); await producerRelease.promise; await writer.close(); });
	const task = readPhotoSmartCollectionPackEntryV1(source, descriptor(bytes), new ScapeExpandedByteBudget(bytes.length),
		async () => { consumed.resolve(); await release.promise; }, stop.signal);
	void task.then(() => { settled = true; }, () => { settled = true; }); await consumed.promise;
	Object.defineProperty(stop.signal, 'throwIfAborted', { get() { shadows += 1; throw new Error('signal shadow'); } });
	stop.abort(reason); await Promise.resolve(); assert.equal(settled, false); release.resolve(); await producing.promise;
	await Promise.resolve(); assert.equal(settled, false); producerRelease.resolve();
	let caught = false; try { await task; } catch (error) { caught = true; assert.equal(error, reason); }
	assert.equal(caught, true); assert.equal(traps + shadows, 0);
});

test('opaque cancellation plus distinct producer cleanup failure retains both without reason inspection', { timeout: 2_000 }, async () => {
	const bytes = await encoded(), stop = new AbortController(), entered = deferred<void>(), release = deferred<void>();
	const cleanup = new Error('native extraction cleanup failed'); let traps = 0;
	const reason = new Proxy({}, { get() { traps += 1; throw new Error('reason accessed'); }, getPrototypeOf() { traps += 1; throw new Error('reason prototype'); } });
	const source = entry(bytes, async writer => { await writer.write(bytes); await release.promise; throw cleanup; });
	const task = readPhotoSmartCollectionPackEntryV1(source, descriptor(bytes), new ScapeExpandedByteBudget(bytes.length),
		async () => { entered.resolve(); stop.abort(reason); release.resolve(); }, stop.signal);
	await entered.promise;
	let caught = false; try { await task; } catch (error) {
		caught = true; assert.ok(error instanceof AggregateError); assert.equal(error.errors[0], reason); assert.equal(error.errors[1], cleanup);
	}
	assert.equal(caught, true); assert.equal(traps, 0);
});

test('an independent consumer AbortError keeps the legacy aggregate cancellation name', { timeout: 2_000 }, async () => {
	const bytes = await encoded(), release = deferred<void>(), cleanup = new Error('Producer cleanup failed');
	const reason = new DOMException('Consumer cancelled', 'AbortError');
	const source = entry(bytes, async writer => { await writer.write(bytes); await release.promise; throw cleanup; });
	await assert.rejects(readPhotoSmartCollectionPackEntryV1(source, descriptor(bytes), new ScapeExpandedByteBudget(bytes.length),
		async () => { release.resolve(); throw reason; }), error => {
			assert.ok(error instanceof AggregateError); assert.equal(error.errors[0], reason); assert.equal(error.errors[1], cleanup);
			assert.equal(error.name, 'AbortError'); return true;
		});
});
