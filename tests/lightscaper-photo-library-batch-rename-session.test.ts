/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoLibraryBatchRenamePortV1, PhotoLibraryBatchRenameReceiptV1 } from '../src/common/editor/photo-library-batch-rename-port-v1.ts';
import { PhotoLibrarySessionV1 } from '../src/lightscaper/controller/photo-library-session.ts';
import { PhotoCommandOwnerV1 } from '../src/lightscaper/controller/photo-command-owner.ts';
import type { PhotoLibrarySessionPortsV1 } from '../src/lightscaper/controller/photo-library-session-ports.ts';
import { PHOTO_BATCH_RENAME_RECEIPT_MAXIMUM_BYTES_V1, PHOTO_BATCH_RENAME_ERROR_MAXIMUM_UNITS_V1 } from '../src/lightscaper/controller/photo-library-batch-rename-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { PhotoCatalogRevisionConflictError } from '../src/lightscaper/catalog/repository-types.ts';
import type { PhotoDocumentV1 } from '../src/lightscaper/catalog/types.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const rename = { template: '{stem}-{sequence}.{extension}', sequenceStart: 7, sequencePadding: 2 };

function fixture(count = 3, maximum = false) {
	const catalogId = maximum ? 'c'.repeat(128) : 'catalog-1';
	const documents = new Map<string, PhotoDocumentV1>();
	for (let index = 0; index < count; index++) {
		const source = photoArchiveFixture(index + 1).photo;
		const photo = normalizePhotoDocumentV1({ ...source, catalogId,
			id: maximum ? `${'p'.repeat(125)}${String(index).padStart(3, '0')}` : source.id,
			metadata: { ...source.metadata, fileName: maximum ? '\ud800'.repeat(256) : `Photo-${index + 1}.png`, title: 'Keep title' },
			extractedMetadata: { schemaVersion: 1, container: 'png', exif: null, iptc: null, issues: ['unsupported-text-encoding'] } });
		documents.set(photo.id, photo);
	}
	const root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: catalogId, name: 'Library', revision: 0, photoCount: count, folders: [], keywords: [], collections: [] });
	const calls: string[] = [];
	let beforeRead = async (_id: string) => undefined;
	let beforeSave = async (_photo: PhotoDocumentV1) => undefined;
	let afterSave = async (_photo: PhotoDocumentV1) => undefined;
	let cleanupError: unknown;
	const ports: PhotoLibrarySessionPortsV1 = {
		initialize: async () => { calls.push('initialize'); return root; }, closeResources: async () => { calls.push('close'); },
		exclusive: async (_id, run, signal) => {
			calls.push('lock'); const result = await run(signal);
			if (cleanupError !== undefined) throw cleanupError;
			return result;
		},
		catalog: {
			loadCatalog: async () => root,
			loadPhoto: async (catalog, photoId) => { assert.equal(catalog, catalogId); calls.push(`read:${photoId}`); await beforeRead(photoId); return documents.get(photoId) ?? null; },
			savePhoto: async (value, expected, options = {}) => {
				const photo = normalizePhotoDocumentV1(value); options.signal?.throwIfAborted();
				await beforeSave(photo);
				const current = documents.get(photo.id); if (current?.revision !== expected) throw new PhotoCatalogRevisionConflictError('photo');
				const stored = normalizePhotoDocumentV1({ ...photo, revision: expected + 1 }); documents.set(photo.id, stored);
				calls.push(`write:${photo.id}`); await afterSave(stored); return stored;
			},
			saveCatalog: async () => { throw new Error('Unexpected catalog write'); }, publishPhotos: async () => { throw new Error('Unexpected publication'); },
			readSummaryPage: async () => { throw new Error('Unexpected summary scan'); }, readQueryPage: async () => { throw new Error('Unexpected query scan'); },
			rebuildQueryIndexPage: async () => { throw new Error('Unexpected query rebuild'); },
		},
		journal: { get: async () => undefined, putIfAbsent: async () => { throw new Error('Unexpected journal write'); }, deleteIfCurrent: async () => true },
		media: { writeAsset: async () => { throw new Error('Unexpected original write'); }, custody: {
			findDigestPage: async () => { throw new Error('Unexpected original read'); }, stage: async () => undefined,
			promote: async () => undefined, releaseStaged: async () => undefined, readPage: async () => ({ roots: [], afterKey: null }),
		} },
	};
	const session: PhotoLibrarySessionV1 & PhotoLibraryBatchRenamePortV1 = new PhotoLibrarySessionV1(ports);
	const ids = [...documents.keys()];
	return { session, calls, documents, ids, root, beforeRead: (run: typeof beforeRead) => { beforeRead = run; },
		beforeSave: (run: typeof beforeSave) => { beforeSave = run; }, afterSave: (run: typeof afterSave) => { afterSave = run; },
		cleanupError: (value: unknown) => { cleanupError = value; },
		plan: async () => session.planBatchRename({ ...await session.readBatchRenameSelection(ids), rename }),
	};
}

function preserved(actual: PhotoDocumentV1, before: PhotoDocumentV1): void {
	assert.deepEqual(actual.original, before.original); assert.deepEqual(actual.extractedMetadata, before.extractedMetadata);
	assert.deepEqual(actual.versions, before.versions); assert.equal(actual.activeVersionId, before.activeVersionId);
	assert.equal(actual.metadata.title, before.metadata.title);
}

test('scalar selection captures requested order one document at a time and planning is synchronous without resource work', async () => {
	const f = fixture();
	try {
		const snapshot = await f.session.readBatchRenameSelection(['photo-3', 'photo-1']);
		assert.deepEqual(snapshot, { schemaVersion: 1, catalogId: 'catalog-1', selection: [
			{ photoId: 'photo-3', expectedRevision: 0, fileName: 'Photo-3.png' }, { photoId: 'photo-1', expectedRevision: 0, fileName: 'Photo-1.png' },
		] });
		const calls = f.calls.length, plan = f.session.planBatchRename({ ...snapshot, rename });
		assert.equal(plan.items[1]?.fileName, 'Photo-1-08.png'); assert.equal(f.calls.length, calls);
		assert.ok(Object.isFrozen(snapshot.selection)); assert.ok(snapshot.selection.every(Object.isFrozen));
	} finally { await f.session.close(); }
});

test('invalid complete plans, selections, inverses and native cancellation refuse before lazy initialization or any write', async () => {
	const f = fixture(); let getters = 0;
	try {
		for (const ids of [[], ['photo-1', 'photo-1'], new Array<string>(1), Array.from({ length: 65 }, (_, index) => `photo-${index}`)]) {
			await assert.rejects(f.session.readBatchRenameSelection(ids));
		}
		const request = { schemaVersion: 1 as const, catalogId: 'catalog-1', selection: [{ photoId: 'photo-1', expectedRevision: 0, fileName: 'One.png' }], rename };
		const plan = f.session.planBatchRename(request);
		await assert.rejects(f.session.renamePhotos({ ...plan, items: [{ ...plan.items[0]!, fileName: 'Forged.png' }] }));
		assert.throws(() => f.session.planBatchRename({ ...request, selection: [...request.selection, { photoId: 'photo-2', expectedRevision: 0, fileName: 'x'.repeat(256) }] }));
		await assert.rejects(f.session.undoBatchRename({ schemaVersion: 1, kind: 'photo-batch-rename-undo', catalogId: 'catalog-1',
			items: [{ index: 0, photoId: 'photo-1', expectedRevision: 1, fileName: 'New.png', previousDisplayName: 'Old.png' },
				{ index: 1, photoId: 'photo-2', expectedRevision: 1, fileName: 'New.png', previousDisplayName: '' }] }));
		const pre = new AbortController(); pre.abort();
		Object.defineProperty(pre.signal, 'throwIfAborted', { get: () => { getters++; return () => undefined; } });
		await assert.rejects(f.session.renamePhotos(plan, { signal: pre.signal }), { name: 'AbortError' });
		assert.equal(getters, 0); assert.deepEqual(f.calls, []);
	} finally { await f.session.close(); }
});

test('descriptor-based array and record admission never invokes hostile Proxy get traps', async () => {
	const f = fixture(); let getters = 0;
	const trap = { get: () => { getters++; throw new Error('get trap'); } };
	try {
		const snapshot = await f.session.readBatchRenameSelection(new Proxy(['photo-1'], trap));
		const request = new Proxy({ ...snapshot, selection: new Proxy([...snapshot.selection], trap), rename }, trap);
		const plan = f.session.planBatchRename(request);
		const transported = new Proxy({ ...plan, items: new Proxy([...plan.items], trap) }, trap);
		assert.equal((await f.session.renamePhotos(transported)).items[0]?.status, 'renamed');
		assert.equal(getters, 0);
	} finally { await f.session.close(); }
});

test('one serial batch uses selected-slot numbering and preserves immutable source/develop state through ordinary commands', async () => {
	const f = fixture(), before = new Map(f.documents);
	try {
		const snapshot = await f.session.readBatchRenameSelection(['photo-3', 'photo-1', 'photo-2']);
		const plan = f.session.planBatchRename({ ...snapshot, rename }), receipt = await f.session.renamePhotos(plan);
		assert.equal(receipt.completion, 'finished'); assert.equal(receipt.action, 'rename');
		assert.deepEqual(receipt.items.map(item => [item.index, item.photoId, item.fileName, item.revision, item.status]), [
			[0, 'photo-3', 'Photo-3-07.png', 1, 'renamed'], [1, 'photo-1', 'Photo-1-08.png', 1, 'renamed'], [2, 'photo-2', 'Photo-2-09.png', 1, 'renamed'],
		]);
		assert.equal(receipt.undo?.items.length, 3);
		for (const [key, photo] of f.documents) preserved(photo, before.get(key)!);
		assert.deepEqual(f.calls.filter(call => call.startsWith('write:')), ['write:photo-3', 'write:photo-1', 'write:photo-2']);
		assert.equal(Object.isFrozen(receipt), true); assert.ok(receipt.items.every(Object.isFrozen));
	} finally { await f.session.close(); }
});

test('no-op slots save nothing and produce no inverse, while later failures retain their sequence positions', async () => {
	const f = fixture();
	try {
		const snapshot = await f.session.readBatchRenameSelection(f.ids);
		const noOp = await f.session.renamePhotos(f.session.planBatchRename({ ...snapshot, rename: { ...rename, template: '{stem}.{extension}' } }));
		assert.ok(noOp.items.every(item => item.status === 'unchanged')); assert.equal(noOp.undo, null);
		assert.equal(f.calls.filter(call => call.startsWith('write:')).length, 0);
		f.beforeSave(async photo => { if (photo.id === 'photo-2') throw new Error('quota full'); return undefined; });
		const result = await f.session.renamePhotos(f.session.planBatchRename({ ...snapshot, rename }));
		assert.equal(result.completion, 'finished');
		assert.deepEqual(result.items.map(item => [item.index, item.status, item.fileName, item.revision]), [
			[0, 'renamed', 'Photo-1-07.png', 1], [1, 'failed', 'Photo-2-08.png', null], [2, 'renamed', 'Photo-3-09.png', 1],
		]);
		assert.equal(result.items[1]?.message, 'quota full'); assert.deepEqual(result.undo?.items.map(item => item.index), [0, 2]);
	} finally { await f.session.close(); }
});

test('missing or externally revised photos fail individually without changing or renumbering later photos', async () => {
	const f = fixture();
	try {
		const plan = await f.plan(); f.documents.delete('photo-1');
		const old = f.documents.get('photo-2')!; f.documents.set('photo-2', normalizePhotoDocumentV1({ ...old, revision: 1, rating: 5 }));
		const result = await f.session.renamePhotos(plan);
		assert.deepEqual(result.items.map(item => item.status), ['failed', 'failed', 'renamed']);
		assert.equal(f.documents.get('photo-2')?.metadata.fileName, 'Photo-2.png'); assert.equal(f.documents.get('photo-3')?.metadata.fileName, 'Photo-3-09.png');
		assert.deepEqual(result.undo?.items.map(item => item.index), [2]);
	} finally { await f.session.close(); }
});

test('undo restores fresh fences through metadata commands and retains conflicting or failed entries for explicit retry', async () => {
	const f = fixture(), before = new Map(f.documents);
	try {
		const renamed = await f.session.renamePhotos(await f.plan()); assert.ok(renamed.undo);
		const changed = f.documents.get('photo-2')!; f.documents.set('photo-2', normalizePhotoDocumentV1({ ...changed, revision: 2, rating: 5 }));
		f.beforeSave(async photo => { if (photo.id === 'photo-3') throw new Error('quota full'); return undefined; });
		const result = await f.session.undoBatchRename(renamed.undo);
		assert.equal(result.completion, 'finished'); assert.deepEqual(result.items.map(item => item.status), ['restored', 'failed', 'failed']);
		assert.deepEqual(result.undo?.items, renamed.undo.items.slice(1)); assert.equal(f.documents.get('photo-1')?.metadata.fileName, 'Photo-1.png');
		assert.equal(f.documents.get('photo-2')?.metadata.fileName, 'Photo-2-08.png');
		f.beforeSave(async () => undefined); assert.ok(result.undo);
		const retried = await f.session.undoBatchRename(result.undo);
		assert.deepEqual(retried.items.map(item => item.status), ['failed', 'restored']); assert.deepEqual(retried.undo?.items, [renamed.undo.items[1]]);
		for (const [key, photo] of f.documents) preserved(photo, before.get(key)!);
		const repeated = await f.session.undoBatchRename(renamed.undo); assert.ok(repeated.items.every(item => item.status === 'failed'));
	} finally { await f.session.close(); }
});

test('cancellation during a nonabortable committed save retains durable ACK and inverse, refuses overlap and waits before admitting another writer', async () => {
	const f = fixture(), entered = deferred<void>(), held = deferred<undefined>(), stop = new AbortController();
	const plan = await f.plan(); f.afterSave(async () => { entered.resolve(); return held.promise; });
	const work = f.session.renamePhotos(plan, { signal: stop.signal });
	try {
		await entered.promise; stop.abort(); assert.equal(await remainsPending(work), true);
		await assert.rejects(f.session.renamePhotos(plan), /already pending/iu); await assert.rejects(f.session.setRating('photo-2', 5), /already pending/iu);
		held.resolve(undefined); const result = await work;
		assert.equal(result.completion, 'cancelled'); assert.deepEqual(result.items.map(item => item.status), ['renamed']);
		assert.equal(result.undo?.items[0]?.expectedRevision, 1); assert.equal(result.undo?.items[0]?.previousDisplayName, 'Photo-1.png');
		f.afterSave(async () => undefined); await f.session.setRating('photo-2', 5); assert.equal(f.documents.get('photo-2')?.rating, 5);
	} finally { held.resolve(undefined); await work; await f.session.close(); }
});

test('close cancels and joins a pending native save before releasing resources while preserving the receipt', async () => {
	const f = fixture(), entered = deferred<void>(), held = deferred<undefined>();
	const plan = await f.plan(); f.afterSave(async () => { entered.resolve(); return held.promise; });
	const work = f.session.renamePhotos(plan);
	try {
		await entered.promise; const closing = f.session.close(); assert.equal(closing, f.session.close());
		assert.equal(await remainsPending(closing), true); assert.equal(f.calls.includes('close'), false);
		held.resolve(undefined); const result = await work; await closing;
		assert.equal(result.completion, 'cancelled'); assert.equal(result.items[0]?.revision, 1); assert.equal(result.undo?.items.length, 1);
		assert.equal(f.calls.at(-1), 'close');
		await assert.rejects(f.session.renamePhotos(plan), /closed/iu);
	} finally { held.resolve(undefined); await work; await f.session.close(); }
});

test('real-task yields let cancellation stop later owners, but an abort after the final ACK remains finished', async () => {
	const f = fixture(), stop = new AbortController();
	try {
		const plan = await f.plan(); f.afterSave(async () => { setTimeout(() => { stop.abort(); }, 0); return undefined; });
		const result = await f.session.renamePhotos(plan, { signal: stop.signal });
		assert.equal(result.completion, 'cancelled'); assert.equal(result.items.length, 1);
		assert.equal(f.calls.filter(call => call === 'write:photo-2').length, 0);
	} finally { await f.session.close(); }
	const final = fixture(1), late = new AbortController();
	try {
		const plan = await final.plan(); final.afterSave(async () => { late.abort(); return undefined; });
		const result = await final.session.renamePhotos(plan, { signal: late.signal });
		assert.equal(result.completion, 'finished'); assert.equal(result.items[0]?.status, 'renamed');
	} finally { await final.session.close(); }
});

test('a cancelled undo removes its acknowledged entry and retains all unattempted inverse fences', async () => {
	const f = fixture(), stop = new AbortController();
	try {
		const renamed = await f.session.renamePhotos(await f.plan()); assert.ok(renamed.undo);
		f.afterSave(async () => { stop.abort(); return undefined; });
		const result = await f.session.undoBatchRename(renamed.undo, { signal: stop.signal });
		assert.equal(result.completion, 'cancelled'); assert.equal(result.items[0]?.status, 'restored');
		assert.deepEqual(result.undo?.items, renamed.undo.items.slice(1));
	} finally { await f.session.close(); }
});

test('selection cancellation joins a held read, returns no partial snapshot, and refuses any queued writer', async () => {
	const f = fixture(), entered = deferred<void>(), held = deferred<undefined>(), stop = new AbortController();
	f.beforeRead(async () => { entered.resolve(); return held.promise; });
	const work = f.session.readBatchRenameSelection(f.ids, { signal: stop.signal }), settled = work.catch(() => undefined);
	try {
		await entered.promise; stop.abort(); assert.equal(await remainsPending(work), true);
		await assert.rejects(f.session.setRating('photo-1', 5), /already pending/iu);
		held.resolve(undefined); await assert.rejects(work, { name: 'AbortError' });
		assert.equal(f.calls.filter(call => call.startsWith('read:')).length, 1);
	} finally { held.resolve(undefined); await settled; await f.session.close(); }
});

test('lease cleanup failure after publication returns interrupted receipt with the durable ACK and inverse', async () => {
	const f = fixture(1);
	try {
		const plan = await f.plan(); f.cleanupError(new Error('lease cleanup failed'));
		const result = await f.session.renamePhotos(plan);
		assert.equal(result.completion, 'interrupted'); assert.equal(result.message, 'lease cleanup failed');
		assert.equal(result.items[0]?.revision, 1); assert.equal(result.undo?.items.length, 1);
	} finally { await f.session.close(); }
});

test('final durable ACK and late cancellation preserve an independent lease cleanup failure', async () => {
	const f = fixture(1), stop = new AbortController();
	try {
		const plan = await f.plan();
		f.afterSave(async () => { stop.abort(); return undefined; });
		f.cleanupError(new Error('Final lease cleanup failed'));
		const result = await f.session.renamePhotos(plan, { signal: stop.signal });
		assert.equal(result.completion, 'interrupted'); assert.equal(result.message, 'Final lease cleanup failed');
		assert.equal(result.items[0]?.status, 'renamed'); assert.equal(result.items[0]?.revision, 1); assert.equal(result.undo?.items.length, 1);
		assert.equal(f.documents.get('photo-1')?.metadata.fileName, plan.items[0]?.fileName);
	} finally { await f.session.close(); }
});

test('64 maximally escaped failure records and interruption message fit the finite whole receipt budget', async () => {
	const f = fixture(64, true);
	try {
		const snapshot = await f.session.readBatchRenameSelection(f.ids);
		const plan = f.session.planBatchRename({ ...snapshot, rename: { ...rename, template: '\ud801'.repeat(256) } });
		f.beforeSave(async () => { throw new Error('\ud802'.repeat(2048)); }); f.cleanupError(new Error('\ud803'.repeat(2048)));
		const result: PhotoLibraryBatchRenameReceiptV1 = await f.session.renamePhotos(plan);
		const bytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
		assert.equal(PHOTO_BATCH_RENAME_RECEIPT_MAXIMUM_BYTES_V1, 1024 * 1024);
		assert.equal(result.items.length, 64); assert.ok(result.items.every(item => item.status === 'failed' && item.message.length === PHOTO_BATCH_RENAME_ERROR_MAXIMUM_UNITS_V1));
		assert.equal(result.message?.length, PHOTO_BATCH_RENAME_ERROR_MAXIMUM_UNITS_V1); assert.ok(bytes < PHOTO_BATCH_RENAME_RECEIPT_MAXIMUM_BYTES_V1, String(bytes));
		assert.equal(bytes, 811_097);
	} finally { await f.session.close(); }
});

test('64 maximal acknowledged names and revision fences fit the whole receipt including its complete inverse', async () => {
	const f = fixture(64, true);
	for (const [key, photo] of f.documents) f.documents.set(key, normalizePhotoDocumentV1({ ...photo, revision: Number.MAX_SAFE_INTEGER - 1 }));
	try {
		const snapshot = await f.session.readBatchRenameSelection(f.ids);
		assert.equal(new TextEncoder().encode(JSON.stringify(snapshot)).byteLength, 110_832);
		const plan = f.session.planBatchRename({ ...snapshot, rename: { ...rename, template: '\ud801'.repeat(256) } });
		const result = await f.session.renamePhotos(plan);
		assert.equal(result.completion, 'finished'); assert.equal(result.undo?.items.length, 64);
		assert.ok(result.items.every(item => item.status === 'renamed' && item.revision === Number.MAX_SAFE_INTEGER));
		const bytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
		assert.ok(bytes < PHOTO_BATCH_RENAME_RECEIPT_MAXIMUM_BYTES_V1, String(bytes));
	} finally { await f.session.close(); }
});

test('a full64-photo rename and restore retains at most one live command owner/history and closes it with the Session', async () => {
	const f = fixture(64), live = new Set<PhotoCommandOwnerV1>();
	const open = PhotoCommandOwnerV1.open;
	let maximumOwners = 0, opened = 0;
	PhotoCommandOwnerV1.open = async (...args) => {
		const owner = await open(...args), close = owner.close.bind(owner);
		live.add(owner); opened++; maximumOwners = Math.max(maximumOwners, live.size);
		owner.close = () => close().finally(() => { live.delete(owner); });
		return owner;
	};
	try {
		const renamed = await f.session.renamePhotos(await f.plan()); assert.ok(renamed.undo);
		assert.equal(live.size, 1); assert.equal([...live][0]?.history.past.length, 1);
		const restored = await f.session.undoBatchRename(renamed.undo);
		assert.equal(restored.undo, null); assert.ok(restored.items.every(item => item.status === 'restored'));
		assert.equal(live.size, 1); assert.equal([...live][0]?.history.past.length, 1);
		assert.equal(maximumOwners, 1); assert.equal(opened, 128);
		await f.session.close(); assert.equal(live.size, 0);
	} finally { PhotoCommandOwnerV1.open = open; await f.session.close(); }
});

test('maximal failed undo receipt preserves all64 inverse fences and bounded errors without exceeding1MiB', async () => {
	const f = fixture(64, true);
	try {
		await f.session.readBatchRenameSelection(f.ids);
		const undo = { schemaVersion: 1 as const, kind: 'photo-batch-rename-undo' as const, catalogId: f.root.id,
			items: f.ids.map((photoId, index) => ({ index, photoId, expectedRevision: Number.MAX_SAFE_INTEGER,
				fileName: '\ud800'.repeat(256), previousDisplayName: '\ud801'.repeat(256) })) };
		f.beforeRead(async () => { throw new Error('\ud802'.repeat(2048)); }); f.cleanupError(new Error('\ud803'.repeat(2048)));
		const result = await f.session.undoBatchRename(undo);
		assert.equal(result.completion, 'interrupted'); assert.deepEqual(result.undo, undo);
		assert.equal(result.items.length, 64); assert.ok(result.items.every(item => item.status === 'failed'));
		const bytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
		assert.equal(bytes, 1_022_550); assert.ok(bytes < PHOTO_BATCH_RENAME_RECEIPT_MAXIMUM_BYTES_V1);
	} finally { await f.session.close(); }
});

test('one durable restore and63 maximal failures cannot lose the ACK at final receipt admission', async () => {
	const f = fixture(64, true);
	try {
		await f.session.readBatchRenameSelection(f.ids);
		const first = f.documents.get(f.ids[0]!)!;
		f.documents.set(first.id, normalizePhotoDocumentV1({ ...first, revision: 1 }));
		const undo = { schemaVersion: 1 as const, kind: 'photo-batch-rename-undo' as const, catalogId: f.root.id,
			items: f.ids.map((photoId, index) => ({ index, photoId, expectedRevision: index === 0 ? 1 : Number.MAX_SAFE_INTEGER,
				fileName: '\ud800'.repeat(256), previousDisplayName: '\ud801'.repeat(256) })) };
		f.beforeRead(async key => { if (key !== first.id) throw new Error('\ud802'.repeat(2048)); return undefined; });
		f.cleanupError(new Error('\ud803'.repeat(2048)));
		const result = await f.session.undoBatchRename(undo);
		assert.equal(result.completion, 'interrupted'); assert.equal(result.items[0]?.status, 'restored'); assert.equal(result.items[0]?.revision, 2);
		assert.equal(f.documents.get(first.id)?.metadata.fileName, '\ud801'.repeat(256));
		assert.deepEqual(result.undo?.items, undo.items.slice(1)); assert.equal(result.items.length, 64);
		assert.ok(new TextEncoder().encode(JSON.stringify(result)).byteLength < PHOTO_BATCH_RENAME_RECEIPT_MAXIMUM_BYTES_V1);
	} finally { await f.session.close(); }
});

test('hostile rejection message descriptors cannot erase earlier durable ACKs or prevent later selected slots', async () => {
	let getters = 0, inspections = 0;
	const rejection: object = new Proxy({}, { getOwnPropertyDescriptor: () => { inspections++; throw rejection; } });
	const getter = Object.defineProperty({}, 'message', { get: () => { getters++; throw new Error('message getter'); } });
	for (const error of [rejection, getter]) {
		const f = fixture();
		try {
			const plan = await f.plan(); f.beforeSave(async photo => { if (photo.id === 'photo-2') throw error; return undefined; });
			const result = await f.session.renamePhotos(plan);
			assert.equal(result.completion, 'finished'); assert.deepEqual(result.items.map(item => item.status), ['renamed', 'failed', 'renamed']);
			assert.equal(result.items[1]?.message, 'Photo batch change failed.'); assert.deepEqual(result.undo?.items.map(item => item.index), [0, 2]);
		} finally { await f.session.close(); }
	}
	assert.equal(inspections, 1); assert.equal(getters, 0);
	const f = fixture(1);
	try {
		const plan = await f.plan(); f.cleanupError(rejection);
		const result = await f.session.renamePhotos(plan);
		assert.equal(result.completion, 'interrupted'); assert.equal(result.message, 'Photo batch change failed.');
		assert.equal(result.items[0]?.status, 'renamed'); assert.equal(result.undo?.items.length, 1);
	} finally { await f.session.close(); }
});
