/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { capturePhotoLibraryBackupSourceV2, type PhotoLibraryBackupSourcePortsV2 } from '../src/lightscaper/controller/photo-library-backup-source-v2.ts';
import { exportPhotoLibraryBackupV5, type PhotoLibraryBackupPortsV5 } from '../src/lightscaper/controller/photo-library-backup-v5.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1OrV2, type PhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { PhotoCatalogRevisionConflictError } from '../src/lightscaper/catalog/repository-types.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import type { PhotoDocumentV1 } from '../src/lightscaper/catalog/types.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const CREATED = '2026-10-11T00:00:00.000Z';
const BRUSH = `brush-mask-v1:1:1:${'a'.repeat(64)}`;
type Placement = 'active' | 'inactive' | 'redo' | 'snapshot' | 'disabled' | 'unbound';
type Photo = PhotoDocumentV1 | PhotoDocumentV2;
function brush(enabled = false, bound = false) {
	return { ...defaultImageDevelopStateV1(), processVersion: 2,
		effects: [{ id: 'tone', type: 'tone-ladder-v1', enabled, params: { exposure: 1 } }],
		masks: [{ schemaVersion: 1, id: 'brush', kind: 'mask',
			inputs: [{ name: 'Brush', sourceRef: BRUSH, kind: 'raster' }, { name: 'Unused', sourceRef: BRUSH, kind: 'raster' }],
			nodes: [{ id: 'output', kind: 'raster', inputName: 'Brush', channel: 'alpha' }], outputNodeId: 'output' }],
		maskBindings: bound ? [{ effectId: 'tone', maskId: 'brush' }] : [] };
}
function photo(index: number, placement?: Placement): Photo {
	const source = photoArchiveFixture(index).photo, id = `photo-${String(index).padStart(4, '0')}`;
	const original = { ...source.original, id: `source-${String(index).padStart(4, '0')}` };
	const master = source.versions[0]!;
	if (!placement) return normalizePhotoDocumentV1OrV2({ ...source, id, original });
	const develop = brush(placement === 'active', placement === 'active' || placement === 'disabled');
	const version = placement === 'inactive' ? master : placement === 'redo' || placement === 'snapshot' ? {
		...master, workspace: { schemaVersion: 2, kind: 'photo-develop-workspace', cursor: 0,
			entries: [{ label: 'Original', createdAt: CREATED, develop: master.develop },
				...(placement === 'redo' ? [{ label: 'Undone brush', createdAt: CREATED, develop }] : [])],
			snapshots: placement === 'snapshot' ? [{ id: 'retained', name: 'Retained brush', createdAt: CREATED, develop }] : [] },
	} : { ...master, develop };
	return normalizePhotoDocumentV1OrV2({ ...source, schemaVersion: 2, id, original,
		versions: [version, ...(placement === 'inactive' ? [{ ...master, id: 'inactive', kind: 'virtual-copy', name: 'Inactive brush', develop }] : [])] });
}
function fixture(count = 2, placement?: Placement) {
	const photos = Array.from({ length: count }, (_, index) => photo(index + 1, index === count - 1 ? placement : undefined));
	const root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog-1', name: 'Preflight', revision: 7, photoCount: count, folders: [], keywords: [], collections: [] });
	const reads: string[] = [], pages: number[] = []; let snapshots = 0, originalReads = 0, indexRevision = 11;
	const ports: PhotoLibraryBackupSourcePortsV2 = { catalog: {
		async readSnapshot(catalogId) { assert.equal(this, ports.catalog); assert.equal(catalogId, root.id); snapshots++; return { catalog: root, indexRevision }; },
		async readSummaryPage(catalogId, options = {}) {
			assert.equal(this, ports.catalog); assert.equal(catalogId, root.id);
			const after = options.continuation?.afterKey ?? '', all = photos.map(photoSummary).filter(item => item.key > after);
			const items = all.slice(0, 64); pages.push(items.length);
			return { items, continuation: all.length > 64 ? { catalogId: root.id, indexRevision,
				scope: `${root.id}|all`, afterKey: items.at(-1)!.key } : null };
		},
		async loadPhoto(catalogId, photoId) { assert.equal(this, ports.catalog); assert.equal(catalogId, root.id); reads.push(photoId); return photos.find(photo => photo.id === photoId) ?? null; },
	}, async loadOriginal(original) { assert.equal(this, ports); originalReads++; assert.ok(photos.some(photo => photo.original.id === original.id)); return photoArchiveFixture().original; } };
	return { photos, root, ports, reads, pages, snapshots: () => snapshots, originals: () => originalReads,
		changeIndex() { indexRevision++; } };
}
function archivePorts(f: ReturnType<typeof fixture>, resourceReads: () => void): PhotoLibraryBackupPortsV5 {
	return { ...f.ports, loadOriginal: (...args) => Reflect.apply(f.ports.loadOriginal, f.ports, args), catalog: { ...f.ports.catalog,
		async captureSmartCollectionArchiveV1() { return { context: { schemaVersion: 1, kind: 'photo-smart-collection-archive-context',
			catalogId: f.root.id, catalogRevision: f.root.revision, indexRevision: 11, state: null },
			definitions: (async function* () {})(), async verify() {} }; },
	}, stacks: {
		async readStackState() { return { schemaVersion: 1, kind: 'photo-stack-state', catalogId: f.root.id, revision: 0, stackCount: 0 }; },
		async readStackPage() { return { items: [], continuation: null }; }, async loadStack() { return null; },
	}, developPresetSettings: { async readEntry() { return { present: false }; } },
		lutResources: { async withBytes() { resourceReads(); assert.fail('Brush preflight must precede resource bodies.'); } } };
}

for (const placement of ['active', 'inactive', 'redo', 'snapshot', 'disabled', 'unbound'] as const) {
	test(`complete backup capture refuses ${placement} brush behind a neutral prefix without reading any original`, async () => {
		const f = fixture(2, placement), before = JSON.stringify(f.photos);
		await assert.rejects(capturePhotoLibraryBackupSourceV2(f.root.id, f.ports), /brush|portable|resource/iu);
		assert.deepEqual(f.reads, f.photos.map(photo => photo.id)); assert.equal(f.originals(), 0);
		assert.equal(JSON.stringify(f.photos), before);
	});
}

test('actual V5 export preflights across the 64-row boundary before original, LUT or stream output', async () => {
	const f = fixture(65, 'snapshot'), events: string[] = []; let resources = 0;
	const ports = archivePorts(f, () => { resources++; });
	// Inventory borrowing deliberately changes receivers; the fixture forwards
	// that actual borrowed catalog back to its captured original receiver.
	ports.catalog.readSnapshot = (...args) => Reflect.apply(f.ports.catalog.readSnapshot, f.ports.catalog, args);
	ports.catalog.readSummaryPage = (...args) => Reflect.apply(f.ports.catalog.readSummaryPage, f.ports.catalog, args);
	ports.catalog.loadPhoto = (...args) => Reflect.apply(f.ports.catalog.loadPhoto, f.ports.catalog, args);
	const writable = new WritableStream<Uint8Array>({ write() { events.push('write'); }, close() { events.push('close'); }, abort() { events.push('abort'); } });
	await assert.rejects(exportPhotoLibraryBackupV5(f.root.id, ports, { writable }), /brush|portable|resource/iu);
	assert.deepEqual(f.pages, [64, 1]); assert.equal(f.reads.length, 65); assert.equal(f.originals(), 0);
	assert.equal(resources, 0); assert.deepEqual(events, []); assert.equal(writable.locked, false);
});

test('neutral complete capture walks metadata, preserves lazy bodies and rereads authentic original order', async () => {
	const f = fixture(65), before = JSON.stringify(f.photos);
	const source = await capturePhotoLibraryBackupSourceV2(f.root.id, f.ports);
	assert.equal(f.reads.length, 65); assert.deepEqual(f.pages, [64, 1]); assert.equal(f.originals(), 0);
	assert.ok(f.snapshots() >= 2); assert.deepEqual(source.initial.catalog, f.root);
	const delivered: Photo[] = [];
	for await (const record of source.originals) { delivered.push(record.photo); assert.deepEqual(Array.from(new Uint8Array(await record.original.arrayBuffer())), [1, 2, 3]); }
	assert.deepEqual(delivered, f.photos); assert.equal(f.originals(), 65); assert.equal(f.reads.length, 130);
	assert.equal(JSON.stringify(f.photos), before); await source.verifyCatalog();
});

test('preflight joins held metadata cancellation and preserves the exact native opaque reason', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const read = f.ports.catalog.loadPhoto, reason = Proxy.revocable({}, {}); reason.revoke();
	f.ports.catalog.loadPhoto = async (...args) => { entered.resolve(); await release.promise; return Reflect.apply(read, f.ports.catalog, args); };
	let failure: unknown; const work = capturePhotoLibraryBackupSourceV2(f.root.id, f.ports, stop.signal);
	const joined = work.then(() => { assert.fail('Cancelled preflight fulfilled.'); }, (error: unknown) => { failure = error; });
	void joined.catch(() => undefined);
	try {
		assert.equal(await Promise.race([entered.promise.then(() => true), work.then(() => false)]), true, 'Capture must actually reach metadata preflight.');
		stop.abort(reason.proxy); assert.equal(await remainsPending(joined), true); assert.equal(f.originals(), 0);
		release.resolve(); await joined; assert.equal(failure, reason.proxy); assert.equal(f.originals(), 0);
	} finally { release.resolve(); await joined.catch(() => undefined); }
});

test('held native metadata failure is propagated without reflecting its opaque identity', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>(), reason = Proxy.revocable({}, {}); reason.revoke();
	f.ports.catalog.loadPhoto = async () => { entered.resolve(); await release.promise; throw reason.proxy; };
	let failure: unknown; const work = capturePhotoLibraryBackupSourceV2(f.root.id, f.ports);
	const joined = work.then(() => { assert.fail('Failed metadata fulfilled.'); }, (error: unknown) => { failure = error; });
	void joined.catch(() => undefined);
	try {
		assert.equal(await Promise.race([entered.promise.then(() => true), work.then(() => false)]), true);
		assert.equal(await remainsPending(joined), true); release.resolve(); await joined;
		assert.equal(failure, reason.proxy); assert.equal(f.originals(), 0);
	} finally { release.resolve(); await joined.catch(() => undefined); }
});

test('complete preflight fences root/index drift before returning an exportable lazy source', async () => {
	const f = fixture(), read = f.ports.catalog.loadPhoto;
	f.ports.catalog.loadPhoto = async (...args) => { const photo = await Reflect.apply(read, f.ports.catalog, args); f.changeIndex(); return photo; };
	await assert.rejects(capturePhotoLibraryBackupSourceV2(f.root.id, f.ports), PhotoCatalogRevisionConflictError);
	assert.equal(f.originals(), 0);
});

test('preflight captures all methods and receivers before a held snapshot without inspecting callable metadata', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>(); let traps = 0;
	const snapshot = f.ports.catalog.readSnapshot, read = f.ports.catalog.loadPhoto;
	f.ports.catalog.readSnapshot = async (...args) => { entered.resolve(); await release.promise; return Reflect.apply(snapshot, f.ports.catalog, args); };
	f.ports.catalog.loadPhoto = new Proxy(read, { get() { traps++; throw new Error('Callable metadata is not authority.'); } });
	const work = capturePhotoLibraryBackupSourceV2(f.root.id, f.ports);
	try {
		await entered.promise; f.ports.catalog.loadPhoto = async () => { assert.fail('A replacement method was acquired after yield.'); };
		release.resolve(); await work; assert.equal(f.reads.length, 2); assert.equal(traps, 0); assert.equal(f.originals(), 0);
	} finally { release.resolve(); await work.catch(() => undefined); }
});

test('malformed full Photo accessor refuses during preflight without invoking the accessor or acquiring originals', async () => {
	const f = fixture(); let getterReads = 0;
	const malformed = { ...f.photos[1]! }; Object.defineProperty(malformed, 'versions', { enumerable: true, get() { getterReads++; throw new Error('Accessor read'); } });
	f.ports.catalog.loadPhoto = async (_catalogId, photoId) => photoId === f.photos[1]!.id ? malformed : f.photos[0]!;
	await assert.rejects(capturePhotoLibraryBackupSourceV2(f.root.id, f.ports), TypeError);
	assert.equal(getterReads, 0); assert.equal(f.originals(), 0);
});
