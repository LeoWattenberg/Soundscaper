/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import { createImageDevelopPresetV2 } from '../src/common/editor/imaging/image-develop-preset-v2.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { MediaRepository } from '../src/common/editor/storage/media-repository.ts';
import type { MediaAssetMaintenance } from '../src/common/editor/storage/media-asset-lifecycle-coordinator.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { createPhotoDevelopWorkspaceV2, commitPhotoDevelopWorkspaceV2, selectPhotoDevelopHistoryV2 } from '../src/lightscaper/catalog/photo-develop-workspace-v2.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const TEXT = 'TITLE "Größe"\r\nLUT_3D_SIZE 2\r\n0 0 0\r\n1 0 0\r\n0 1 0\r\n1 1 0\r\n0 0 1\r\n1 0 1\r\n0 1 1\r\n1 1 1';
const CREATED = '2026-10-09T00:00:00.000Z';
function resource() {
	const parsed = parseCubeLutV1(TEXT);
	return { bytes: new TextEncoder().encode(TEXT), reference: { storageKey: `lut-sha256:${parsed.sha256}`, sha256: parsed.sha256,
		byteLength: parsed.byteLength, size: parsed.size, domainMin: parsed.domainMin, domainMax: parsed.domainMax } };
}
function currentPhoto() {
	const photo = photoArchiveFixture().photo;
	const develop = { ...photo.versions[0]!.develop, processVersion: 2, effects: [{ id: 'profile', type: 'cube-lut-profile-v1', enabled: false,
		params: { lut: resource().reference } }] };
	let workspace = createPhotoDevelopWorkspaceV2(photo.versions[0]!.develop, { label: 'Original', createdAt: CREATED });
	workspace = commitPhotoDevelopWorkspaceV2(workspace, develop, { label: 'LUT', createdAt: CREATED });
	workspace = { ...workspace, snapshots: [{ id: 'saved', name: 'Saved', createdAt: CREATED, develop: workspace.entries[1]!.develop }] };
	workspace = selectPhotoDevelopHistoryV2(workspace, 0);
	return normalizePhotoDocumentV2({ ...photo, schemaVersion: 2, versions: [{ ...photo.versions[0], workspace }] });
}
function fixture() {
	const raw = createInstrumentedIndexedDB(), databaseName = `lightscaper-photo-lut-resources-${crypto.randomUUID()}`;
	const create = () => new PhotoMediaStoreV1({ indexedDB: raw as unknown as IDBFactory, databaseName, preferOpfs: false, locks: null });
	return { raw, databaseName, create, media: create() };
}

test('selected media imports exact native UTF8 bodies, reuses custody and reopens in the same DB2 domain', async () => {
	const f = fixture(), input = resource();
	try {
		const resources = await f.media.getCubeLutResources();
		assert.equal(await f.media.getCubeLutResources(), resources);
		assert.deepEqual(await resources.importFile(new Blob([input.bytes])), { reference: input.reference, created: true });
		assert.deepEqual(await resources.put(input.reference, input.bytes), { reference: input.reference, created: false });
		assert.equal(f.raw.recordCount(f.databaseName, 'analysis'), 1);
		assert.equal(f.raw.recordCount(f.databaseName, 'mediaAssets'), 0);
		assert.equal(f.raw.recordCount(f.databaseName, 'catalogOriginalRoots'), 0);
		await f.media.close();
		const reopened = f.create();
		try {
			const source = (await reopened.getCubeLutResources()).source;
			await source.withBytes(input.reference, bytes => { assert.deepEqual(bytes, input.bytes); bytes.fill(0); });
			await source.withBytes(input.reference, bytes => { assert.deepEqual(bytes, input.bytes); });
		} finally { await reopened.close(); }
		assert.equal(f.raw.recordCount(f.databaseName, 'settings'), 0, 'the original media owner releases its only retention marker');
	} finally { await f.media.close(); }
});

test('full owning verification retains disabled LUTs in redo and snapshots before any body read', async () => {
	const f = fixture(), photo = currentPhoto(), input = resource();
	try {
		const resources = await f.media.getCubeLutResources();
		await assert.rejects(resources.verifyPhoto(photo), /missing/u);
		assert.equal(f.raw.recordCount(f.databaseName, 'analysis'), 0);
		await resources.put(input.reference, input.bytes);
		await resources.verifyPhoto(photo);
		const preset = createImageDevelopPresetV2({ schemaVersion: 2, id: 'preset', name: 'Profile', settings: {
			schemaVersion: 2, kind: 'photo-develop-settings', selection: { effectTypes: 'all', geometry: true, localAdjustments: true },
			develop: photo.versions[0]!.workspace!.entries[1]!.develop } });
		await resources.verifyPreset(preset);
		let reads = 0;
		f.raw.onNextGetForStore('analysis', () => { reads++; });
		await assert.rejects(resources.verifyPhoto({ ...photo, original: { ...photo.original, byteLength: -1 } }));
		assert.equal(reads, 0);
		await resources.verifyPhoto(photo);
		assert.equal(reads, 1);
	} finally { await f.media.close(); }
});

test('a held renderer borrower does not block selected writer verification or immutable installation', async () => {
	const f = fixture(), input = resource(), entered = deferred<void>(), release = deferred<void>();
	try {
		const resources = await f.media.getCubeLutResources();
		await resources.put(input.reference, input.bytes);
		const render = resources.source.withBytes(input.reference, async bytes => {
			assert.deepEqual(bytes, input.bytes); entered.resolve(); await release.promise;
		});
		await entered.promise;
		await resources.verifyPhoto(currentPhoto());
		assert.equal((await resources.put(input.reference, input.bytes)).created, false);
		await assert.rejects(resources.source.withBytes(input.reference, () => undefined), /pending/u);
		release.resolve(); await render;
	} finally { release.resolve(); await f.media.close(); }
});

test('media Close seals admission and joins the entire held consumer before releasing its native retention owner', async () => {
	const f = fixture(), input = resource(), entered = deferred<void>(), release = deferred<void>();
	const borrowed: { bytes: Uint8Array<ArrayBuffer> | null } = { bytes: null };
	try {
		const resources = await f.media.getCubeLutResources();
		await resources.put(input.reference, input.bytes);
		const render = resources.source.withBytes(input.reference, async bytes => { borrowed.bytes = bytes; entered.resolve(); await release.promise; });
		await entered.promise;
		const closing = f.media.close();
		assert.equal(f.media.close(), closing);
		await remainsPending(closing);
		assert.equal(f.raw.recordCount(f.databaseName, 'settings'), 1);
		await assert.rejects(resources.put(input.reference, input.bytes), /closed/u);
		await assert.rejects(resources.verifyPhoto(photoArchiveFixture().photo), /closed/u);
		release.resolve(); await render; await closing;
		assert.ok(borrowed.bytes); assert.equal(borrowed.bytes.some(byte => byte !== 0), false);
		assert.equal(f.raw.recordCount(f.databaseName, 'settings'), 0);
	} finally { release.resolve(); await f.media.close(); }
});

test('native Blob intrinsics ignore shadowed file methods and reject BOM and oversized bodies', async () => {
	const f = fixture();
	try {
		const resources = await f.media.getCubeLutResources(), file = new Blob([TEXT]);
		let calls = 0;
		for (const key of ['size', 'arrayBuffer']) Object.defineProperty(file, key, { get() { calls++; throw new Error('shadow'); } });
		assert.deepEqual((await resources.importFile(file)).reference, resource().reference);
		assert.equal(calls, 0);
		await assert.rejects(resources.importFile(new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), TEXT])), /BOM/u);
		await assert.rejects(resources.importFile(new Blob([new Uint8Array(16_777_217)])), /bound/u);
		await assert.rejects(resources.importFile({} as Blob));
		assert.equal(f.raw.recordCount(f.databaseName, 'analysis'), 1);
	} finally { await f.media.close(); }
});

test('current capabilities authenticate every reuse and preserve exact opaque cancellation before publication', async () => {
	const f = fixture(), input = resource();
	try {
		const resources = await f.media.getCubeLutResources(), controller = new AbortController();
		let reflected = 0;
		const reason = new Proxy({}, { get() { reflected++; throw new Error('opaque'); }, getPrototypeOf() { reflected++; throw new Error('opaque'); } });
		controller.abort(reason);
		await resources.importFile(new Blob([TEXT]), { signal: controller.signal }).then(() => assert.fail('aborted import delivered'), error => {
			assert.equal(error === reason, true);
		});
		assert.equal(reflected, 0); assert.equal(f.raw.recordCount(f.databaseName, 'analysis'), 0);
		await resources.put(input.reference, input.bytes);
		f.raw.seedRecord(f.databaseName, 'analysis', { key: input.reference.storageKey,
			value: { schemaVersion: 1, kind: 'photo-cube-lut-body', reference: input.reference, bytes: new Uint8Array([0]) } });
		await assert.rejects(resources.verifyPhoto(currentPhoto()));
		await assert.rejects(resources.put(input.reference, input.bytes));
		assert.equal(f.raw.recordCount(f.databaseName, 'analysis'), 1);
	} finally { await f.media.close(); }
});

test('the real current catalog writer requires selected-media bodies before publication and retains all refs on metadata edits', async () => {
	const f = fixture(), photo = currentPhoto();
	const resources = await f.media.getCubeLutResources();
	const catalog = new PhotoCatalogRepositoryV2({ indexedDB: f.raw as unknown as IDBFactory,
		databaseName: `lightscaper-catalog-lut-${crypto.randomUUID()}`, verifyOriginal: f.media.verifyOriginal,
		verifyResources: resources.verifyPhoto });
	try {
		await f.media.mediaRepository.writeAsset(photo.original.storageKey, photoArchiveFixture().original);
		await catalog.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: photo.catalogId,
			name: 'Selected', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
		await assert.rejects(catalog.publishPhotos(photo.catalogId, 0, [photo]), /missing/u);
		assert.equal(await catalog.loadPhoto(photo.catalogId, photo.id), null);
		assert.equal((await catalog.loadCatalog(photo.catalogId))?.revision, 0);
		await resources.importFile(new Blob([TEXT]));
		await catalog.publishPhotos(photo.catalogId, 0, [photo]);
		const edited = await catalog.savePhoto({ ...photo, metadata: { ...photo.metadata, title: 'Edited' } }, 0);
		assert.equal(edited.schemaVersion, 2); assert.equal(edited.revision, 1);
		assert.deepEqual(edited.versions, photo.versions); assert.deepEqual(edited.original, photo.original);
		assert.deepEqual(await catalog.loadPhoto(photo.catalogId, photo.id), edited);
	} finally { await catalog.close(); await f.media.close(); }
});

test('conflicting complete references across retained history and snapshots refuse before native body reads', async () => {
	const f = fixture(), photo = currentPhoto(), version = photo.versions[0]!, workspace = version.workspace!;
	try {
		const resources = await f.media.getCubeLutResources();
		await resources.importFile(new Blob([TEXT]));
		let reads = 0;
		f.raw.onNextGetForStore('analysis', () => { reads++; });
		const snapshot = workspace.snapshots[0]!, effect = snapshot.develop.effects[0]!;
		await assert.rejects(resources.verifyPhoto({ ...photo, versions: [{ ...version, workspace: { ...workspace,
			snapshots: [{ ...snapshot, develop: { ...snapshot.develop, effects: [{ ...effect,
				params: { lut: { ...resource().reference, domainMin: [-1, 0, 0] } } }] } }] } }] }), /Conflicting/u);
		assert.equal(reads, 0);
		await resources.verifyPhoto(photo); assert.equal(reads, 1);
	} finally { await f.media.close(); }
});

test('media Close caches its held-consumer join before a cleanup capability can reenter Close', async context => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>(), input = resource();
	let nested: Promise<void> | null = null, reentered = false;
	const begin = MediaRepository.prototype.beginAssetMaintenance;
	context.mock.method(MediaRepository.prototype, 'beginAssetMaintenance', function(this: MediaRepository, options: Readonly<{ permanent?: boolean }>) {
		const maintenance = Reflect.apply(begin, this, [options]) as MediaAssetMaintenance;
		return { ...maintenance, abortActive() {
			if (!reentered) { reentered = true; nested = f.media.close(); }
			return maintenance.abortActive();
		} };
	});
	try {
		const resources = await f.media.getCubeLutResources(); await resources.put(input.reference, input.bytes);
		const render = resources.source.withBytes(input.reference, async () => { entered.resolve(); await release.promise; });
		await entered.promise;
		const closing = f.media.close(); assert.equal(nested, closing);
		await remainsPending(closing); assert.equal(f.raw.recordCount(f.databaseName, 'settings'), 1);
		release.resolve(); await render; await closing;
		assert.equal(f.raw.recordCount(f.databaseName, 'settings'), 0);
	} finally { release.resolve(); await f.media.close(); }
});
