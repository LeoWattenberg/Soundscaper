/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoCatalogPackSequenceV2 } from '../src/lightscaper/archive/catalog-pack-sequence-v2.ts';
import { PhotoCatalogArchiveIdentityGuard } from '../src/lightscaper/archive/catalog-archive-contract.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { readValidatedPhotoCatalogRootV1 } from '../src/lightscaper/catalog/documents.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const root = readValidatedPhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1',
	name: 'Catalog', revision: 0, photoCount: 2, folders: [], keywords: [], collections: [] });

test('a held first next owns admission, refuses reentry and joins source retirement before Close', async () => {
	const entered = deferred<void>(), release = deferred<void>(), leave = deferred<void>(); let nexts = 0, returns = 0, traps = 0;
	const iterator = { next: new Proxy(async function (this: unknown) { assert.equal(this, iterator); nexts++; entered.resolve();
		await release.promise; return { done: false as const, value: photoArchiveFixture() }; }, { get() { traps++; throw Error('Callable reflected'); } }),
		async return() { returns++; await leave.promise; return { done: true as const, value: undefined }; } };
	const sequence = new PhotoCatalogPackSequenceV2({ [Symbol.asyncIterator]() { return iterator; } }, new PhotoCatalogArchiveIdentityGuard(root));
	const first = sequence.nextPack(); void first.catch(() => undefined); await entered.promise;
	await assert.rejects(sequence.nextPack(), /Drain/); const close = sequence.close(); assert.equal(await remainsPending(close), true);
	release.resolve(); await assert.rejects(first, /retired/); assert.equal(await remainsPending(close), true);
	leave.resolve(); await close; assert.equal(nexts, 1); assert.equal(returns, 1); assert.equal(traps, 0);
	await assert.rejects(sequence.nextPack(), /retired/);
});

test('one pack preserves admitted mixed records and identity/refusal checks with a single lookahead', async () => {
	const old = photoArchiveFixture(), input = photoArchiveFixture(2), first = input.photo.versions[0]!;
	const current = { ...input, photo: normalizePhotoDocumentV2({ ...input.photo, schemaVersion: 2,
		versions: [{ ...first, develop: { ...first.develop, processVersion: 2, effects: [] } }] }) };
	let reads = 0; const source = { async *[Symbol.asyncIterator]() { for (const record of [old, current]) { reads++; yield record; } } };
	const sequence = new PhotoCatalogPackSequenceV2(source, new PhotoCatalogArchiveIdentityGuard(root)), pack = await sequence.nextPack();
	assert.equal(reads, 1); assert.ok(pack); const records = []; for await (const record of pack) records.push(record);
	assert.deepEqual(records.map(value => value.photo), [old.photo, current.photo]);
	assert.deepEqual(await Promise.all(records.map(async value => new Uint8Array(await value.original.arrayBuffer()))),
		await Promise.all([old, current].map(async value => new Uint8Array(await value.original.arrayBuffer()))));
	assert.equal(reads, 2); assert.equal(await sequence.nextPack(), null); await sequence.close();
	const duplicate = new PhotoCatalogPackSequenceV2([old, old], new PhotoCatalogArchiveIdentityGuard(root));
	const values = await duplicate.nextPack(); assert.ok(values); await assert.rejects(async () => { for await (const _value of values) { /* drain */ } }, /duplicate/); await duplicate.close();
});

test('captured native cancellation survives held next and leaves distinct retirement evidence to Close', async () => {
	const stop = new AbortController(), entered = deferred<void>(), release = deferred<void>(); let traps = 0;
	const primary = new Proxy({}, { get() { traps++; throw Error('Reason inspected'); }, getPrototypeOf() { traps++; throw Error('Prototype inspected'); } });
	const cleanup = Object.freeze({ cleanup: true });
	const sequence = new PhotoCatalogPackSequenceV2({ [Symbol.asyncIterator]() { return { async next() { entered.resolve(); await release.promise;
		return { done: false as const, value: photoArchiveFixture() }; }, async return() { throw cleanup; } }; } }, new PhotoCatalogArchiveIdentityGuard(root), stop.signal);
	let failure: unknown; const work = sequence.nextPack().catch((error: unknown) => { failure = error; }); await entered.promise;
	stop.abort(primary); assert.equal(await remainsPending(work), true); release.resolve(); await work; assert.equal(failure, primary);
	try { await sequence.close(); } catch (error) { failure = error; } assert.equal(failure, cleanup); assert.equal(traps, 0);
});
