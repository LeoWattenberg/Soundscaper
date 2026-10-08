/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { MEDIA_ASSET_STREAM_CHUNK_BYTES } from '../src/common/editor/storage/media-asset-chunk-schema.ts';
import { createRepairFixture, assertNoRepairLease, reference, REPAIR_BYTES, REPAIR_DIGEST } from './helpers/media-catalog-original-repair-fixture.ts';

for (const layout of ['inline', 'chunks', 'opfs'] as const) {
	for (const provisional of [false, true]) {
		for (const missingRow of [false, true]) {
			test(`exact repair ${missingRow ? 'recreates' : 'updates'} ${layout} media under ${provisional ? 'provisional' : 'committed'} custody`, async context => {
				const f = await createRepairFixture(context, layout, provisional);
				const previous = f.row()!, roots = f.roots(), files = new Map(f.opfs.files);
				const previousChunkCount = f.indexedDB.recordCount(f.databaseName, 'mediaAssetChunks');
				if (missingRow) await f.removeRow();
				const receipt = await f.media.restoreCatalogOriginalBody(f.binding, new File([REPAIR_BYTES], 'Wrong replacement label.jpg', { type: 'image/jpeg' }));
				assert.deepEqual(receipt, { assetId: f.binding.assetId, sha256: REPAIR_DIGEST, size: REPAIR_BYTES.length });
				const current = f.row()!;
				assert.equal(current.mediaContentToken, previous.mediaContentToken);
				assert.equal(current.mediaContentDigestVersion, 1); assert.equal(current.catalogRootCount, 1);
				assert.equal(current.name, f.binding.name); assert.equal(current.mimeType, f.binding.mimeType);
				if (!missingRow) {
					assert.equal(current.note, previous.note); assert.equal(current.committedAt, previous.committedAt);
					assert.equal(current.pendingProjectUntil, previous.pendingProjectUntil); assert.equal(current.lastModified, previous.lastModified);
				}
				assert.deepEqual(f.roots(), roots);
				assertNoRepairLease(f);
				const body = await f.media.loadAsset(f.binding.assetId); assert.ok(body);
				assert.deepEqual(new Uint8Array(await body.arrayBuffer()), REPAIR_BYTES);
				for (const [path, oldBody] of files) assert.equal(f.opfs.files.get(path), oldBody);
				if (layout === 'chunks') assert.equal(f.indexedDB.recordCount(f.databaseName, 'mediaAssetChunks'), previousChunkCount + 1);
				if (layout === 'opfs') assert.notEqual(current.path, previous.path);
				else {
					assert.equal(current.storage, 'indexeddb-media-chunks-v1'); assert.notEqual(current.mediaChunkToken, previous.mediaChunkToken);
					assert.equal(current.mediaChunkBytes, MEDIA_ASSET_STREAM_CHUNK_BYTES); assert.equal(current.mediaChunkCount, 1);
					assert.equal(Object.hasOwn(current, 'blob'), false);
				}
			});
		}
	}
}

test('deduplicated committed and provisional roots retain distinct logical identities and reconstruct the actual count', async context => {
	const f = await createRepairFixture(context);
	await f.media.catalogOriginals.stage('other-catalog', 'other-import', [{ ...reference(f.binding), photoId: 'other-photo', sourceId: 'other-logical-original' }]);
	await f.removeRow(); const roots = f.roots();
	await f.media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES]));
	assert.equal(f.row()?.catalogRootCount, 2); assert.equal(f.row()?.mediaContentToken, roots[0]?.mediaContentToken);
	assert.deepEqual(f.roots(), roots);
});

test('existing-row repair preserves fresh metadata while recounting owners added during staging', async context => {
	const f = await createRepairFixture(context, 'opfs');
	const close = f.opfs.hold('close');
	const pending = f.media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES]));
	try {
		await close.entered;
		await f.media.catalogOriginals.retain('other-catalog', [{ ...reference(f.binding), photoId: 'other-photo', sourceId: 'other-original' }]);
		f.indexedDB.seedRecord(f.databaseName, 'mediaAssets', { ...f.row(), note: 'fresh metadata', catalogRootCount: 0 });
		const roots = f.roots(); close.release(); await pending;
		assert.equal(f.row()?.note, 'fresh metadata'); assert.equal(f.row()?.catalogRootCount, 2); assert.deepEqual(f.roots(), roots);
	} finally { close.release(); await pending.catch(() => undefined); }
});

test('all asset roots are bounded and validated beyond the first 64 within one publication transaction', async context => {
	const f = await createRepairFixture(context);
	for (let start = 0; start < 128; start += 16) await f.media.catalogOriginals.stage('other-catalog', 'import',
		Array.from({ length: 16 }, (_, offset) => ({ ...reference(f.binding), photoId: `photo-${String(start + offset).padStart(3, '0')}`, sourceId: `source-${start + offset}` })));
	f.transactions.length = 0;
	await f.media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES]));
	assert.equal(f.row()?.catalogRootCount, 129);
	const publications = f.transactions.filter(({ names, mode }) => mode === 'readwrite' && names.includes('mediaAssets') && names.includes('catalogOriginalRoots'));
	assert.equal(publications.length, 1); assert.ok(publications[0]?.names.includes('mediaAssetStaging'));
	assert.equal(f.indexedDB.stats.getAllRequests.some(({ store }: { store: string }) => store === 'catalogOriginalRoots'), false);
});

for (const mismatch of ['mediaContentToken', 'sha256', 'size'] as const) {
	test(`a divergent ${mismatch} root on page two refuses and removes closed staging`, async context => {
		const f = await createRepairFixture(context, 'opfs');
		for (let start = 0; start < 80; start += 16) await f.media.catalogOriginals.stage('other-catalog', 'import',
			Array.from({ length: 16 }, (_, offset) => ({ ...reference(f.binding), photoId: `z-${String(start + offset).padStart(3, '0')}` })));
		const close = f.opfs.hold('close'), previous = f.row(), paths = [...f.opfs.files.keys()];
		const pending = f.media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES]));
		try {
			await close.entered;
			const root = f.roots().at(-1)!;
			f.indexedDB.seedRecord(f.databaseName, 'catalogOriginalRoots', { ...root,
				[mismatch]: mismatch === 'mediaContentToken' ? 'media-content-aaaaaaaaaaaaaaaaaaaa' : mismatch === 'sha256' ? '0'.repeat(64) : 999 });
			const roots = f.roots(); close.release();
			await assert.rejects(pending, /identity|root/iu);
			assert.deepEqual(f.row(), previous); assert.deepEqual(f.roots(), roots); assert.deepEqual([...f.opfs.files.keys()], paths); assertNoRepairLease(f);
		} finally { close.release(); await pending.catch(() => undefined); }
	});
}

test('exact size and digest mismatch refuse before any new staging writes', async context => {
	const f = await createRepairFixture(context, 'opfs'); const previous = f.row(), roots = f.roots(), files = new Map(f.opfs.files);
	for (const blob of [new Blob(['short']), new Blob([Uint8Array.of(1, 3, 5, 9)])]) {
		f.transactions.length = 0;
		await assert.rejects(f.media.restoreCatalogOriginalBody(f.binding, blob), /size|digest|SHA/iu);
		assert.equal(f.transactions.some(({ mode }) => mode === 'readwrite'), false);
		assert.deepEqual(f.opfs.files, files); assert.deepEqual(f.row(), previous); assert.deepEqual(f.roots(), roots);
	}
});

test('missing selected root and mismatching present-row provenance refuse without staging', async context => {
	const f = await createRepairFixture(context); const previous = f.row();
	await assert.rejects(f.media.restoreCatalogOriginalBody({ ...f.binding, sourceId: 'wrong-logical-id' }, new Blob([REPAIR_BYTES])), /root|identity/iu);
	await assert.rejects(f.media.restoreCatalogOriginalBody({ ...f.binding, photoId: 'missing-photo' }, new Blob([REPAIR_BYTES])), /root/iu);
	f.indexedDB.seedRecord(f.databaseName, 'mediaAssets', { ...previous, mediaContentToken: 'media-content-aaaaaaaaaaaaaaaaaaaa' });
	await assert.rejects(f.media.restoreCatalogOriginalBody(f.binding, new Blob([REPAIR_BYTES])), /identity/iu);
	assertNoRepairLease(f); assert.equal(f.indexedDB.recordCount(f.databaseName, 'mediaAssetChunks'), 0);
});

test('repair requires inert closed binding data and a genuine Blob while bypassing selected File overrides', async context => {
	const f = await createRepairFixture(context); let reads = 0;
	const hostile = Object.defineProperty({ ...f.binding }, 'assetId', { enumerable: true, get() { reads++; return f.binding.assetId; } });
	await assert.rejects(f.media.restoreCatalogOriginalBody(hostile, new Blob([REPAIR_BYTES])), /data property/iu);
	await assert.rejects(f.media.restoreCatalogOriginalBody(f.binding, { size: 4, slice() { reads++; } }), /genuine Blob/iu);
	class HostileFile extends File { override get size() { reads++; return 0; } override slice(): never { reads++; throw new Error('hostile slice'); } }
	await f.media.restoreCatalogOriginalBody(f.binding, new HostileFile([REPAIR_BYTES], 'selected name'));
	assert.equal(reads, 0); assert.equal(f.row()?.name, f.binding.name);
});
test('genuine multi-chunk originals are hashed and staged through bounded four-MiB body reads', async context => {
	const f = await createRepairFixture(context);
	const bytes = new Uint8Array(4 * 1024 * 1024 + 19).fill(9), sha256 = createHash('sha256').update(bytes).digest('hex');
	const binding = { ...f.binding, assetId: 'large-original', photoId: 'large-photo', sourceId: 'large-logical', size: bytes.length, sha256 };
	await f.media.writeAsset(binding.assetId, new Blob([bytes]), { name: binding.name, mimeType: binding.mimeType });
	await f.media.catalogOriginals.retain(binding.catalogId, [reference(binding)]);
	const roots = f.roots(), spans: number[] = [], nativeRead = Blob.prototype.arrayBuffer;
	Blob.prototype.arrayBuffer = function () { spans.push(this.size); return nativeRead.call(this); };
	try { await f.media.restoreCatalogOriginalBody(binding, new Blob([bytes])); }
	finally { Blob.prototype.arrayBuffer = nativeRead; }
	assert.deepEqual(spans.slice(0, 2), [4 * 1024 * 1024, 19]);
	assert.ok(spans.length >= 4); assert.equal(Math.max(...spans), 4 * 1024 * 1024);
	assert.ok(spans.every(span => span > 0 && span <= 4 * 1024 * 1024));
	assert.deepEqual(f.roots(), roots); assertNoRepairLease(f);
	const loaded = await f.media.loadAsset(binding.assetId); assert.ok(loaded);
	assert.deepEqual(new Uint8Array(await loaded.arrayBuffer()), bytes);
});
