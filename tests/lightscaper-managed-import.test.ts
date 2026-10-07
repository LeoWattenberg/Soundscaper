/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { importManagedPhotosV1, recoverManagedPhotoImportV1, photoImportIntentKeyV1, type PhotoManagedImportPortsV1 } from '../src/lightscaper/import/managed-import-v1.ts';
import { catalogOriginalPhotoIds, catalogOriginalReferences, type CatalogOriginalRootV1 } from '../src/common/editor/storage/media-catalog-original-schema.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import type { PhotoDocumentV1 } from '../src/lightscaper/catalog/types.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

function fixture() {
	let root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog-1', name: 'Library', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	const photos = new Map<string, PhotoDocumentV1>();
	const assets = new Map<string, { blob: Blob; sha256: string; size: number }>();
	const roots = new Map<string, CatalogOriginalRootV1>();
	const journal = new Map<string, unknown>();
	const events: string[] = [];
	const recoveryBatches: number[] = [];
	let recoveryPages = 0;
	let fail: 'write' | 'stage-after' | 'publish-before' | 'publish-after' | 'promote' | 'retire' | null = null;
	let boundary: ((phase: string) => void) | null = null;
	const ports: PhotoManagedImportPortsV1 = {
		createImportId: () => 'import-1',
		exclusive: async (_id, operation, signal) => operation(signal),
		catalog: {
			loadCatalog: async () => root,
			loadPhoto: async (_catalogId, photoId) => photos.get(photoId) ?? null,
			publishPhotos: async (_catalogId, expectedRevision, values) => {
				assert.equal(root.revision, expectedRevision);
				if (fail === 'publish-before') { fail = null; throw new Error('publication refused'); }
				for (const value of values) { const photo = normalizePhotoDocumentV1(value); photos.set(photo.id, photo); }
				root = normalizePhotoCatalogRootV1({ ...root, revision: root.revision + 1, photoCount: root.photoCount + values.length });
				events.push('publish'); boundary?.('publish');
				if (fail === 'publish-after') { fail = null; throw new Error('commit acknowledgement failed'); }
				return root;
			},
		},
		journal: {
			get: async (key) => journal.get(key),
			putIfAbsent: async (key, value) => { if (journal.has(key)) return false; journal.set(key, value); events.push('intent'); return true; },
			deleteIfCurrent: async (key, value) => {
				assert.deepEqual(journal.get(key), value);
				if (fail === 'retire') { fail = null; throw new Error('intent retirement failed'); }
				journal.delete(key); events.push('retire'); return true;
			},
		},
		media: {
			writeAsset: async (assetId, input) => {
				if (fail === 'write') { fail = null; throw new Error('storage quota exceeded'); }
				assert.ok(input instanceof Blob);
				const sha256 = createHash('sha256').update(new Uint8Array(await input.arrayBuffer())).digest('hex');
				const value = { blob: input, sha256, size: input.size };
				assert.equal(assets.has(assetId), false); assets.set(assetId, value); events.push('write');
				return { sha256, size: value.size };
			},
			custody: {
				findDigestPage: async (sha256) => ({ matches: [...assets].filter(([, asset]) => asset.sha256 === sha256)
					.map(([assetId, asset]) => ({ assetId, sha256, size: asset.size })), afterAssetId: null }),
				stage: async (catalogId, importId, input) => {
					for (const reference of catalogOriginalReferences(input)) {
						const key = JSON.stringify([catalogId, importId, reference.photoId]);
						roots.set(key, { ...reference, schemaVersion: 1, key, catalogId, importId,
							scope: JSON.stringify([catalogId, importId]), mediaContentToken: 'media-content-0000000000000000' });
					}
					events.push('stage'); boundary?.('stage');
					if (fail === 'stage-after') { fail = null; throw new Error('stage acknowledgement failed'); }
				},
				readPage: async ({ catalogId, importId = null, afterKey = null }) => {
					recoveryPages += 1;
					const page = [...roots.values()].filter((value) => value.catalogId === catalogId && value.importId === importId
						&& (afterKey === null || value.key > afterKey)).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0).slice(0, 64);
					return { roots: page, afterKey: page.length === 64 ? page.at(-1)!.key : null };
				},
				promote: async (catalogId, importId, input) => {
					if (fail === 'promote') { fail = null; throw new Error('promotion acknowledgement failed'); }
					const photoIds = catalogOriginalPhotoIds(input); recoveryBatches.push(photoIds.length);
					for (const photoId of photoIds) {
						const key = JSON.stringify([catalogId, importId, photoId]); const value = roots.get(key)!;
						roots.delete(key); const promoted = { ...value, importId: null, key: JSON.stringify([catalogId, null, photoId]), scope: JSON.stringify([catalogId, null]) };
						roots.set(promoted.key, promoted);
					}
					events.push('promote');
					boundary?.('promote');
				},
				releaseStaged: async (catalogId, importId, input) => {
					const photoIds = catalogOriginalPhotoIds(input); recoveryBatches.push(photoIds.length);
					for (const photoId of photoIds) roots.delete(JSON.stringify([catalogId, importId, photoId]));
					events.push('release');
				},
			},
		},
	};
	return { ports, photos, assets, roots, journal, events, recoveryBatches, recoveryPages: () => recoveryPages, root: () => root,
		fail: (phase: typeof fail) => { fail = phase; }, boundary: (callback: (phase: string) => void) => { boundary = callback; } };
}

test('managed import retains exact original custody before photo publication and retires a settled intent', async () => {
	const f = fixture(); const input = photoArchiveFixture();
	const result = await importManagedPhotosV1('catalog-1', [input], f.ports);
	assert.deepEqual(result, [{ index: 0, photoId: input.photo.id, status: 'imported', reusedOriginal: false, message: null }]);
	assert.deepEqual(f.events, ['intent', 'write', 'stage', 'publish', 'promote', 'retire']);
	assert.equal(f.journal.size, 0); assert.equal(f.root().photoCount, 1);
	assert.deepEqual(f.photos.get(input.photo.id), input.photo);
	assert.equal([...f.roots.values()][0]?.importId, null);
});

test('digest dedupe reuses original bytes while keeping separate photo identity and authored metadata', async () => {
	const f = fixture(); const first = photoArchiveFixture(1), second = photoArchiveFixture(2);
	const result = await importManagedPhotosV1('catalog-1', [first, second], f.ports);
	assert.equal(f.assets.size, 1); assert.equal(f.root().photoCount, 2);
	assert.deepEqual(result.map((value) => value.reusedOriginal), [false, true]);
	const imported = f.photos.get(second.photo.id)!;
	assert.equal(imported.original.storageKey, first.photo.original.storageKey);
	assert.equal(imported.original.id, second.photo.original.id);
	assert.deepEqual(imported.metadata, second.photo.metadata);
});

test('digest dedupe refuses different same-length selected bytes despite a matching declared digest', async () => {
	const f = fixture();
	await importManagedPhotosV1('catalog-1', [photoArchiveFixture(1)], f.ports);
	const second = { ...photoArchiveFixture(2), original: new Blob([new Uint8Array([3, 2, 1])]) };
	const result = await importManagedPhotosV1('catalog-1', [second], f.ports);
	assert.equal(result[0].status, 'failed'); assert.match(result[0].message!, /digest/iu);
	assert.equal(f.root().photoCount, 1); assert.equal(f.photos.has('photo-2'), false);
	assert.equal(f.assets.size, 1); assert.equal(f.roots.size, 1);
});

test('a publication acknowledgement failure preserves authored changes made after the durable import', async () => {
	const f = fixture(); f.fail('publish-after');
	f.boundary((phase) => {
		if (phase !== 'publish') return;
		const photo = f.photos.get('photo-1')!;
		f.photos.set(photo.id, normalizePhotoDocumentV1({ ...photo, revision: 1, rating: 5 }));
	});
	const result = await importManagedPhotosV1('catalog-1', [photoArchiveFixture()], f.ports);
	assert.equal(result[0].status, 'imported'); assert.equal(f.root().photoCount, 1);
	assert.equal(f.photos.get('photo-1')?.rating, 5); assert.equal(f.photos.get('photo-1')?.revision, 1);
	assert.equal(f.journal.size, 0); assert.equal([...f.roots.values()][0]?.importId, null);
});

test('preexisting photo identities refuse before writing or retaining originals', async () => {
	const f = fixture(); const existing = photoArchiveFixture().photo;
	f.photos.set(existing.id, normalizePhotoDocumentV1({ ...existing, rating: 5, revision: 1 }));
	const result = await importManagedPhotosV1('catalog-1', [photoArchiveFixture()], f.ports);
	assert.equal(result[0].status, 'failed'); assert.equal(f.assets.size, 0); assert.equal(f.roots.size, 0);
	assert.equal(f.photos.get(existing.id)?.rating, 5);
});

for (const phase of ['write', 'stage-after', 'publish-before'] as const) {
	test(`${phase} failure settles absent-photo custody and allows the next file to import`, async () => {
		const f = fixture(); f.fail(phase);
		const result = await importManagedPhotosV1('catalog-1', [photoArchiveFixture(1), photoArchiveFixture(2)], f.ports);
		assert.deepEqual(result.map((value) => value.status), ['failed', 'imported']);
		assert.equal(f.root().photoCount, 1); assert.equal(f.photos.has('photo-1'), false);
		assert.equal(f.journal.size, 0); assert.equal([...f.roots.values()].every((value) => value.importId === null), true);
		if (phase === 'publish-before') { assert.equal(f.events.includes('release'), true); assert.ok(f.assets.has('original-1')); }
	});
}

for (const phase of ['publish-after', 'promote'] as const) {
	test(`${phase} failure reconciles the durable photo and preserves a successful import`, async () => {
		const f = fixture(); f.fail(phase);
		const result = await importManagedPhotosV1('catalog-1', [photoArchiveFixture()], f.ports);
		assert.equal(result[0].status, 'imported'); assert.equal(f.root().photoCount, 1);
		assert.equal(f.journal.size, 0); assert.equal([...f.roots.values()][0]?.importId, null);
		assert.equal(f.events.includes('release'), false);
	});
}

for (const phase of ['stage', 'publish'] as const) {
	test(`cancellation at ${phase} preserves custody and intent for a subsequent exclusive writer`, async () => {
		const f = fixture(); const stop = new AbortController();
		f.boundary((at) => { if (at === phase) stop.abort(); });
		await assert.rejects(importManagedPhotosV1('catalog-1', [photoArchiveFixture()], f.ports, { signal: stop.signal }), { name: 'AbortError' });
		assert.equal(f.journal.size, 1); assert.equal([...f.roots.values()][0]?.importId, 'import-1');
		assert.equal(f.events.includes('release'), false);
		await recoverManagedPhotoImportV1('catalog-1', f.ports);
		assert.equal(f.journal.size, 0);
		assert.equal(f.roots.size, phase === 'stage' ? 0 : 1);
		assert.equal(f.assets.size, 1);
	});
}

test('conflicting durable references refuse recovery without releasing an original or intent', async () => {
	const f = fixture(); const stop = new AbortController();
	f.boundary((at) => { if (at === 'stage') stop.abort(); });
	await assert.rejects(importManagedPhotosV1('catalog-1', [photoArchiveFixture()], f.ports, { signal: stop.signal }), { name: 'AbortError' });
	const photo = photoArchiveFixture().photo;
	f.photos.set(photo.id, normalizePhotoDocumentV1({ ...photo, original: { ...photo.original, storageKey: 'another-original' } }));
	await assert.rejects(recoverManagedPhotoImportV1('catalog-1', f.ports), /conflicting original/iu);
	assert.equal(f.journal.size, 1); assert.equal(f.roots.size, 1);
	assert.equal(f.events.includes('release'), false);
});

test('intent retirement failure preserves a fully imported photo and permits a new writer to finish recovery', async () => {
	const f = fixture(); f.fail('retire');
	await assert.rejects(importManagedPhotosV1('catalog-1', [photoArchiveFixture()], f.ports), /intent retirement failed/iu);
	assert.equal(f.journal.size, 1); assert.equal(f.root().photoCount, 1);
	assert.equal([...f.roots.values()][0]?.importId, null);
	await recoverManagedPhotoImportV1('catalog-1', f.ports);
	assert.equal(f.journal.size, 0); assert.equal(f.photos.size, 1); assert.equal(f.assets.size, 1);
});

test('future intent schemas refuse recovery before touching originals or photos', async () => {
	const f = fixture();
	f.journal.set(photoImportIntentKeyV1('catalog-1'), { schemaVersion: 2, kind: 'photo-import', catalogId: 'catalog-1', importId: 'import-1' });
	await assert.rejects(recoverManagedPhotoImportV1('catalog-1', f.ports), /schema/iu);
	assert.deepEqual(f.events, []); assert.equal(f.journal.size, 1);
});

test('recovery advances over removed roots in bounded pages and mixed promotion/release groups', async () => {
	const f = recoveryFixture();
	await recoverManagedPhotoImportV1('catalog-1', f.ports);
	assert.equal(f.recoveryPages(), 3);
	assert.equal(f.roots.size, 65);
	assert.equal([...f.roots.values()].every((value) => value.importId === null), true);
	assert.equal(f.recoveryBatches.every((count) => count > 0 && count <= 16), true);
	assert.equal(f.journal.size, 0);
});

test('interrupted mixed recovery resumes without replacing already promoted roots', async () => {
	const f = recoveryFixture(); const stop = new AbortController();
	f.boundary((phase) => { if (phase === 'promote') stop.abort(); });
	await assert.rejects(recoverManagedPhotoImportV1('catalog-1', f.ports, { signal: stop.signal }), { name: 'AbortError' });
	const committed = [...f.roots.values()].filter((value) => value.importId === null);
	assert.ok(committed.length > 0); assert.equal(f.journal.size, 1);
	assert.ok([...f.roots.values()].some((value) => value.importId !== null));
	f.boundary(() => {});
	await recoverManagedPhotoImportV1('catalog-1', f.ports);
	for (const root of committed) assert.deepEqual(f.roots.get(root.key), root);
	assert.equal(f.journal.size, 0); assert.equal(f.roots.size, 65);
});

test('an unavailable exclusive writer refuses before creating intent or reading an original', async () => {
	const f = fixture();
	const ports: PhotoManagedImportPortsV1 = { ...f.ports, exclusive: async () => { throw new Error('Catalog writer is busy'); } };
	await assert.rejects(importManagedPhotosV1('catalog-1', [photoArchiveFixture()], ports), /writer is busy/iu);
	assert.deepEqual(f.events, []); assert.equal(f.assets.size, 0);
});

function recoveryFixture() {
	const f = fixture(); const catalogId = 'catalog-1', importId = 'import-1';
	f.journal.set(photoImportIntentKeyV1(catalogId), { schemaVersion: 1, kind: 'photo-import', catalogId, importId });
	for (let index = 1; index <= 130; index += 1) {
		const { photo } = photoArchiveFixture(index);
		const key = JSON.stringify([catalogId, importId, photo.id]);
		f.roots.set(key, { schemaVersion: 1, key, catalogId, importId, scope: JSON.stringify([catalogId, importId]),
			photoId: photo.id, assetId: photo.original.storageKey, sourceId: photo.original.id,
			sha256: photo.original.contentSha256, size: photo.original.byteLength, mediaContentToken: 'media-content-0000000000000000' });
		if (index % 2 === 0) f.photos.set(photo.id, photo);
	}
	return f;
}
