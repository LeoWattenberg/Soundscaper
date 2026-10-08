/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { planPhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-plan-v1.ts';
import { PhotoLibrarySessionV1 } from '../src/lightscaper/controller/photo-library-session.ts';
import type { PhotoLibraryPreviewSchedulerPortV1, PhotoLibrarySessionPortsV1 } from '../src/lightscaper/controller/photo-library-session-ports.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
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
			readQueryPage: async () => { throw new Error('Unexpected query read'); },
			rebuildQueryIndexPage: async () => ({ processed: 0, bytes: 0, ready: true }),
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


test('metadata reads project one photo without media bytes and editing keeps original and extracted facts immutable', async () => {
	const f = fixture(), owner = new PhotoLibrarySessionV1(f.ports), before = f.photo();
	const snapshot = await owner.readMetadata('photo-1');
	assert.deepEqual(Object.keys(snapshot).sort(), ['extracted', 'metadata', 'originalFileName', 'originalSha256', 'photoId', 'revision']);
	assert.equal(snapshot.originalFileName, before.original.name);
	const updated = await owner.applyMetadata('photo-1', snapshot.revision, {
		fileName: 'Renamed.png', title: 'A title', caption: 'First line\nSecond line', creator: 'A photographer',
		copyright: 'Copyright', location: 'Berlin', captureTime: { local: '2026-10-08T11:12:13', offsetMinutes: null },
	});
	assert.equal(updated.metadata.fileName, 'Renamed.png');
	assert.equal(updated.metadata.captureTime?.local, '2026-10-08T11:12:13.000');
	assert.equal(updated.metadata.captureTime?.offsetMinutes, null);
	assert.equal(updated.revision, 1);
	assert.deepEqual(f.photo().original, before.original);
	assert.deepEqual(f.photo().extractedMetadata, before.extractedMetadata);
	assert.equal((await owner.readPage()).rows[0]?.fileName, 'Renamed.png');
	await owner.close();
});

test('a metadata editor snapshot cannot overwrite a newer durable edit even when a stale command owner is cached', async () => {
	const f = fixture(), owner = new PhotoLibrarySessionV1(f.ports);
	const snapshot = await owner.readMetadata('photo-1');
	await owner.setRating('photo-1', 5);
	await f.ports.catalog.savePhoto({ ...f.photo(), metadata: { ...f.photo().metadata, title: 'External edit' } }, f.photo().revision);
	await assert.rejects(owner.applyMetadata('photo-1', snapshot.revision, { title: 'Stale title' }), /revision changed/iu);
	assert.equal(f.photo().metadata.title, 'External edit'); assert.equal(f.photo().rating, 5);
	const current = await owner.readMetadata('photo-1');
	const ack = await owner.applyMetadata('photo-1', current.revision, { title: 'Fresh title' });
	assert.equal(ack.metadata.title, 'Fresh title'); assert.equal(ack.revision, 3);
	await owner.close();
});

test('metadata patches refuse unknown fields, accessors and invalid capture dates before initialization', async () => {
	const f = fixture(), owner = new PhotoLibrarySessionV1(f.ports); let invoked = 0;
	await assert.rejects(owner.applyMetadata('photo-1', 0, { orientation: 8 } as never), /unknown|field/iu);
	await assert.rejects(owner.applyMetadata('photo-1', 0, { captureTime: { local: '2026-02-30T11:12:13', offsetMinutes: 0 } }), /timestamp/iu);
	await assert.rejects(owner.applyMetadata('photo-1', 0, Object.defineProperty({}, 'title', {
		enumerable: true, get: () => { invoked++; return 'Unsafe'; },
	})), /accessor|data/iu);
	await assert.rejects(owner.applyMetadata('photo-1', -1, { title: 'A title' }), /revision/iu);
	await assert.rejects(owner.applyMetadata('photo-1', 0, {}), /empty/iu);
	assert.deepEqual(f.calls, []); assert.equal(invoked, 0);
	await owner.close();
});

test('metadata publication reports only acknowledged values and a failed write can retry from the same snapshot', async () => {
	const f = fixture(), owner = new PhotoLibrarySessionV1(f.ports), before = f.photo();
	const save = f.ports.catalog.savePhoto; let fail = true;
	f.ports.catalog.savePhoto = async (...args) => { if (fail) throw new Error('Quota refused'); return save(...args); };
	await assert.rejects(owner.applyMetadata('photo-1', 0, { title: 'Pending title' }), /Quota/iu);
	assert.deepEqual(f.photo(), before);
	fail = false;
	const ack = await owner.applyMetadata('photo-1', 0, { title: 'Durable title' });
	assert.equal(ack.metadata.title, 'Durable title'); assert.equal(ack.revision, 1);
	await owner.close();
});


test('previews are menu-demanded, share one scheduler and expose only disposable pixel bodies', async () => {
	const f = fixture(), before = f.photo(); let opens = 0, requests = 0, closes = 0;
	const body = new Blob([new Uint8Array([1, 2, 3, 255])]);
	const plan = planPhotoPreviewV1({ binding: { catalogId: before.catalogId, photoId: before.id,
		originalId: before.original.id, storageKey: before.original.storageKey, contentSha256: before.original.contentSha256,
		byteLength: before.original.byteLength, width: before.original.width, height: before.original.height },
		source: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, tier: 'thumbnail' });
	f.ports.createPreviewScheduler = async catalogId => {
		assert.equal(catalogId, 'catalog-1'); opens++;
		return { request: async () => {
			requests++;
			return { outcome: 'ready', cache: 'transient', persistenceError: new Error('private quota context'),
				preview: { schemaVersion: 1, kind: 'photo-preview', key: plan.key, binding: plan.binding,
					tier: plan.tier, recipe: plan.recipe, descriptor: plan.output, byteLength: 4,
					outputSha256: 'a'.repeat(64), body } };
		}, close: async () => { closes++; } };
	};
	const owner = new PhotoLibrarySessionV1(f.ports);
	await owner.readPage(); assert.equal(opens, 0);
	const first = await owner.readPreview('photo-1', 'thumbnail');
	assert.equal(first.outcome, 'ready');
	if (first.outcome !== 'ready') assert.fail('A preview was requested.');
	assert.deepEqual(Object.keys(first.preview).sort(), ['body', 'byteLength', 'descriptor', 'outputSha256', 'photoId', 'tier']);
	assert.equal(first.preview.body, body);
	assert.deepEqual(first.notices, ['persistence-failed']);
	assert.equal(first.cache, 'transient');
	await owner.readPreview('photo-1', 'thumbnail');
	assert.equal(opens, 1); assert.equal(requests, 2);
	assert.deepEqual(f.photo(), before);
	await owner.close(); assert.equal(closes, 1);
});

test('preview IDs, tiers and already canceled demand refuse before initialization', async () => {
	const f = fixture(), owner = new PhotoLibrarySessionV1(f.ports);
	await assert.rejects(owner.readPreview(' ', 'thumbnail'), /ID/iu);
	await assert.rejects(owner.readPreview('photo-1', 'other' as never), /tier/iu);
	await assert.rejects(owner.readPreview('photo-1', 'thumbnail', { signal: AbortSignal.abort() }), { name: 'AbortError' });
	assert.deepEqual(f.calls, []); await owner.close();
});

test('close joins a scheduler native job after observer cancellation before releasing media resources', async () => {
	const f = fixture(), entered = deferred<void>(), drained = deferred<void>();
	let nativeClose = false;
	f.ports.createPreviewScheduler = async () => ({ request: async value => {
		const signal = (value as { signal: AbortSignal }).signal;
		entered.resolve();
		await new Promise<void>(resolve => { signal.addEventListener('abort', () => { resolve(); }, { once: true }); });
		signal.throwIfAborted(); return { outcome: 'missing' };
	}, close: async () => { nativeClose = true; await drained.promise; } });
	const owner = new PhotoLibrarySessionV1(f.ports);
	const work = owner.readPreview('photo-1', 'thumbnail');
	await entered.promise;
	const rejection = assert.rejects(work, { name: 'AbortError' });
	const closing = owner.close();
	assert.equal(await remainsPending(closing), true);
	assert.equal(nativeClose, true); assert.equal(f.calls.includes('close'), false);
	drained.resolve(); await closing; await rejection;
	assert.equal(f.calls.at(-1), 'close');
});

test('scheduler cleanup failure remains visible and still releases the remaining resource owners', async () => {
	const f = fixture();
	f.ports.createPreviewScheduler = async () => ({ request: async () => ({ outcome: 'missing' }),
		close: async () => { throw new Error('preview cleanup failed'); } });
	const owner = new PhotoLibrarySessionV1(f.ports);
	await owner.readPreview('photo-1', 'thumbnail');
	await assert.rejects(owner.close(), /preview cleanup failed/iu);
	assert.equal(f.calls.at(-1), 'close');
});


test('failed lazy preview creation retries without retaining a rejected scheduler', async () => {
	const f = fixture(); let opens = 0;
	f.ports.createPreviewScheduler = async () => {
		if (++opens === 1) throw new Error('Preview module unavailable');
		return { request: async () => ({ outcome: 'missing' }), close: async () => undefined };
	};
	const owner = new PhotoLibrarySessionV1(f.ports);
	await assert.rejects(owner.readPreview('photo-1', 'thumbnail'), /module unavailable/iu);
	assert.deepEqual(await owner.readPreview('photo-1', 'thumbnail'), { outcome: 'missing' });
	assert.equal(opens, 2); await owner.close();
});

test('a scheduler factory resolving after close is joined and closed without admitting a preview request', async () => {
	const f = fixture(), entered = deferred<void>(), factory = deferred<PhotoLibraryPreviewSchedulerPortV1>();
	let requests = 0;
	f.ports.createPreviewScheduler = () => { entered.resolve(); return factory.promise; };
	const owner = new PhotoLibrarySessionV1(f.ports);
	const work = owner.readPreview('photo-1', 'thumbnail');
	const rejection = assert.rejects(work, { name: 'AbortError' });
	await entered.promise;
	const closing = owner.close(); assert.equal(await remainsPending(closing), true);
	assert.equal(f.calls.includes('close'), false);
	factory.resolve({ request: async () => { requests++; return { outcome: 'missing' }; },
		close: async () => { f.calls.push('preview closed'); } });
	await closing; await rejection;
	assert.equal(requests, 0); assert.deepEqual(f.calls.slice(-2), ['preview closed', 'close']);
});
