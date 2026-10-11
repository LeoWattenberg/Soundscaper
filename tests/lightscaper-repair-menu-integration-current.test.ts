/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { capturePhotoLibraryLegacyDevelopCurrentV1 } from '../src/common/editor/ui/lightscaper/photo-library-workflow-legacy-develop-current-v1.ts';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { createPhotoLibrarySessionV3 } from '../src/lightscaper/photo-library-session-runtime-v3.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 } from '../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { resolvePhotoLibraryLocationV2 } from '../src/lightscaper/storage/photo-library-location-v2.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { normalizeImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import type { PhotoLibrarySessionPortCurrentV1 } from '../src/common/editor/photo-library-session-port-current-v1.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { MemoryLockManager } from './helpers/offline-browser-runtime-store-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const TIME = '2026-10-11T00:00:00.000Z';

async function fixture() {
	const native = mediaRestoreFixture(), locks = new MemoryLockManager() as unknown as LockManager;
	const options = { name: 'Repair menu', indexedDB: native.factory, locks };
	const initialize = await createPhotoLibrarySessionV3(options);
	try { assert.equal((await initialize.readPage()).totalCount, 0); } finally { await initialize.close(); }
	const anchor = new PhotoMediaStoreV1({ indexedDB: native.factory, locks, preferOpfs: false });
	await anchor.ready();
	let location: ReturnType<typeof resolvePhotoLibraryLocationV2>;
	try { location = resolvePhotoLibraryLocationV2(await anchor.settingsRepository.get(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1)); }
	finally { await anchor.close(); }
	const input = photoArchiveFixture(), photo = { ...input.photo, catalogId: location.catalogId };
	const media = new PhotoMediaStoreV1({ indexedDB: native.factory, databaseName: location.mediaDatabaseName, locks, preferOpfs: false });
	const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: native.factory, databaseName: location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
	try {
		await media.ready(); const asset = await media.mediaRepository.writeAsset(photo.original.storageKey, input.original);
		await media.mediaRepository.catalogOriginals.stage(photo.catalogId, 'seed', [{ photoId: photo.id, sourceId: photo.original.id,
			assetId: asset.sourceId, sha256: asset.sha256, size: asset.size }]);
		const root = await catalog.loadCatalog(photo.catalogId); assert.ok(root); await catalog.publishPhotos(root.id, root.revision, [photo]);
		await media.mediaRepository.catalogOriginals.promote(photo.catalogId, 'seed', [photo.id]);
	} finally { await Promise.all([catalog.close(), media.close()]); }
	async function inspect() {
		const media = new PhotoMediaStoreV1({ indexedDB: native.factory, databaseName: location.mediaDatabaseName, locks, preferOpfs: false });
		const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: native.factory, databaseName: location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
		try {
			const row = await catalog.loadPhoto(photo.catalogId, photo.id), body = await media.mediaRepository.loadAsset(photo.original.storageKey); assert.ok(body);
			return { row, bytes: new Uint8Array(await body.arrayBuffer()), roots: await media.mediaRepository.catalogOriginals.readPage({ catalogId: photo.catalogId }) };
		} finally { await Promise.all([catalog.close(), media.close()]); }
	}
	return { options, photo, inspect };
}

test('Current selected Session exposes genuine Develop2 for a fully admitted legacy photo without replacing Develop3', async () => {
	const f = await fixture(), session = await createPhotoLibrarySessionCurrentV1(f.options);
	try {
		assert.equal(session.develop.schemaVersion, 3);
		assert.ok(session.legacyDevelop, 'Unrepaired settings/export require a separately admitted legacy capability');
		assert.equal(session.legacyDevelop.schemaVersion, 2); assert.notEqual(session.legacyDevelop, session.develop);
		const legacy = await session.legacyDevelop.read({ schemaVersion: 2, photoId: f.photo.id });
		const current = await session.develop.read({ schemaVersion: 3, photoId: f.photo.id });
		assert.equal(legacy.schemaVersion, 2); assert.equal(current.schemaVersion, 3);
		assert.equal(legacy.revision, current.revision); assert.deepEqual(legacy.develop, current.develop);
		assert.ok(session.legacyDevelop.settings); assert.ok(session.legacyDevelop.presets);
		const selection = { effectTypes: 'all' as const, geometry: true, localAdjustments: true };
		const packet = session.legacyDevelop.settings.copy({ schemaVersion: 2, develop: legacy.develop, selection });
		assert.equal(packet.schemaVersion, 2);
		assert.deepEqual(session.legacyDevelop.settings.merge({ schemaVersion: 2, target: legacy.develop, settings: packet }), legacy.develop);
	} finally { await session.close(); }
});

test('genuine legacy and Current commands share the selected native writer, revision conflicts, and immutable Original', async () => {
	const f = await fixture(), before = await f.inspect(), session = await createPhotoLibrarySessionCurrentV1(f.options);
	try {
		assert.ok(session.legacyDevelop);
		const initial = await session.legacyDevelop.read({ schemaVersion: 2, photoId: f.photo.id });
		const develop = normalizeImageDevelopStateV1({ ...initial.develop,
			effects: [createVideoEffect('tone-ladder-v1', { id: 'legacy-exposure', params: { exposure: 1 } })] });
		const saved = await session.legacyDevelop.apply({ schemaVersion: 2, photoId: f.photo.id, expectedRevision: initial.revision,
			command: { type: 'record-develop', versionId: initial.versionId, develop, label: 'Exposure', createdAt: TIME } });
		const current = await session.develop.read({ schemaVersion: 3, photoId: f.photo.id });
		assert.equal(current.revision, saved.snapshot.revision); assert.deepEqual(current.develop, saved.snapshot.develop);
		await assert.rejects(session.develop.apply({ schemaVersion: 3, photoId: f.photo.id, expectedRevision: initial.revision,
			command: { type: 'activate-version', versionId: initial.versionId } }), { code: 'PHOTO_REVISION_CONFLICT' });
	} finally { await session.close(); }
	const after = await f.inspect(); assert.deepEqual(after.bytes, before.bytes); assert.deepEqual(after.roots, before.roots);
	assert.deepEqual(after.row?.original, before.row?.original); assert.equal(after.row?.revision, 1);
});

test('legacy capability refuses retained repairs even after native history selects an actual legacy active recipe', async () => {
	const f = await fixture(), session = await createPhotoLibrarySessionCurrentV1(f.options);
	try {
		assert.ok(session.legacyDevelop); const initial = await session.develop.read({ schemaVersion: 3, photoId: f.photo.id });
		const repair = replaceImageDevelopRepairSpotsV1(initial.develop, { schemaVersion: 1, spots: [{ id: 'repair', mode: 'heal', enabled: false,
			target: { x: .5, y: .5 }, source: { x: .25, y: .5 }, radius: .1, feather: 0, opacity: 1 }] });
		const saved = await session.develop.apply({ schemaVersion: 3, photoId: f.photo.id, expectedRevision: initial.revision,
			command: { type: 'record-develop', versionId: initial.versionId, develop: repair, label: 'Repair', createdAt: TIME } });
		await assert.rejects(session.legacyDevelop.read({ schemaVersion: 2, photoId: f.photo.id }));
		const restored = await session.develop.apply({ schemaVersion: 3, photoId: f.photo.id, expectedRevision: saved.snapshot.revision,
			command: { type: 'select-develop-history', versionId: initial.versionId, cursor: 0 } });
		assert.equal(restored.snapshot.develop.processVersion, 1);
		const before = await f.inspect(); assert.equal(before.row?.schemaVersion, 3);
		await assert.rejects(session.legacyDevelop.read({ schemaVersion: 2, photoId: f.photo.id }));
		await assert.rejects(session.legacyDevelop.apply({ schemaVersion: 2, photoId: f.photo.id, expectedRevision: restored.snapshot.revision,
			command: { type: 'activate-version', versionId: initial.versionId } }));
		assert.deepEqual(await f.inspect(), before);
	} finally { await session.close(); }
});

test('Current legacy capture uses the separately owned capability and preserves native Close refusal', async () => {
	const f = await fixture(), session = await createPhotoLibrarySessionCurrentV1(f.options);
	try {
		const captured = capturePhotoLibraryLegacyDevelopCurrentV1(session);
		assert.equal(captured.schemaVersion, 2); assert.ok(captured.settings); assert.ok(captured.presets);
		assert.equal((await captured.read({ schemaVersion: 2, photoId: f.photo.id })).revision, 0);
		const close = session.close(); assert.equal(session.close(), close); await close;
		await assert.rejects(captured.read({ schemaVersion: 2, photoId: f.photo.id }));
	} finally { await session.close(); }
});

test('Current legacy capture honors inert native pre-abort before inspecting a hostile Session', () => {
	const cancel = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke(); cancel.abort(reason.proxy);
	let reflected = 0; const hostile = new Proxy({}, { get() { reflected++; throw Error('Unexpected Session reflection'); } });
	assert.throws(() => capturePhotoLibraryLegacyDevelopCurrentV1(hostile as PhotoLibrarySessionPortCurrentV1, cancel.signal), error => error === reason.proxy);
	assert.equal(reflected, 0);
});

test('Current legacy capture refuses a schema3 capability without invoking it or fabricating a legacy view', async () => {
	const f = await fixture(), session = await createPhotoLibrarySessionCurrentV1(f.options); let operations = 0;
	try {
		const hostile = new Proxy(session, { get(target, key, receiver) { if (key === 'legacyDevelop') return { schemaVersion: 3,
			read() { operations++; throw Error('Wrong schema invoked'); }, apply() { operations++; throw Error('Wrong schema invoked'); } };
			return Reflect.get(target, key, receiver) as unknown; } });
		assert.throws(() => capturePhotoLibraryLegacyDevelopCurrentV1(hostile), RangeError); assert.equal(operations, 0);
	} finally { await session.close(); }
});
