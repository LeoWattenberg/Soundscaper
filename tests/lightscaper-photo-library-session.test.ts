/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibrarySessionV1 } from '../src/lightscaper/controller/photo-library-session.ts';
import type { PhotoLibrarySessionPortsV1 } from '../src/lightscaper/controller/photo-library-session-ports.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import type { PhotoLibraryUiObservationV1 } from './helpers/lightscaper-photo-library-ui-fixture.ts';


function fixture() {
	let root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1',
		name: 'Library', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	let photo = photoArchiveFixture().photo;
	const calls: string[] = [];
	let identity = 0;
	const ports: { -readonly [Key in keyof PhotoLibrarySessionPortsV1]: PhotoLibrarySessionPortsV1[Key] } = {
		createId: () => `identity-${String(++identity)}`,
		initialize: async () => { calls.push('initialize'); return root; },
		closeResources: async () => { calls.push('close'); },
		exclusive: async (_id, operation, signal) => { calls.push('lock'); return operation(signal); },
		catalog: {
			loadCatalog: async () => root,
			loadPhoto: async () => photo,
			publishPhotos: async () => root,
			saveCatalog: async value => { root = normalizePhotoCatalogRootV1({ ...(value as object), revision: root.revision + 1 }); calls.push('keywords'); return root; },
			savePhoto: async (value, expected) => { assert.equal(photo.revision, expected); photo = normalizePhotoDocumentV1({ ...(value as object), revision: expected + 1 }); calls.push('rating'); return photo; },
			readSummaryPage: async (_id, options) => {
				calls.push(options?.continuation ? 'next' : 'page');
				return { items: [{ key: 'catalog-1|photo-1', catalogId: 'catalog-1', photoId: photo.id, photoRevision: photo.revision,
					fileName: photo.metadata.fileName, captureLocal: null, rating: photo.rating, flag: photo.flag, colorLabel: photo.colorLabel,
					folderId: null, activeVersionId: photo.activeVersionId, originalSha256: photo.original.contentSha256, width: 1, height: 1 }],
					continuation: { catalogId: 'catalog-1', indexRevision: 0, scope: 'catalog-1|all', afterKey: 'catalog-1|photo-1' } };
			},
		},
		journal: { get: async () => undefined, putIfAbsent: async () => true, deleteIfCurrent: async () => true },
		media: { writeAsset: async () => { throw new Error('Unexpected media write'); }, custody: {
			findDigestPage: async () => ({ matches: [], afterAssetId: null }), stage: async () => undefined, promote: async () => undefined,
			releaseStaged: async () => undefined, readPage: async () => ({ roots: [], afterKey: null }),
		} },
	};
	return { ports, calls, root: () => root, photo: () => photo };
}

test('library ownership starts lazily, returns only scalar pages and forwards bounded continuation', async () => {
	const f = fixture(), owner = new PhotoLibrarySessionV1(f.ports);
	assert.equal(f.calls.length, 0);
	const first = await owner.readPage();
	assert.equal(first.catalogName, 'Library'); assert.equal(first.rows.length, 1);
	const residentIdentity: PhotoLibraryUiObservationV1['photos'][number]['id'] = first.rows[0]!.id;
	assert.equal(residentIdentity, 'photo-1');
	assert.deepEqual(Object.keys(first.rows[0]!).sort(), ['colorLabel', 'fileName', 'flag', 'height', 'id', 'rating', 'width']);
	await owner.readPage({ cursor: first.cursor });
	assert.equal(f.calls.filter(value => value === 'initialize').length, 1);
	assert.equal(f.calls.includes('next'), true);
	await owner.close();
});

test('a failed preparation keeps its selected-file index while later photos publish serially with keyword membership', async () => {
	const f = fixture();
	f.ports.prepare = async function* () {
		yield { outcome: 'failed', index: 0, fileName: 'Broken.png', error: new Error('invalid signature') };
		yield { outcome: 'prepared', index: 1, fileName: 'Photo.png', ...photoArchiveFixture(), keywordNames: ['Travel', 'Travel'], notices: [] };
	};
	f.ports.importPhotos = async (_id, photos, _ports, options) => {
		const rows = [];
		for await (const row of photos) {
			assert.deepEqual(Object.keys(row).sort(), ['original', 'photo']);
			assert.equal(row.photo.keywordIds.length, 1);
			assert.equal(f.root().keywords[0]?.name, 'Travel');
			options?.signal?.throwIfAborted();
			rows.push({ index: rows.length, photoId: row.photo.id, status: 'imported' as const, reusedOriginal: false, message: null });
		}
		return rows;
	};
	const owner = new PhotoLibrarySessionV1(f.ports);
	const result = await owner.importFiles([new File(['bad'], 'Broken.png'), new File(['image'], 'Photo.png')]);
	assert.deepEqual(result.map(row => [row.index, row.fileName, row.status]), [[0, 'Broken.png', 'failed'], [1, 'Photo.png', 'imported']]);
	assert.equal(result[0]?.message, 'invalid signature');
	assert.equal(f.root().keywords.length, 1);
	await owner.close();
});

test('rating publication uses the per-photo command owner and preserves the exact original and extracted facts', async () => {
	const f = fixture(), owner = new PhotoLibrarySessionV1(f.ports), before = f.photo();
	await owner.setRating(before.id, 5);
	assert.equal(f.photo().rating, 5); assert.equal(f.photo().revision, 1);
	assert.deepEqual(f.photo().original, before.original); assert.deepEqual(f.photo().extractedMetadata, before.extractedMetadata);
	await assert.rejects(owner.setRating(before.id, 6), /rating/iu);
	assert.equal(f.calls.filter(value => value === 'rating').length, 1);
	await owner.close();
});

test('successful imports report extraction issues even when metadata mapping itself has no notices', async () => {
	const f = fixture(), input = photoArchiveFixture();
	const photo = normalizePhotoDocumentV1({ ...input.photo, extractedMetadata: { schemaVersion: 1, container: 'png',
		exif: null, iptc: null, issues: ['unsupported-text-encoding'] } });
	f.ports.prepare = async function* () { yield { ...input, photo, outcome: 'prepared', index: 0, fileName: 'Photo.png', keywordNames: [], notices: [] }; };
	f.ports.importPhotos = async (_id, photos) => {
		for await (const row of photos) assert.deepEqual(row.photo.extractedMetadata, photo.extractedMetadata);
		return [{ index: 0, photoId: photo.id, status: 'imported', reusedOriginal: false, message: null }];
	};
	const owner = new PhotoLibrarySessionV1(f.ports);
	assert.equal((await owner.importFiles([new File(['image'], 'Photo.png')]))[0]?.hasMetadataNotices, true);
	await owner.close();
});

test('storage errors are failures rather than empty library results and a failed lazy initialization can retry', async () => {
	const f = fixture(); let attempts = 0;
	f.ports.initialize = async () => { if (++attempts === 1) throw new Error('storage blocked'); return f.root(); };
	const owner = new PhotoLibrarySessionV1(f.ports);
	await assert.rejects(owner.readPage(), /storage blocked/iu);
	assert.equal((await owner.readPage()).rows.length, 1);
	await owner.close();
});

test('a failed photo switch releases the old owner so selecting the previous photo can open it again', async () => {
	const f = fixture();
	f.ports.catalog.loadPhoto = async (_catalogId, photoId) => photoId === 'photo-1' ? f.photo() : null;
	const owner = new PhotoLibrarySessionV1(f.ports);
	await owner.setRating('photo-1', 5);
	await assert.rejects(owner.setRating('missing-photo', 1), /missing/iu);
	await owner.setRating('photo-1', 3);
	assert.equal(f.photo().rating, 3); assert.equal(f.photo().revision, 2);
	await owner.close();
});

test('a rating that matches stale session history still updates a newer durable rating', async () => {
	const f = fixture(), owner = new PhotoLibrarySessionV1(f.ports);
	await owner.setRating('photo-1', 5);
	await f.ports.catalog.savePhoto({ ...f.photo(), rating: 3 }, f.photo().revision);
	assert.equal((await owner.readPage()).rows[0]?.rating, 3);
	await owner.setRating('photo-1', 5);
	assert.equal(f.photo().rating, 5); assert.equal(f.photo().revision, 3);
	await owner.close();
});

test('close cancels and joins a pending import before releasing resources and is idempotent', async () => {
	const f = fixture(); let observed = false;
	let entered: (() => void) | undefined;
	const importEntered = new Promise<void>(resolve => { entered = resolve; });
	f.ports.prepare = async function* () { yield { outcome: 'prepared', index: 0, fileName: 'Photo.png', ...photoArchiveFixture(), keywordNames: [], notices: [] }; };
	f.ports.importPhotos = async (_id, _photos, _ports, options) => {
		assert.ok(options?.signal);
		entered?.();
		await new Promise<void>(resolve => { options.signal!.addEventListener('abort', () => { observed = true; resolve(); }, { once: true }); });
		assert.equal(f.calls.includes('close'), false); options.signal.throwIfAborted(); return [];
	};
	const owner = new PhotoLibrarySessionV1(f.ports);
	const work = owner.importFiles([new File(['image'], 'Photo.png')]);
	await importEntered;
	const rejected = assert.rejects(work, { name: 'AbortError' });
	const closing = owner.close(); assert.equal(owner.close(), closing);
	await closing; await rejected;
	assert.equal(observed, true); assert.equal(f.calls.at(-1), 'close');
	await assert.rejects(owner.readPage(), /closed/iu);
});

test('oversized page cursors refuse before any database or initialization work', async () => {
	const f = fixture(), owner = new PhotoLibrarySessionV1(f.ports);
	await assert.rejects(owner.readPage({ cursor: 'x'.repeat(1_025) }), /cursor/iu);
	assert.deepEqual(f.calls, []); await owner.close();
});

test('culling flags and labels publish together without changing original custody or extracted facts', async () => {
	const f = fixture(), owner = new PhotoLibrarySessionV1(f.ports), before = f.photo();
	const row = await owner.applyAttributes('photo-1', { flag: 'pick', colorLabel: 'blue' });
	assert.equal(row.flag, 'pick'); assert.equal(row.colorLabel, 'blue');
	assert.equal(f.photo().revision, 1);
	assert.deepEqual(f.photo().original, before.original); assert.deepEqual(f.photo().extractedMetadata, before.extractedMetadata);
	assert.equal(f.calls.filter(value => value === 'rating').length, 1);
	await owner.close();
});

test('invalid culling patches refuse before opening storage or invoking accessors', async () => {
	const f = fixture(), owner = new PhotoLibrarySessionV1(f.ports);
	let invoked = 0;
	await assert.rejects(owner.applyAttributes('photo-1', { flag: 'invalid' } as never), /flag/iu);
	await assert.rejects(owner.applyAttributes('photo-1', {}), /empty/iu);
	await assert.rejects(owner.applyAttributes('photo-1', Object.defineProperty({}, 'flag', { enumerable: true,
		get: () => { invoked++; return 'pick'; } })), /data|accessor/iu);
	assert.deepEqual(f.calls, []); assert.equal(invoked, 0);
	await owner.close();
});
