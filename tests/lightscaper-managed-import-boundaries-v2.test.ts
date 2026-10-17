/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { importManagedPhotosV2, recoverManagedPhotoImportV2 } from '../src/lightscaper/import/managed-import-v2.ts';
import type { PhotoManagedImportPortsV2, PhotoManagedImportReceiptV1 } from '../src/lightscaper/import/managed-import-ports-v2.ts';
import { photoImportIntentKeyV1 } from '../src/lightscaper/import/import-intent-v1.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { normalizePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { lutArchiveFixture, LUT_BODY, LUT_REFERENCE } from './helpers/lightscaper-lut-archive-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

type Phase = 'intent' | 'original' | 'stage' | 'publish' | 'promote' | 'retire';
interface Cut {
	readonly phase: Phase;
	readonly when: 'before' | 'after';
	readonly body: boolean;
	readonly photo: boolean;
	readonly staged: boolean;
	readonly retained: boolean;
	readonly journal: boolean;
}
const cuts: readonly Cut[] = [
	{ phase: 'intent', when: 'before', body: false, photo: false, staged: false, retained: false, journal: false },
	{ phase: 'intent', when: 'after', body: false, photo: false, staged: false, retained: false, journal: true },
	{ phase: 'original', when: 'before', body: false, photo: false, staged: false, retained: false, journal: true },
	{ phase: 'original', when: 'after', body: true, photo: false, staged: false, retained: false, journal: true },
	{ phase: 'stage', when: 'before', body: true, photo: false, staged: false, retained: false, journal: true },
	{ phase: 'stage', when: 'after', body: true, photo: false, staged: true, retained: false, journal: true },
	{ phase: 'publish', when: 'before', body: true, photo: false, staged: true, retained: false, journal: true },
	{ phase: 'publish', when: 'after', body: true, photo: true, staged: true, retained: false, journal: true },
	{ phase: 'promote', when: 'before', body: true, photo: true, staged: true, retained: false, journal: true },
	{ phase: 'promote', when: 'after', body: true, photo: true, staged: false, retained: true, journal: true },
	{ phase: 'retire', when: 'before', body: true, photo: true, staged: false, retained: true, journal: true },
	{ phase: 'retire', when: 'after', body: true, photo: true, staged: false, retained: true, journal: false },
];
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function fixture() {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const mediaName = `lightscaper-import-cut-media-${crypto.randomUUID()}`, catalogName = `lightscaper-import-cut-catalog-${crypto.randomUUID()}`;
	const open = async () => {
		const media = new PhotoMediaStoreV1({ indexedDB, databaseName: mediaName, locks: null, preferOpfs: false, syncWorkerClient: null });
		await media.ready(); const resources = await media.getCubeLutResources();
		const catalog = new PhotoCatalogRepositoryV2({ indexedDB, databaseName: catalogName, verifyOriginal: media.verifyOriginal,
			verifyResources: (photo, signal) => resources.verifyPhoto(photo, signal) });
		return { media, catalog, resources };
	};
	let owner = await open();
	const close = async () => { await owner.catalog.close(); await owner.media.close(); };
	const ports = (): PhotoManagedImportPortsV2 => ({ catalog: owner.catalog,
		media: { writeAsset: owner.media.mediaRepository.writeAsset, custody: owner.media.mediaRepository.catalogOriginals },
		journal: owner.media.settingsRepository, verifyResources: (photo, signal) => owner.resources.verifyPhoto(photo, signal),
		createImportId: () => 'current-cut', exclusive: async (_catalog, run, signal) => run(signal) });
	await owner.catalog.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1', name: 'Import cuts',
		revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	await owner.resources.put(LUT_REFERENCE, LUT_BODY);
	const prior = photoArchiveFixture(2), priorBytes = new Uint8Array([4, 5, 6]);
	const priorPhoto = normalizePhotoDocumentV1OrV2({ ...prior.photo, original: { ...prior.photo.original,
		storageKey: 'prior-original', id: 'prior-source', contentSha256: digest(priorBytes) } });
	assert.equal((await importManagedPhotosV2('catalog-1', [{ photo: priorPhoto, original: new Blob([priorBytes]) }], ports()))[0]?.status, 'imported');
	const priorRoot = await owner.catalog.loadCatalog('catalog-1'); assert.ok(priorRoot);
	const priorCustody = (await owner.media.mediaRepository.catalogOriginals.readPage({ catalogId: 'catalog-1' })).roots[0]; assert.ok(priorCustody);
	return { owner: () => owner, ports, close, priorPhoto, priorBytes, priorRoot, priorCustody,
		reopen: async () => { await close(); owner = await open(); } };
}

for (const cut of cuts) test(`${cut.phase} ${cut.when}: current import joins the interrupted native capability and reopened recovery preserves mixed documents and immutable bodies`, { timeout: 10_000 }, async () => {
	const f = await fixture(), input = lutArchiveFixture().record, base = f.ports(), stop = new AbortController();
	const entered = deferred<void>(), release = deferred<void>(), publications: PhotoManagedImportReceiptV1[] = [];
	const contentTokens = new Map([[f.priorPhoto.id, f.priorCustody.mediaContentToken]]);
	let reflections = 0, enteredCount = 0;
	const reason = new Proxy({}, { get() { reflections++; throw Error('Opaque reason read'); }, getPrototypeOf() { reflections++; throw Error('Opaque reason prototype'); } });
	const intercept = async <T,>(phase: Phase, operation: () => Promise<T>): Promise<T> => {
		if (phase !== cut.phase) return operation();
		enteredCount++;
		if (cut.when === 'before') { entered.resolve(); await release.promise; stop.signal.throwIfAborted(); }
		const result = await operation();
		if (cut.when === 'after') { entered.resolve(); await release.promise; }
		return result;
	};
	const ports: PhotoManagedImportPortsV2 = { ...base,
		journal: { get: key => base.journal.get(key),
			putIfAbsent: (...args) => intercept('intent', () => base.journal.putIfAbsent(...args)),
			deleteIfCurrent: (...args) => intercept('retire', () => base.journal.deleteIfCurrent(...args)) },
		media: { writeAsset: (...args) => intercept('original', () => base.media.writeAsset(...args)), custody: {
			findDigestPage: (...args) => base.media.custody.findDigestPage(...args), readPage: (...args) => base.media.custody.readPage(...args),
			releaseStaged: (...args) => base.media.custody.releaseStaged(...args),
			stage: (...args) => intercept('stage', () => base.media.custody.stage(...args)),
			promote: (...args) => intercept('promote', () => base.media.custody.promote(...args)) } },
		catalog: { loadCatalog: id => base.catalog.loadCatalog(id), loadPhoto: (...args) => base.catalog.loadPhoto(...args),
			publishPhotos: (...args) => intercept('publish', () => base.catalog.publishPhotos(...args)) } };
	const work = importManagedPhotosV2('catalog-1', [input], ports, { signal: stop.signal, onPublished: receipt => publications.push(receipt) });
	const outcome = work.then(value => ({ status: 'fulfilled' as const, value }), (reason: unknown) => ({ status: 'rejected' as const, reason }));
	try {
		await entered.promise; stop.abort(reason);
		assert.equal(await remainsPending(work), true, 'The owner must join the held native capability before returning.');
		assert.equal(enteredCount, 1);
		assert.equal(publications.length, ['promote', 'retire'].includes(cut.phase) ? 1 : 0);
		await assertState(false);
		release.resolve(); const result = await outcome;
		if (cut.phase === 'retire' && cut.when === 'after') {
			assert.equal(result.status, 'fulfilled', 'A completed native intent retirement keeps its durable publication ACK.');
			if (result.status === 'fulfilled') assert.deepEqual(result.value, [{ index: 0, photoId: input.photo.id, status: 'imported', reusedOriginal: false, message: null }]);
		} else { assert.equal(result.status, 'rejected'); if (result.status === 'rejected') assert.equal(result.reason, reason); }
		assert.equal(reflections, 0); assert.equal(publications.length, cut.photo ? 1 : 0);
		await f.reopen(); await assertState(false);
		await recoverManagedPhotoImportV2('catalog-1', f.ports()); await assertState(true);
		await f.reopen(); await recoverManagedPhotoImportV2('catalog-1', f.ports()); await assertState(true);
		assert.equal(reflections, 0); assert.equal(enteredCount, 1);
	} finally { release.resolve(); await outcome; await f.close(); }

	async function assertState(recovered: boolean) {
		const { media, catalog, resources } = f.owner(), root = await catalog.loadCatalog('catalog-1'); assert.ok(root);
		assert.deepEqual(root, { ...f.priorRoot, photoCount: cut.photo ? 2 : 1, revision: f.priorRoot.revision + (cut.photo ? 1 : 0) });
		assert.deepEqual(await catalog.loadPhoto('catalog-1', f.priorPhoto.id), f.priorPhoto);
		assert.deepEqual(await catalog.loadPhoto('catalog-1', input.photo.id), cut.photo ? input.photo : null);
		const priorBody = await media.mediaRepository.loadAsset(f.priorPhoto.original.storageKey); assert.ok(priorBody);
		assert.deepEqual(new Uint8Array(await priorBody.arrayBuffer()), f.priorBytes);
		assert.equal(digest(new Uint8Array(await priorBody.arrayBuffer())), f.priorPhoto.original.contentSha256);
		const body = await media.mediaRepository.loadAsset(input.photo.original.storageKey);
		assert.equal(body instanceof Blob, cut.body);
		if (body) { const bytes = new Uint8Array(await body.arrayBuffer()); assert.deepEqual(bytes, new Uint8Array([1, 2, 3])); assert.equal(digest(bytes), input.photo.original.contentSha256); }
		const staged = await media.mediaRepository.catalogOriginals.readPage({ catalogId: 'catalog-1', importId: 'current-cut' });
		assert.equal(staged.roots.length, !recovered && cut.staged ? 1 : 0); assert.equal(staged.afterKey, null);
		const retained = await media.mediaRepository.catalogOriginals.readPage({ catalogId: 'catalog-1' });
		assert.equal(retained.roots.length, 1 + (recovered ? Number(cut.photo) : Number(cut.retained)));
		assert.deepEqual(retained.roots.map(row => row.photoId).sort(), [f.priorPhoto.id, ...((recovered ? cut.photo : cut.retained) ? [input.photo.id] : [])].sort());
		for (const row of [...staged.roots, ...retained.roots]) {
			const photo = row.photoId === f.priorPhoto.id ? f.priorPhoto : input.photo;
			const importId = row.photoId === input.photo.id && !recovered && cut.staged ? 'current-cut' : null;
			assert.match(row.mediaContentToken, /^media-content-[a-z0-9][a-z0-9-]{15,127}$/u);
			if (!contentTokens.has(row.photoId)) contentTokens.set(row.photoId, row.mediaContentToken);
			assert.deepEqual(row, { schemaVersion: 1, photoId: photo.id, assetId: photo.original.storageKey, sourceId: photo.original.id,
				sha256: photo.original.contentSha256, size: photo.original.byteLength, catalogId: 'catalog-1', importId,
				key: JSON.stringify(['catalog-1', importId, photo.id]), scope: JSON.stringify(['catalog-1', importId]), mediaContentToken: contentTokens.get(row.photoId) });
		}
		assert.equal(Boolean(await media.settingsRepository.get(photoImportIntentKeyV1('catalog-1'))), !recovered && cut.journal);
		await resources.source.withBytes(LUT_REFERENCE, bytes => { assert.deepEqual(bytes, LUT_BODY); assert.equal(digest(bytes), LUT_REFERENCE.sha256); });
	}
});
