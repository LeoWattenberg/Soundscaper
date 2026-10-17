/* SPDX-License-Identifier: AGPL-3.0-only */

// Real Session, archive and allocated restore owners. Node storage and RGBA
// inputs are explicit fixtures; native menu/decoder behavior has its own spec.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after } from 'node:test';
import { importPhotoCatalogArchiveV6, type PhotoCatalogArchiveStageV6 } from '../src/lightscaper/archive/catalog-archive-import-v6.ts';
import { restorePhotoLibraryArchiveV2 } from '../src/lightscaper/controller/photo-library-archive-restore-v2.ts';
import { createPhotoLibrarySessionV3 } from '../src/lightscaper/photo-library-session-runtime-v3.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import type { PhotoLibrarySessionV2 } from '../src/lightscaper/controller/photo-library-session-v2.ts';
import type { PhotoLibraryDevelopCommandV2 } from '../src/common/editor/photo-library-develop-port-v2.ts';
import type { BrushMaskResourceReferenceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { PhotoDocumentV1 } from '../src/lightscaper/catalog/types.ts';
import type { PhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { defaultImageDevelopStateV2, normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 as POINTER } from '../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { readPhotoLibrarySessionLocationV2 } from '../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { MemoryLockManager } from './helpers/offline-browser-runtime-store-fixture.ts';
import { savedArchiveFixtureV3 } from './helpers/lightscaper-saved-collection-archive-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const CATALOG = 'catalog-1', CLOCK = '2026-10-11T12:00:00.000Z';
// Independent literal SCMASK01 framing: two LE32 dimensions then raw alpha.
const BODIES = [[255, 0], [128, 255], [0, 255]].map(alpha => new Uint8Array([
	83, 67, 77, 65, 83, 75, 48, 49, 2, 0, 0, 0, 1, 0, 0, 0, ...alpha,
]));
const REFERENCES: readonly Readonly<BrushMaskResourceReferenceV1>[] = BODIES.map(bytes => {
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	return Object.freeze({ storageKey: `brush-mask-v1:2:1:${sha256}`, sha256, width: 2, height: 1, byteLength: 18 });
});
function recipe(reference: Readonly<BrushMaskResourceReferenceV1>, disabled = false) {
	const effect = createVideoEffect('point-curves-v1', { id: 'invert', enabled: !disabled,
		params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } });
	return normalizeImageDevelopStateV1OrV2({ ...defaultImageDevelopStateV2(), effects: [effect],
		masks: [{ schemaVersion: 1, id: 'paint', kind: 'mask', inputs: [{ name: 'Paint', kind: 'alpha', sourceRef: reference.storageKey }],
			nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'Paint' }], outputNodeId: 'alpha' }],
		maskBindings: disabled ? [] : [{ effectId: 'invert', maskId: 'paint' }] });
}
async function apply(session: PhotoLibrarySessionV2, photoId: string, command: PhotoLibraryDevelopCommandV2) {
	const versionId = 'versionId' in command ? command.versionId : command.sourceVersionId;
	const before = await session.develop.read({ schemaVersion: 2, photoId, versionId });
	const ack = await session.develop.apply({ schemaVersion: 2, photoId, expectedRevision: before.revision, command });
	assert.equal(ack.snapshot.revision, before.revision + 1); assert.deepEqual(ack.notices, []); return ack.snapshot;
}
async function fixture() {
	const native = mediaRestoreFixture(), locks = new MemoryLockManager() as unknown as LockManager;
	const anchor = new PhotoMediaStoreV1({ indexedDB: native.factory, locks, preferOpfs: false }); await anchor.ready();
	await anchor.settingsRepository.put(POINTER, { schemaVersion: 1, kind: 'photo-library', catalogId: CATALOG });
	let token = 128;
	const options = { name: 'Brush archive', indexedDB: native.factory, locks, settings: anchor.settingsRepository,
		allocateToken: () => (++token).toString(16).padStart(32, '0') };
	const selection = () => withPhotoLibraryInitializationLockV1(locks, authority => readPhotoLibrarySessionLocationV2({
		settings: anchor.settingsRepository, initializeDefault: () => Promise.reject(Error('Existing location required.')) }, authority.signal));
	const rows = (names: { catalogDatabaseName: string; mediaDatabaseName: string }) => ({
		photos: native.raw(names.catalogDatabaseName).records(names.catalogDatabaseName, 'photos'),
		originals: native.raw(names.mediaDatabaseName).records(names.mediaDatabaseName, 'mediaAssets'),
		custody: native.raw(names.mediaDatabaseName).records(names.mediaDatabaseName, 'catalogOriginalRoots'),
		bodies: native.raw(names.mediaDatabaseName).records(names.mediaDatabaseName, 'analysis'),
	});
	return { ...native, anchor, options, selection, rows,
		open: () => createPhotoLibrarySessionV3({ name: options.name, indexedDB: native.factory, locks }) };
}
async function observe(blob: Blob) {
	const photos = new Map<string, PhotoDocumentV1 | PhotoDocumentV2>(), originals = new Map<string, number[]>();
	const bodies = new Map<string, number[]>(), retired: Uint8Array<ArrayBuffer>[] = [];
	let declared: readonly Readonly<BrushMaskResourceReferenceV1>[] = [], published = 0;
	const stage: PhotoCatalogArchiveStageV6 = {
		async writePhoto(photo, source) {
			const bytes: number[] = []; for await (const chunk of source) bytes.push(...chunk);
			assert.equal(createHash('sha256').update(new Uint8Array(bytes)).digest('hex'), photo.original.contentSha256);
			photos.set(photo.id, photo); originals.set(photo.id, bytes);
		},
		async writeStack() {}, async writeSavedCollection() {}, async writeDevelopPresets() {}, async writeLut() {},
		async writeMaskRaster(reference, bytes) {
			assert.equal(createHash('sha256').update(bytes).digest('hex'), reference.sha256);
			bodies.set(reference.storageKey, [...bytes]); retired.push(bytes);
		},
		async publish() { published++; }, async rollback() { assert.fail('Valid brush archive rolled back.'); },
	};
	const root = await importPhotoCatalogArchiveV6(blob, async (_root, _saved, _presets, _luts, masks) => {
		declared = masks.map(value => value.reference); return stage;
	});
	assert.equal(published, 1); assert.ok(retired.every(bytes => bytes.every(value => value === 0)));
	return { root, photos, originals, declared, bodies };
}
async function backup(session: PhotoLibrarySessionV2) {
	const result = await session.backupCatalog(); assert.ok(result.blob); assert.deepEqual(result.notices, []);
	assert.equal(result.byteLength, result.blob.size); return { blob: result.blob, ledger: await observe(result.blob) };
}
async function assertBodiesAndRender(session: PhotoLibrarySessionV2) {
	for (const [index, reference] of REFERENCES.entries()) {
		let retired: Uint8Array<ArrayBuffer> | undefined;
		await session.maskRasterSource.withBytes(reference, bytes => { assert.deepEqual(bytes, BODIES[index]); retired = bytes; });
		assert.ok(retired); assert.ok(retired.every(value => value === 0));
	}
	const runtime = createPhotoDevelopRenderRuntimeV2({ source: session.cubeLuts.source, maskSource: session.maskRasterSource });
	for (const method of [runtime.withProxy, runtime.withFullResolution]) {
			const pixels = new Uint8Array([0, 0, 0, 128, 0, 0, 0, 255]);
			const actual = await method({ frame: { descriptor: { schemaVersion: 1, width: 2, height: 1,
				sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels },
				develop: recipe(REFERENCES[2]!), signal: new AbortController().signal }, view => [...view.frame.pixels]);
			assert.deepEqual(actual, [0, 0, 0, 128, 255, 255, 255, 255]);
			assert.deepEqual([...pixels], [0, 0, 0, 128, 0, 0, 0, 255]);
	}
}

test('actual Runtime3 brush history backs up, restores privately, renders and rebacks after two durable reopens', async () => {
	const f = await fixture();
	try {
		await restorePhotoLibraryArchiveV2(await savedArchiveFixtureV3(), f.options);
		const source = await f.open(); let first!: Awaited<ReturnType<typeof backup>>;
		try {
			const installer = source.develop.maskRasters; assert.ok(installer);
			for (const [index, body] of BODIES.entries()) assert.equal((await installer.install(REFERENCES[index]!, body)).created, true);
			await apply(source, 'photo-1', { type: 'create-virtual-copy', sourceVersionId: 'version-1', id: 'inactive-brush', name: 'Inactive brush', createdAt: CLOCK });
			await apply(source, 'photo-1', { type: 'record-develop', versionId: 'inactive-brush', develop: recipe(REFERENCES[0]!, true), label: 'Disabled unbound brush', createdAt: CLOCK });
			await apply(source, 'photo-1', { type: 'save-develop-snapshot', versionId: 'inactive-brush', id: 'brush-snapshot', name: 'Brush snapshot', createdAt: CLOCK });
			await apply(source, 'photo-1', { type: 'activate-version', versionId: 'version-1' });
			await apply(source, 'photo-1', { type: 'record-develop', versionId: 'version-1', develop: recipe(REFERENCES[2]!), label: 'Visible brush', createdAt: CLOCK });
			await apply(source, 'photo-2', { type: 'record-develop', versionId: 'version-2', develop: recipe(REFERENCES[1]!), label: 'Redo brush', createdAt: CLOCK });
			const selected = await apply(source, 'photo-2', { type: 'select-develop-history', versionId: 'version-2', cursor: 0 });
			assert.equal(selected.history.cursor, 0); assert.equal(selected.history.entries.length, 2);
			await assertBodiesAndRender(source); first = await backup(source);
			assert.deepEqual(first.ledger.declared, [...REFERENCES].sort((left, right) => left.storageKey.localeCompare(right.storageKey)));
			for (const [index, reference] of REFERENCES.entries()) assert.deepEqual(first.ledger.bodies.get(reference.storageKey), [...BODIES[index]!]);
			for (const [index, id] of ['photo-1', 'photo-2'].entries()) {
				const archived = first.ledger.photos.get(id)!, original = photoArchiveFixture(index + 1).photo;
				assert.deepEqual(archived.original, original.original); assert.deepEqual(archived.metadata, original.metadata);
				assert.deepEqual(archived.extractedMetadata, original.extractedMetadata); assert.deepEqual(first.ledger.originals.get(id), [1, 2, 3]);
			}
			const inactive = first.ledger.photos.get('photo-1')!.versions.find(value => value.id === 'inactive-brush')!;
			assert.deepEqual(inactive.workspace?.snapshots[0]?.develop, recipe(REFERENCES[0]!, true));
			const redo = first.ledger.photos.get('photo-2')!.versions[0]!.workspace!;
			assert.equal(redo.cursor, 0); assert.deepEqual(redo.entries[1]?.develop, recipe(REFERENCES[1]!));
		} finally { await source.close(); }
		const donor = await f.selection(), donorBefore = f.rows(donor.location), pointerBefore = await f.anchor.settingsRepository.get(POINTER);
		const restored = await restorePhotoLibraryArchiveV2(first.blob, f.options);
		assert.deepEqual(restored.notices, []); assert.equal(restored.originalCount, 2); assert.equal(restored.originalByteLength, 6);
		assert.notDeepEqual(await f.anchor.settingsRepository.get(POINTER), pointerBefore);
		const selected = await f.selection(); assert.notEqual(selected.location.mediaDatabaseName, donor.location.mediaDatabaseName);
		for (let reopen = 0; reopen < 2; reopen++) {
			const current = await f.open();
			try { await assertBodiesAndRender(current); assert.deepEqual((await backup(current)).ledger, first.ledger); }
			finally { await current.close(); }
			assert.deepEqual(f.rows(donor.location), donorBefore);
		}
		const selectedRows = f.rows(selected.location);
		assert.equal(selectedRows.originals.length, 2); assert.equal(selectedRows.custody.length, 2); assert.equal(selectedRows.bodies.length, 3);
	} finally { await f.anchor.close(); }
});
