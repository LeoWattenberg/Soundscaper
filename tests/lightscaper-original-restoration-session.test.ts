/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { photoImportIntentKeyV1 } from '../src/lightscaper/import/import-intent-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { originalRestorationFixture } from './helpers/lightscaper-original-restoration-fixture.ts';

for (const provisional of [false, true]) {
	test(`Session exact restoration reconstructs a missing row under ${provisional ? 'published provisional' : 'committed'} custody before ordinary recovery`, async context => {
		const f = await originalRestorationFixture(context, provisional), target = await f.target();
		await f.removeMediaRow();
		if (provisional) await assert.rejects(f.session.readPage(), /verified durable media/iu);
		const catalog = await f.catalog.readSnapshot('catalog-1'), photo = await f.catalog.loadPhoto('catalog-1', 'photo-1');
		const roots = f.backing.records(f.mediaName, 'catalogOriginalRoots'), intent = await f.intent();
		const result = await f.session.restoreOriginalBody(target, new File([f.source.original], 'wrong label.jpg', { type: 'image/jpeg' }));
		assert.deepEqual(result, { photoId: 'photo-1', assetId: 'original-1', sha256: target.binding.sha256, size: 3, notices: [] });
		assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.notices), true);
		assert.deepEqual(await f.catalog.readSnapshot('catalog-1'), catalog); assert.deepEqual(await f.catalog.loadPhoto('catalog-1', 'photo-1'), photo);
		assert.deepEqual(f.backing.records(f.mediaName, 'catalogOriginalRoots'), roots); assert.deepEqual(await f.intent(), intent);
		assert.equal(f.active(), false);
		const row = f.backing.records(f.mediaName, 'mediaAssets')[0] as Record<string, unknown>;
		assert.equal(row.mediaContentToken, (roots[0] as Record<string, unknown>).mediaContentToken);
		assert.equal(row.name, target.binding.name); assert.equal(row.mimeType, target.binding.mimeType);
		assert.equal((await f.session.readPage()).rows[0]?.id, 'photo-1');
		assert.equal(await f.intent(), undefined);
		const recovered = await f.media.mediaRepository.catalogOriginals.readPage({ catalogId: 'catalog-1' });
		assert.equal(recovered.roots.length, 1); assert.equal(recovered.roots[0]?.mediaContentToken, row.mediaContentToken);
		assert.deepEqual(await f.catalog.readSnapshot('catalog-1'), catalog); assert.deepEqual(await f.catalog.loadPhoto('catalog-1', 'photo-1'), photo);
	});
}

test('stale catalog, photo, active intent and every immutable binding field refuse before any selected body read', async context => {
	const f = await originalRestorationFixture(context), target = await f.target(), originalRead = Blob.prototype.arrayBuffer;
	let reads = 0; Blob.prototype.arrayBuffer = function () { reads++; return originalRead.call(this); };
	try {
		const stale = [{ ...target, catalogRevision: target.catalogRevision + 1 }, { ...target, photoRevision: target.photoRevision + 1 },
			{ ...target, activeImportId: 'other-import' }];
		for (const candidate of stale) await assert.rejects(f.session.restoreOriginalBody(candidate, f.source.original));
		const changes = { catalogId: 'other-catalog', importId: 'other-import', photoId: 'other-photo', assetId: 'other-asset',
			sourceId: 'other-source', sha256: 'f'.repeat(64), size: 4, name: 'different.png', mimeType: 'image/jpeg' };
		for (const [field, value] of Object.entries(changes)) await assert.rejects(f.session.restoreOriginalBody({ ...target,
			binding: { ...target.binding, [field]: value } }, f.source.original));
		assert.equal(reads, 0); assert.equal(f.calls.includes('restore'), false);
		assert.equal(f.backing.recordCount(f.mediaName, 'mediaAssetChunks'), 0);
	} finally { Blob.prototype.arrayBuffer = originalRead; }
});

test('fresh durable catalog and photo changes after capture refuse before original selection bytes', async context => {
	const f = await originalRestorationFixture(context), target = await f.target();
	const root = await f.catalog.loadCatalog('catalog-1'); assert.ok(root);
	await f.catalog.saveCatalog(normalizePhotoCatalogRootV1({ ...root, name: 'Changed catalog' }), root.revision);
	await assert.rejects(f.session.restoreOriginalBody(target, f.source.original), /catalog.*revision/iu);
	const next = await f.target(), photo = await f.catalog.loadPhoto('catalog-1', 'photo-1'); assert.ok(photo);
	await f.catalog.savePhoto({ ...photo, rating: 5 }, photo.revision);
	await assert.rejects(f.session.restoreOriginalBody(next, f.source.original), /photo.*revision/iu);
	assert.equal(f.calls.includes('restore'), false);
});

test('new or corrupt durable import intent refuses without weakening the normal recovery parser', async context => {
	const f = await originalRestorationFixture(context), target = await f.target();
	const key = photoImportIntentKeyV1('catalog-1');
	for (const value of [{ schemaVersion: 1, kind: 'photo-import', catalogId: 'catalog-1', importId: 'new-import' },
		{ schemaVersion: 2, kind: 'photo-import', catalogId: 'catalog-1', importId: 'new-import' }, null]) {
		await f.media.settingsRepository.put(key, value);
		await assert.rejects(f.session.restoreOriginalBody(target, f.source.original));
	}
	assert.equal(f.calls.includes('restore'), false);
});

test('wrong selected size or same-size digest cannot change originals, documents or custody', async context => {
	const f = await originalRestorationFixture(context), target = await f.target(); await f.removeMediaRow();
	const roots = f.backing.records(f.mediaName, 'catalogOriginalRoots'), photo = await f.catalog.loadPhoto('catalog-1', 'photo-1');
	await assert.rejects(f.session.restoreOriginalBody(target, new Blob(['short'])), /size/iu);
	await assert.rejects(f.session.restoreOriginalBody(target, new Blob([Uint8Array.of(1, 2, 4)])), /SHA-256/iu);
	assert.equal(f.backing.recordCount(f.mediaName, 'mediaAssets'), 0); assert.equal(f.backing.recordCount(f.mediaName, 'mediaAssetChunks'), 0);
	assert.deepEqual(f.backing.records(f.mediaName, 'catalogOriginalRoots'), roots); assert.deepEqual(await f.catalog.loadPhoto('catalog-1', 'photo-1'), photo);
});

test('closed admission rejects getters, unknown target/options fields and fake native signals before initialization', async context => {
	const f = await originalRestorationFixture(context), target = await f.target(); f.calls.length = 0; let getters = 0;
	const hostile = Object.defineProperty({ ...target }, 'catalogRevision', { enumerable: true, get() { getters++; throw new Error('getter'); } });
	for (const candidate of [hostile, { ...target, extra: true }, { ...target, schemaVersion: 2 }]) await assert.rejects(f.session.restoreOriginalBody(candidate as never, f.source.original));
	await assert.rejects(f.session.restoreOriginalBody(target, f.source.original, { signal: {} as AbortSignal }));
	await assert.rejects(f.session.restoreOriginalBody(target, f.source.original, { extra: true } as never));
	delete f.ports.originalRestoration; await assert.rejects(f.session.restoreOriginalBody(target, f.source.original), /unavailable/iu);
	assert.equal(getters, 0); assert.deepEqual(f.calls, []);
});

for (const heldRead of [1, 3]) {
	test(`close joins ${heldRead === 1 ? 'preflight hashing' : 'persisted staging encoding'} and the repair lease before closing storage`, async context => {
		const f = await originalRestorationFixture(context), target = await f.target(), held = deferred<void>(), entered = deferred<void>();
		const nativeRead = Blob.prototype.arrayBuffer; let reads = 0;
		Blob.prototype.arrayBuffer = async function () { if (++reads === heldRead) { entered.resolve(); await held.promise; } return nativeRead.call(this); };
		const work = f.session.restoreOriginalBody(target, f.source.original), settled = work.catch(() => undefined);
		try {
			await entered.promise; assert.equal(f.active(), true);
			await assert.rejects(f.session.restoreOriginalBody(target, f.source.original), /already pending/iu);
			await assert.rejects(f.session.setRating('photo-1', 5), /already pending/iu);
			const closing = f.session.close(); assert.equal(await remainsPending(closing), true); assert.equal(f.calls.includes('close'), false);
			held.resolve(); await assert.rejects(work, { name: 'AbortError' }); await closing;
			assert.equal(f.active(), false); assert.equal(f.calls.at(-1), 'close');
			const stages = f.backing.records(f.mediaName, 'mediaAssetStaging') as Array<Record<string, unknown>>;
			assert.equal(stages.filter(row => row.kind === 'lease').length, 0); assert.equal(f.backing.recordCount(f.mediaName, 'mediaAssetChunks'), 0);
		} finally { held.resolve(); Blob.prototype.arrayBuffer = nativeRead; await settled; }
	});
}

test('durable restoration survives late cancellation and failed catalog lease cleanup with a scalar notice', async context => {
	const f = await originalRestorationFixture(context, true), target = await f.target(), stop = new AbortController();
	await f.removeMediaRow();
	f.cleanup(async () => { stop.abort(); throw new Error('lease cleanup failed after durable repair'); });
	const result = await f.session.restoreOriginalBody(target, f.source.original, { signal: stop.signal });
	assert.deepEqual(result.notices, ['cleanup-failed']); assert.equal(Object.isFrozen(result.notices), true);
	assert.equal(f.backing.recordCount(f.mediaName, 'mediaAssets'), 1); assert.equal(f.backing.recordCount(f.mediaName, 'mediaAssetChunks'), 1);
	assert.equal(f.active(), false); assert.deepEqual(Object.keys(result).sort(), ['assetId', 'notices', 'photoId', 'sha256', 'size']);
	f.cleanup(async () => undefined); assert.equal((await f.session.readPage()).rows.length, 1); assert.equal(await f.intent(), undefined);
});

test('a held post-ACK lease release remains owned through close and preserves the successful receipt', async context => {
	const f = await originalRestorationFixture(context), target = await f.target(), held = deferred<void>(), entered = deferred<void>();
	f.cleanup(async () => { entered.resolve(); await held.promise; });
	const work = f.session.restoreOriginalBody(target, f.source.original), settled = work.catch(() => undefined);
	try {
		await entered.promise; assert.equal(f.backing.recordCount(f.mediaName, 'mediaAssetChunks'), 1);
		const closing = f.session.close(); assert.equal(await remainsPending(closing), true); assert.equal(f.calls.includes('close'), false);
		held.resolve(); assert.deepEqual((await work).notices, []); await closing; assert.equal(f.calls.at(-1), 'close');
	} finally { held.resolve(); await settled; }
});

test('restoration retires a previously ready cache so later normal recovery promotes newly retained provisional custody', async context => {
	const f = await originalRestorationFixture(context); await f.session.readPage();
	await f.media.mediaRepository.catalogOriginals.stage('catalog-1', 'later-import', [{ photoId: 'photo-1',
		sourceId: f.source.photo.original.id, assetId: f.source.photo.original.storageKey,
		sha256: f.source.photo.original.contentSha256, size: f.source.original.size }]);
	await f.media.settingsRepository.put(photoImportIntentKeyV1('catalog-1'), { schemaVersion: 1, kind: 'photo-import', catalogId: 'catalog-1', importId: 'later-import' });
	const target = await f.target(); await f.removeMediaRow();
	await f.session.restoreOriginalBody(target, f.source.original);
	assert.ok(await f.intent()); assert.equal(f.backing.recordCount(f.mediaName, 'catalogOriginalRoots'), 2);
	await f.session.readPage(); assert.equal(await f.intent(), undefined);
	assert.equal(f.backing.recordCount(f.mediaName, 'catalogOriginalRoots'), 1);
});

test('a current full photo aggregate is validated and linked originals refuse before the shared body repair port', async context => {
	const f = await originalRestorationFixture(context), target = await f.target(), load = f.catalog.loadPhoto;
	try {
		for (const value of [{ ...f.source.photo, schemaVersion: 2 }, { ...f.source.photo, catalogId: 'foreign' },
			{ ...f.source.photo, metadata: { ...f.source.photo.metadata, rating: 9 } },
			{ ...f.source.photo, original: { ...f.source.photo.original, retention: 'linked' } }, null]) {
			f.catalog.loadPhoto = async () => value as never;
			await assert.rejects(f.session.restoreOriginalBody(target, f.source.original));
		}
		assert.equal(f.calls.includes('restore'), false);
	} finally { f.catalog.loadPhoto = load; }
});
