/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after } from 'node:test';
import { createPhotoCatalogRestoreStageCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-restore-stage-current-v1.ts';
import { createPhotoMediaRestoreCandidateCurrentV1 } from '../src/lightscaper/storage/photo-media-restore-candidate-current-v1.ts';
import { createPhotoCatalogRestoreStageV2 } from '../src/lightscaper/catalog/photo-catalog-restore-stage-v2.ts';
import { createPhotoMediaRestoreCandidateV2, type PhotoMediaRestoreCandidateV2 } from '../src/lightscaper/storage/photo-media-restore-candidate-v2.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { normalizePhotoDocumentV3 } from '../src/lightscaper/catalog/photo-document-v3.ts';
import { normalizePhotoDevelopPresetRowCurrentV1 } from '../src/lightscaper/storage/photo-develop-preset-row-current-v1.ts';
import { photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { copyImageDevelopSelectedSettingsV3 } from '../src/common/editor/imaging/image-develop-settings-selected-v3.ts';
import { createImageDevelopSelectedPresetV3 } from '../src/common/editor/imaging/image-develop-preset-selected-v3.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mediaRestoreAllocation, mediaRestoreChunks, mediaRestoreFixture, mediaRestorePhoto, mediaRestoreRoot } from './helpers/lightscaper-media-restore-fixture.ts';
import { LUT_BODY, LUT_REFERENCE } from './helpers/lightscaper-lut-archive-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { exportPhotoCatalogArchiveV7 } from '../src/lightscaper/archive/catalog-archive-export-v7.ts';
import { restorePhotoLibraryArchiveCurrentV1 } from '../src/lightscaper/controller/photo-library-archive-restore-current-v1.ts';
import { createPhotoLibraryRestoreRuntimeCurrentV1 } from '../src/lightscaper/photo-library-restore-runtime-current-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 as POINTER } from '../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { PHOTO_LIBRARY_RESTORE_JOURNAL_KEY_V1 as JOURNAL, photoLibraryRestoreCommitKeyV1 } from '../src/lightscaper/storage/photo-library-restore-journal-v1.ts';
import { savedArchiveReaderV3 } from './helpers/lightscaper-saved-collection-archive-fixture.ts';
import { rewriteLutArchiveFixture } from './helpers/lightscaper-lut-archive-fixture.ts';

const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const ORIGINAL = new Uint8Array([1, 2, 3]);
// Independent SCMASK01 framing and SHA; no production body encoder writes this oracle.
const BODY = new Uint8Array([83, 67, 77, 65, 83, 75, 48, 49, 2, 0, 0, 0, 2, 0, 0, 0, 0, 255, 127, 64]);
const sha256 = createHash('sha256').update(BODY).digest('hex');
const BRUSH = Object.freeze({ storageKey: `brush-mask-v1:2:2:${sha256}`, sha256, width: 2, height: 2, byteLength: BODY.length });
const MASKS = [{ id: BRUSH.storageKey, entry: `assets/masks/${sha256}.scmask`, reference: BRUSH }];
const LUTS = [{ id: LUT_REFERENCE.storageKey, entry: `assets/luts/${LUT_REFERENCE.sha256}.cube`, reference: LUT_REFERENCE }];
const SELECTION = { effectTypes: 'all' as const, geometry: true, localAdjustments: true, repairs: true };
const REPAIRS = { schemaVersion: 1, spots: [{ id: 'clone', mode: 'clone', enabled: true, target: { x: .75, y: .5 },
	source: { x: .25, y: .5 }, radius: .1, feather: 0, opacity: 1 }] };
function document() {
	const source = mediaRestorePhoto(), version = source.versions[0]!;
	return normalizePhotoDocumentV3({ ...source, schemaVersion: 3, versions: [{ ...version,
		develop: replaceImageDevelopRepairSpotsV1(version.develop, REPAIRS) }] });
}
function presetRow(count = 1, sourceRef: string = BRUSH.storageKey) {
	const legacy = mediaRestorePhoto().versions[0]!.develop;
	const develop = replaceImageDevelopRepairSpotsV1({ ...legacy, processVersion: 2,
		effects: [{ id: 'lut', type: 'cube-lut-profile-v1', enabled: false, params: { lut: LUT_REFERENCE } }],
		masks: [{ schemaVersion: 2, name: 'Retained unused brush', id: 'unused', kind: 'matte',
			inputs: [{ name: 'paint', kind: 'alpha', sourceRef }],
			nodes: [{ id: 'gradient', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }], outputNodeId: 'gradient' }], maskBindings: [] }, REPAIRS);
	const settings = copyImageDevelopSelectedSettingsV3({ schemaVersion: 3, develop, selection: SELECTION });
	const preset = createImageDevelopSelectedPresetV3({ schemaVersion: 3, id: 'preset', name: 'Retained repairs', settings });
	return normalizePhotoDevelopPresetRowCurrentV1({ schemaVersion: 3, kind: 'photo-develop-presets', catalogId: 'catalog-1', revision: 29,
		presets: count ? [preset] : [] }, 'catalog-1');
}

test('native restore stage retains complete Photo3 repairs and reopens through the real Current catalog', async () => {
	const f = mediaRestoreFixture(), photo = document(), wire = JSON.stringify(photo);
	const stage = await createPhotoCatalogRestoreStageCurrentV1({ indexedDB: f.factory, databaseName: f.names.catalogDatabaseName,
		root: mediaRestoreRoot(1), savedState: null, restoreAllocation: mediaRestoreAllocation() });
	try {
		await stage.writePhoto(photo); const receipt = await stage.finish(); assert.equal(receipt.photoCount, 1); await stage.close();
		const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: f.factory, databaseName: f.names.catalogDatabaseName,
			verifyOriginal: async () => undefined, verifyResources: async () => undefined });
		try { assert.deepEqual(await catalog.loadPhoto(photo.catalogId, photo.id), photo); } finally { await catalog.close(); }
		assert.equal(JSON.stringify(photo), wire); assert.equal(f.raw(f.names.catalogDatabaseName).stats.activeTransactions, 0);
	} finally { await stage.rollback(); }
});

test('allocated Current media candidate authenticates preset-only LUT and unused brush at the unchanged native preset key', async () => {
	const f = mediaRestoreFixture(), photo = mediaRestorePhoto(), row = presetRow(), wire = JSON.stringify(row);
	const stage = await createPhotoCatalogRestoreStageCurrentV1({ indexedDB: f.factory, databaseName: f.names.catalogDatabaseName,
		root: mediaRestoreRoot(1), savedState: null, restoreAllocation: mediaRestoreAllocation() });
	let owner: PhotoMediaRestoreCandidateV2 | undefined;
	try {
		await stage.writePhoto(photo); await stage.finish();
		// This Current frontdoor shares the positively allocated native owner with legacy restoration.
		owner = await Reflect.apply(createPhotoMediaRestoreCandidateCurrentV1, undefined, [{ indexedDB: f.factory,
			allocation: mediaRestoreAllocation(), root: mediaRestoreRoot(1),
			developPresets: { rowSchemaVersion: 3, revision: 29, presetCount: 1 }, lutResources: LUTS, maskRasters: MASKS }]) as PhotoMediaRestoreCandidateV2;
		await owner.writeOriginal(photo, mediaRestoreChunks(ORIGINAL)); await owner.writeDevelopPresets(row);
		await owner.writeLut(LUT_REFERENCE, LUT_BODY); await owner.writeMaskRaster(BRUSH, BODY);
		const receipt = await owner.finish(); assert.equal(receipt.photoCount, 1); assert.equal(receipt.originalByteLength, ORIGINAL.length);
		assert.equal(receipt.lutCount, 1); assert.equal(receipt.lutByteLength, LUT_BODY.length); assert.equal(await owner.finish(), receipt);
		const raw = f.raw(f.names.mediaDatabaseName), nativeRow = raw.records(f.names.mediaDatabaseName, 'settings').filter(value => value.key === photoDevelopPresetsKeyV1(photo.catalogId));
		assert.deepEqual(nativeRow, [{ key: photoDevelopPresetsKeyV1(photo.catalogId), value: row }]);
		assert.deepEqual(raw.records(f.names.mediaDatabaseName, 'analysis').find(value => value.key === BRUSH.storageKey)!.value.bytes, BODY);
		assert.deepEqual(raw.records(f.names.mediaDatabaseName, 'analysis').find(value => value.key === LUT_REFERENCE.storageKey)!.value.bytes, LUT_BODY);
		assert.equal(raw.records(f.names.mediaDatabaseName, 'catalogOriginalRoots')[0]!.importId, null);
		assert.equal(raw.stats.activeTransactions, 0); assert.equal(JSON.stringify(row), wire);
		assert.equal(f.opens.some(value => value.name === 'lightscaper-photo-media-v2'), false);
	} finally { await owner?.rollback(); await stage.rollback(); }
});

test('positive empty sticky Row3 preserves its exact revision and physical presence in a zero-photo allocation', async () => {
	const f = mediaRestoreFixture(), row = presetRow(0);
	const stage = await createPhotoCatalogRestoreStageCurrentV1({ indexedDB: f.factory, databaseName: f.names.catalogDatabaseName,
		root: mediaRestoreRoot(0), savedState: null, restoreAllocation: mediaRestoreAllocation() });
	let owner: PhotoMediaRestoreCandidateV2 | undefined;
	try {
		await stage.finish();
		owner = await Reflect.apply(createPhotoMediaRestoreCandidateCurrentV1, undefined, [{ indexedDB: f.factory,
			allocation: mediaRestoreAllocation(), root: mediaRestoreRoot(0), developPresets: { rowSchemaVersion: 3, revision: 29, presetCount: 0 } }]) as PhotoMediaRestoreCandidateV2;
		await owner.writeDevelopPresets(row); const receipt = await owner.finish(); assert.equal(receipt.originalCount, 0); assert.equal(receipt.lutCount, 0);
		assert.deepEqual(f.raw(f.names.mediaDatabaseName).records(f.names.mediaDatabaseName, 'settings').filter(value => value.key === photoDevelopPresetsKeyV1('catalog-1')), [{ key: photoDevelopPresetsKeyV1('catalog-1'), value: row }]);
	} finally { await owner?.rollback(); await stage.rollback(); }
});

test('permanent legacy restore frontdoors still refuse Photo3 and Row3 before Original or body delivery', async () => {
	const f = mediaRestoreFixture(), stage = await createPhotoCatalogRestoreStageV2({ indexedDB: f.factory,
		databaseName: f.names.catalogDatabaseName, root: mediaRestoreRoot(1), savedState: null, restoreAllocation: mediaRestoreAllocation() });
	try { await assert.rejects(stage.writePhoto(document()), /unsupported/iu); }
	finally { await stage.rollback(); }
	const other = mediaRestoreFixture();
	await assert.rejects(Reflect.apply(createPhotoMediaRestoreCandidateV2, undefined, [{ indexedDB: other.factory,
		allocation: mediaRestoreAllocation(), root: mediaRestoreRoot(0), developPresets: { rowSchemaVersion: 3, revision: 29, presetCount: 0 } }]) as Promise<PhotoMediaRestoreCandidateV2>, /unsupported/iu);
	assert.deepEqual(other.opens, []); assert.deepEqual(other.deleted, []);
});

async function retire(...owners: readonly ({ rollback(): Promise<void> } | undefined)[]): Promise<void> {
	const outcomes = await Promise.allSettled(owners.map(owner => owner?.rollback()));
	const errors = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : []);
	if (errors.length === 1) throw errors[0]; if (errors.length) throw new AggregateError(errors, 'Native restore fixture retirement failed.');
}
async function joined(run: () => Promise<void>, cleanup: () => Promise<void>): Promise<void> {
	let failed = false, primary: unknown; const errors: unknown[] = [];
	try { await run(); } catch (error) { failed = true; primary = error; }
	try { await cleanup(); } catch (error) { errors.push(error); }
	if (failed) { if (errors.length) throw new AggregateError([primary, ...errors], 'Restore assertion and joined retirement failed.', { cause: primary }); throw primary; }
	if (errors.length) throw errors[0];
}

test('complete Current preset/body audit refuses native corruption, extra namespaces and row mutation before custody promotion', async () => {
	for (const mode of ['missing', 'corrupt', 'future', 'row', 'foreign-input'] as const) {
		const f = mediaRestoreFixture(), photo = document(), row = presetRow(1, mode === 'foreign-input' ? 'foreign:alpha' : BRUSH.storageKey);
		const stage = await createPhotoCatalogRestoreStageCurrentV1({ indexedDB: f.factory, databaseName: f.names.catalogDatabaseName,
			root: mediaRestoreRoot(1), savedState: null, restoreAllocation: mediaRestoreAllocation() });
		let owner: PhotoMediaRestoreCandidateV2 | undefined;
		await joined(async () => {
			await stage.writePhoto(photo); await stage.finish();
			owner = await createPhotoMediaRestoreCandidateCurrentV1({ indexedDB: f.factory, allocation: mediaRestoreAllocation(), root: mediaRestoreRoot(1),
				developPresets: { rowSchemaVersion: 3, revision: 29, presetCount: 1 }, lutResources: LUTS, maskRasters: MASKS });
			await owner.writeOriginal(photo, mediaRestoreChunks(ORIGINAL)); await owner.writeDevelopPresets(row);
			await owner.writeLut(LUT_REFERENCE, LUT_BODY); await owner.writeMaskRaster(BRUSH, BODY);
			const raw = f.raw(f.names.mediaDatabaseName);
			if (mode === 'missing') await f.remove(f.names.mediaDatabaseName, 'analysis', BRUSH.storageKey);
			if (mode === 'corrupt') {
				const body = raw.records(f.names.mediaDatabaseName, 'analysis').find(value => value.key === BRUSH.storageKey)!;
				const bytes = BODY.slice(); bytes[16] ^= 1; raw.seedRecord(f.names.mediaDatabaseName, 'analysis', { ...body, value: { ...body.value, bytes } });
			}
			if (mode === 'future') raw.seedRecord(f.names.mediaDatabaseName, 'analysis', { key: `brush-mask-v9:2:2:${'f'.repeat(64)}`, value: null });
			if (mode === 'row') raw.seedRecord(f.names.mediaDatabaseName, 'settings', { key: photoDevelopPresetsKeyV1(photo.catalogId), value: { ...row, revision: 30 } });
			await assert.rejects(owner.finish());
			assert.ok(raw.records(f.names.mediaDatabaseName, 'catalogOriginalRoots').every(value => value.importId === mediaRestoreAllocation().operationId));
			assert.equal(raw.stats.activeTransactions, 0); assert.deepEqual(raw.records(f.names.mediaDatabaseName, 'mediaAssets')[0]!.sha256, photo.original.contentSha256);
		}, () => retire(owner, stage));
		assert.deepEqual(new Set(f.deleted), new Set([f.names.mediaDatabaseName, f.names.catalogDatabaseName]));
	}
});

test('Current native brush insertion captures bytes and Close joins its actual held body ACK', async () => {
	const f = mediaRestoreFixture(), entered = deferred<void>(), release = deferred<void>(); let held = false;
	const owner = await createPhotoMediaRestoreCandidateCurrentV1({ indexedDB: f.factory, allocation: mediaRestoreAllocation(), root: mediaRestoreRoot(1), maskRasters: MASKS });
	f.observeTransactions((transaction, stores, mode) => {
		if (held || mode !== 'readwrite' || (typeof stores === 'string' ? stores : [...stores].join(',')) !== 'analysis') return; held = true;
		let handler: IDBTransaction['oncomplete'] = null;
		Object.defineProperty(transaction, 'oncomplete', { configurable: true, set(value: IDBTransaction['oncomplete']) { handler = value; },
			get() { return (event: Event) => { entered.resolve(); void release.promise.then(() => { if (handler) Reflect.apply(handler, transaction, [event]); }); }; } });
	});
	const bytes = BODY.slice(), writing = owner.writeMaskRaster(BRUSH, bytes); bytes.fill(0);
	await joined(async () => {
		await Promise.race([entered.promise, writing.then(() => { throw Error('Native body ACK was not held.'); })]);
		const closing = owner.close(); assert.equal(await remainsPending(writing), true); assert.equal(await remainsPending(closing), true);
		release.resolve(); await writing; await closing;
		assert.deepEqual(f.raw(f.names.mediaDatabaseName).records(f.names.mediaDatabaseName, 'analysis')[0]!.value.bytes, BODY);
		await assert.rejects(owner.writeMaskRaster(BRUSH, BODY), /retired|failed/iu);
	}, async () => { release.resolve(); await Promise.allSettled([writing]); f.observeTransactions(null); await owner.rollback(); });
});

test('Current Original iterator keeps a revoked opaque primary and distinct joined retirement failure', async () => {
	const f = mediaRestoreFixture(), owner = await createPhotoMediaRestoreCandidateCurrentV1({ indexedDB: f.factory, allocation: mediaRestoreAllocation(), root: mediaRestoreRoot(1) });
	const revoked = Proxy.revocable({}, {}), primary = revoked.proxy, cleanup = new Error('Actual iterator retirement'); revoked.revoke(); let returned = 0;
	const source = { [Symbol.asyncIterator]() { return this; }, next(): Promise<IteratorResult<Uint8Array>> { return Promise.reject(primary); },
		return(): Promise<IteratorResult<Uint8Array>> { returned++; return Promise.reject(cleanup); } };
	await joined(async () => {
		const outcome = await owner.writeOriginal(document(), source).then(() => ({ error: undefined }), (error: unknown) => ({ error }));
		assert.ok(outcome.error instanceof AggregateError); assert.equal(outcome.error.errors.length, 2);
		assert.ok(Object.is(outcome.error.errors[0], primary)); assert.ok(Object.is(outcome.error.errors[1], cleanup)); assert.equal(returned, 1);
		assert.equal(f.raw(f.names.mediaDatabaseName).records(f.names.mediaDatabaseName, 'catalogOriginalRoots').length, 0);
	}, () => owner.rollback());
});

test('Current catalog readiness authenticates complete admitted Photo3 metadata rather than only native counts', async () => {
	const f = mediaRestoreFixture(), photo = document();
	const stage = await createPhotoCatalogRestoreStageCurrentV1({ indexedDB: f.factory, databaseName: f.names.catalogDatabaseName,
		root: mediaRestoreRoot(1), savedState: null, restoreAllocation: mediaRestoreAllocation() });
	await joined(async () => {
		await stage.writePhoto(photo);
		f.raw(f.names.catalogDatabaseName).seedRecord(f.names.catalogDatabaseName, 'photos', {
			key: `${photo.catalogId}|${photo.id}`, document: normalizePhotoDocumentV3({ ...photo, revision: photo.revision + 1 }),
		});
		await assert.rejects(stage.finish(), /differs from its admitted delivery/iu);
		assert.equal(f.raw(f.names.catalogDatabaseName).records(f.names.catalogDatabaseName, 'photoQueryBuildStatesV2')[0]!.ready, false);
	}, () => stage.rollback());
});

test('Current preset digest is rechecked after native Original custody promotion before the final candidate ACK', async () => {
	const f = mediaRestoreFixture(), photo = document(), row = presetRow();
	const stage = await createPhotoCatalogRestoreStageCurrentV1({ indexedDB: f.factory, databaseName: f.names.catalogDatabaseName,
		root: mediaRestoreRoot(1), savedState: null, restoreAllocation: mediaRestoreAllocation() });
	let owner: PhotoMediaRestoreCandidateV2 | undefined, changed = false;
	await joined(async () => {
		await stage.writePhoto(photo); await stage.finish();
		owner = await createPhotoMediaRestoreCandidateCurrentV1({ indexedDB: f.factory, allocation: mediaRestoreAllocation(), root: mediaRestoreRoot(1),
			developPresets: { rowSchemaVersion: 3, revision: 29, presetCount: 1 }, lutResources: LUTS, maskRasters: MASKS });
		await owner.writeOriginal(photo, mediaRestoreChunks(ORIGINAL)); await owner.writeDevelopPresets(row);
		await owner.writeLut(LUT_REFERENCE, LUT_BODY); await owner.writeMaskRaster(BRUSH, BODY);
		f.observeTransactions((transaction, stores, mode) => {
			if (changed || mode !== 'readwrite' || typeof stores === 'string' || [...stores].sort().join(',') !== 'catalogOriginalRoots,mediaAssets,settings') return;
			let handler: IDBTransaction['oncomplete'] = null;
			Object.defineProperty(transaction, 'oncomplete', { configurable: true, set(value: IDBTransaction['oncomplete']) { handler = value; },
				get() { return (event: Event) => { if (handler) Reflect.apply(handler, transaction, [event]); changed = true;
					f.raw(f.names.mediaDatabaseName).seedRecord(f.names.mediaDatabaseName, 'settings', { key: photoDevelopPresetsKeyV1(photo.catalogId), value: { ...row, revision: 30 } }); }; } });
		});
		await assert.rejects(owner.finish(), /preset row/iu); assert.equal(changed, true);
		assert.equal(f.raw(f.names.mediaDatabaseName).records(f.names.mediaDatabaseName, 'catalogOriginalRoots')[0]!.importId, null);
	}, async () => { f.observeTransactions(null); await retire(owner, stage); });
});

test('complete Current candidate retains its real final native ACK after an opaque late abort', async () => {
	const f = mediaRestoreFixture(), photo = document(), row = presetRow(), stop = new AbortController();
	const stage = await createPhotoCatalogRestoreStageCurrentV1({ indexedDB: f.factory, databaseName: f.names.catalogDatabaseName,
		root: mediaRestoreRoot(1), savedState: null, restoreAllocation: mediaRestoreAllocation() });
	let owner: PhotoMediaRestoreCandidateV2 | undefined, acknowledged = 0, traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('Opaque abort reflected.'); }, getPrototypeOf() { traps++; throw Error('Opaque abort classified.'); } });
	await joined(async () => {
		await stage.writePhoto(photo); await stage.finish();
		owner = await createPhotoMediaRestoreCandidateCurrentV1({ indexedDB: f.factory, allocation: mediaRestoreAllocation(), root: mediaRestoreRoot(1), signal: stop.signal,
			developPresets: { rowSchemaVersion: 3, revision: 29, presetCount: 1 }, lutResources: LUTS, maskRasters: MASKS });
		await owner.writeOriginal(photo, mediaRestoreChunks(ORIGINAL)); await owner.writeDevelopPresets(row);
		await owner.writeLut(LUT_REFERENCE, LUT_BODY); await owner.writeMaskRaster(BRUSH, BODY);
		f.observeTransactions((transaction, stores, mode) => {
			if (mode !== 'readwrite' || typeof stores === 'string' || [...stores].sort().join(',') !== 'analysis,catalogOriginalRoots,mediaAssetChunks,mediaAssets,settings') return;
			let handler: IDBTransaction['oncomplete'] = null;
			Object.defineProperty(transaction, 'oncomplete', { configurable: true, set(value: IDBTransaction['oncomplete']) { handler = value; },
				get() { return (event: Event) => { if (handler) Reflect.apply(handler, transaction, [event]); acknowledged++; stop.abort(reason); }; } });
		});
		const receipt = await owner.finish(); assert.equal(acknowledged, 1); assert.equal(traps, 0); assert.equal(receipt.photoCount, 1);
		assert.equal(await owner.finish(), receipt); assert.equal(receipt.originalByteLength, ORIGINAL.length); assert.equal(receipt.lutCount, 1);
		assert.equal(f.raw(f.names.mediaDatabaseName).stats.activeTransactions, 0); assert.deepEqual(f.raw(f.names.mediaDatabaseName).records(f.names.mediaDatabaseName, 'settings').filter(value => value.key === photoDevelopPresetsKeyV1(photo.catalogId)), [{ key: photoDevelopPresetsKeyV1(photo.catalogId), value: row }]);
	}, async () => { f.observeTransactions(null); await retire(owner, stage); });
});

const OLD_POINTER = Object.freeze({ schemaVersion: 1, kind: 'photo-library', catalogId: 'old-library' });
async function restoration() {
	const native = mediaRestoreFixture(), active = new Set<string>();
	const locks = { async request(name: string, _options: unknown, consume: (lock: Lock | null) => Promise<unknown>) {
		if (active.has(name)) return consume(null); active.add(name);
		try { return await consume({ name, mode: 'exclusive' }); } finally { active.delete(name); }
	} } as unknown as LockManager;
	const anchor = new PhotoMediaStoreV1({ indexedDB: native.factory, locks, preferOpfs: false }); await anchor.ready();
	await anchor.settingsRepository.put(POINTER, OLD_POINTER); let count = 0;
	const settings = { ...anchor.settingsRepository }, options = { name: 'Restored repairs', indexedDB: native.factory, locks, settings,
		allocateToken: () => (++count === 1 ? 'a' : 'b').repeat(32) };
	return { ...native, locks, active, anchor, settings, options };
}
async function archive() {
	const result = await exportPhotoCatalogArchiveV7(mediaRestoreRoot(1), [{ photo: document(), original: new Blob([ORIGINAL]) }], [], null, [], presetRow(),
		{ async withBytes(reference, consume) { assert.deepEqual(reference, LUT_REFERENCE); return consume(LUT_BODY); } },
		{ async withBytes(reference, consume) { assert.deepEqual(reference, BRUSH); return consume(BODY); } });
	assert.ok(result.blob); assert.equal(result.document.schemaVersion, 7); return result.blob;
}

test('Current coordinator joins archive reader retirement before pointer publication then reopens exact Photo3, Row3 and native bodies', async () => {
	const f = await restoration(), entered = deferred<void>(), release = deferred<void>();
	const work = restorePhotoLibraryArchiveCurrentV1(await archive(), { ...f.options, readerFactories: { blob: savedArchiveReaderV3(async () => { entered.resolve(); await release.promise; }) } });
	await joined(async () => {
		await Promise.race([entered.promise, work.then(() => { throw Error('Archive reader retirement did not hold publication.'); })]);
		assert.equal(await remainsPending(work), true); assert.deepEqual(await f.settings.get(POINTER), OLD_POINTER);
		assert.equal(await f.settings.get(photoLibraryRestoreCommitKeyV1('a'.repeat(32))), undefined);
		release.resolve(); const receipt = await work; assert.equal(receipt.originalByteLength, ORIGINAL.length); assert.equal(receipt.photoCount, 1);
		assert.equal(await f.settings.get(JOURNAL), undefined); assert.ok(await f.settings.get(photoLibraryRestoreCommitKeyV1('a'.repeat(32))));
		const media = new PhotoMediaStoreV1({ indexedDB: f.factory, databaseName: f.names.mediaDatabaseName, preferOpfs: false, locks: null });
		const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: f.factory, databaseName: f.names.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
		await joined(async () => {
			await media.ready(); const restored = await catalog.loadPhoto('catalog-1', document().id); assert.deepEqual(restored, document()); assert.ok(restored);
			await media.verifyOriginal(restored.original); const original = await media.mediaRepository.loadAsset(restored.original.storageKey); assert.ok(original);
			assert.deepEqual(new Uint8Array(await original.arrayBuffer()), ORIGINAL); assert.deepEqual(await media.settingsRepository.get(photoDevelopPresetsKeyV1('catalog-1')), presetRow());
			const source = await media.getMaskRasterResources(); await source.source.withBytes(BRUSH, bytes => assert.deepEqual(bytes, BODY));
			const lut = await media.getCubeLutResources(); await lut.source.withBytes(LUT_REFERENCE, bytes => assert.deepEqual(bytes, LUT_BODY));
		}, async () => { const outcomes = await Promise.allSettled([catalog.close(), media.close()]);
			const errors = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : []); if (errors.length) throw new AggregateError(errors, 'Reopened native owners did not retire.'); });
		await f.anchor.close(); assert.deepEqual(f.deleted, []); assert.equal(f.active.size, 0);
	}, async () => { release.resolve(); await Promise.allSettled([work]); await f.anchor.close(); });
});

test('Current coordinator refuses an independently corrupted preset-only body and joins both fresh namespace rollbacks', async () => {
	const f = await restoration(), input = await rewriteLutArchiveFixture(await archive(), files => {
		const bytes = files.get(`assets/masks/${sha256}.scmask`)!; bytes[16] ^= 1;
	});
	await joined(async () => {
		await assert.rejects(restorePhotoLibraryArchiveCurrentV1(input, f.options));
		assert.deepEqual(await f.settings.get(POINTER), OLD_POINTER); assert.equal(await f.settings.get(JOURNAL), undefined);
		assert.equal(await f.settings.get(photoLibraryRestoreCommitKeyV1('a'.repeat(32))), undefined);
		await f.anchor.close(); assert.deepEqual(new Set(f.deleted), new Set([f.names.mediaDatabaseName, f.names.catalogDatabaseName])); assert.equal(f.active.size, 0);
	}, () => f.anchor.close());
});

test('Current pointer publication retains its genuine positive native CAS ACK across opaque late cancellation', async () => {
	const f = await restoration(), stop = new AbortController(); let publications = 0, traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('Native publication reason inspected.'); }, getPrototypeOf() { traps++; throw Error('Native publication reason classified.'); } });
	const publish = f.settings.replaceIfCurrentAndPutIfAbsent;
	f.settings.replaceIfCurrentAndPutIfAbsent = async function (this: typeof f.settings, ...args: Parameters<typeof publish>) {
		assert.equal(this, f.settings); const acknowledged = await Reflect.apply(publish, this, args) as boolean;
		assert.equal(acknowledged, true); publications++; stop.abort(reason); return acknowledged;
	};
	await joined(async () => {
		const receipt = await restorePhotoLibraryArchiveCurrentV1(await archive(), { ...f.options, signal: stop.signal });
		assert.equal(publications, 1); assert.equal(traps, 0); assert.equal(receipt.photoCount, 1); assert.deepEqual(receipt.notices, []);
		assert.ok(await f.settings.get(photoLibraryRestoreCommitKeyV1('a'.repeat(32)))); assert.notDeepEqual(await f.settings.get(POINTER), OLD_POINTER);
		await f.anchor.close(); assert.deepEqual(f.deleted, []); assert.equal(f.active.size, 0);
	}, () => f.anchor.close());
});

test('Current restore runtime pins actual native factory receiver and returns one cached Close after real publication', async () => {
	const f = await restoration(), open = f.factory.open;
	f.factory.open = new Proxy(function (this: unknown, ...args: Parameters<IDBFactory['open']>) {
		assert.equal(this, f.factory); return Reflect.apply(open, f.factory, args) as IDBOpenDBRequest;
	}, { get() { throw new Error('Native factory function metadata was inspected.'); } });
	const runtime = createPhotoLibraryRestoreRuntimeCurrentV1({ name: 'Pinned repair restore', indexedDB: f.factory, locks: f.locks });
	f.factory.open = () => { throw new Error('Retired host factory method was reread.'); };
	await joined(async () => {
		const receipt = await runtime.restoreArchive(await archive()); assert.equal(receipt.photoCount, 1);
		const closing = runtime.close(); assert.equal(runtime.close(), closing); await closing;
		await assert.rejects(runtime.restoreArchive(await archive()), /closed/iu);
	}, async () => { f.factory.open = open; const outcomes = await Promise.allSettled([runtime.close(), f.anchor.close()]);
		const errors = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : []); if (errors.length) throw new AggregateError(errors, 'Restore runtime fixture retirement failed.'); });
});
