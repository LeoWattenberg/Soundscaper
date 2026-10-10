/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { PhotoRasterExportJournalOwnerV1, PhotoRasterExportJournalErrorV1 } from '../src/lightscaper/storage/photo-raster-export-journal-owner-v1.ts';
import { createPhotoRasterExportJournalV1 } from '../src/lightscaper/storage/photo-raster-export-journal-v1.ts';
import { capturePhotoRasterExportBatchV1 } from '../src/lightscaper/controller/photo-raster-export-batch-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { seedCurrentAppPhoto, currentAppLocks } from './helpers/lightscaper-current-app-fixture.tsx';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });

function journal(catalogId = 'catalog', batchId = 'batch') {
	const plan = capturePhotoRasterExportBatchV1({ schemaVersion: 1, batchId, format: 'png', filenameTemplate: '{index}-{name}',
		members: [{ photoId: 'one', versionId: 'master', expectedRevision: 2, sourceFileName: 'One.png' }, { photoId: 'two', versionId: 'master', expectedRevision: 3, sourceFileName: 'Two.png' }] });
	return createPhotoRasterExportJournalV1(plan, { catalogId, filenameTemplate: '{index}-{name}',
		bindings: plan.members.map(() => ({ originalSha256: 'a'.repeat(64), recipeSha256: 'b'.repeat(64), lutSha256: [] })) });
}
function store() {
	return { value: undefined as unknown, deletes: 0,
		async get(_key: string) { return this.value; },
		async putIfAbsent(_key: string, next: unknown) { if (this.value !== undefined) return false; this.value = structuredClone(next); return true; },
		async replaceIfCurrent(_key: string, before: unknown, next: unknown) { if (JSON.stringify(before) !== JSON.stringify(this.value)) return false; this.value = structuredClone(next); return true; },
		async deleteIfCurrent(key: string, before: unknown) { assert.equal(key, 'photo-library:raster-export-journal:v1:catalog'); this.deletes++; if (JSON.stringify(before) !== JSON.stringify(this.value)) return false; this.value = undefined; return true; },
	};
}
const review = (owner: PhotoRasterExportJournalOwnerV1) => ({ batchId: owner.current!.batchId, revision: owner.current!.revision, reviewed: true as const });

test('forgetting unfinished history requires explicit review of the exact current batch and revision', async () => {
	const settings = store(), owner = new PhotoRasterExportJournalOwnerV1(settings, 'catalog'); await owner.create(journal());
	for (const input of [{ ...review(owner), reviewed: false }, { ...review(owner), batchId: 'other' }, { ...review(owner), revision: 2 }, { ...review(owner), authority: new Blob() }]) {
		await assert.rejects(async () => owner.discardUnfinished(input));
	}
	let reads = 0;
	await assert.rejects(async () => owner.discardUnfinished(Object.defineProperty(review(owner), 'reviewed', { get() { reads++; return true; } })));
	assert.equal(reads, 0); assert.equal(settings.deletes, 0);
	for (const member of owner.current!.members) { await owner.started(member.jobId); await owner.committed(member.jobId, { status: 'download-started', method: 'download', fileName: member.fileName, size: 3 }); }
	await assert.rejects(owner.discardUnfinished(review(owner)), /unfinished/u); assert.equal(settings.deletes, 0); await owner.closeAndJoin();
});

test('explicit discard forgets only retained history, permits fresh work and never revisits a committed download', async () => {
	const settings = store(), owner = new PhotoRasterExportJournalOwnerV1(settings, 'catalog'); await owner.create(journal());
	await owner.started('batch:1'); await owner.committed('batch:1', { status: 'download-started', method: 'download', fileName: '1-One.png', size: 3 });
	await owner.started('batch:2'); await owner.discardUnfinished(review(owner));
	assert.equal(settings.deletes, 1); assert.equal(settings.value, undefined); assert.equal(owner.current, null);
	await owner.create(journal('catalog', 'fresh')); assert.equal(owner.current!.batchId, 'fresh'); await owner.closeAndJoin();
});

test('a competing or foreign row is never removed using stale review', async () => {
	for (const next of [journal('catalog', 'other'), { foreign: true }]) {
		const settings = store(), owner = new PhotoRasterExportJournalOwnerV1(settings, 'catalog'); await owner.create(journal());
		settings.value = next; await assert.rejects(owner.discardUnfinished(review(owner)), PhotoRasterExportJournalErrorV1);
		assert.deepEqual(settings.value, next); assert.equal(owner.current!.batchId, 'batch'); await owner.closeAndJoin();
	}
});

test('lost deletion acknowledgement reconciles only actual absence and preserves a replacement', async () => {
	for (const replace of [false, true]) {
		const settings = store(), remove = settings.deleteIfCurrent, owner = new PhotoRasterExportJournalOwnerV1(settings, 'catalog');
		// Construct again after pinning the actual loss-of-ACK transport.
		settings.deleteIfCurrent = async function (...args) { await remove.apply(this, args); if (replace) this.value = journal('catalog', 'other'); throw undefined; };
		await owner.closeAndJoin(); const captured = new PhotoRasterExportJournalOwnerV1(settings, 'catalog'); await captured.create(journal());
		if (replace) { await assert.rejects(captured.discardUnfinished(review(captured)), error => error instanceof PhotoRasterExportJournalErrorV1 && error.failure.cause === undefined); assert.deepEqual(settings.value, journal('catalog', 'other')); }
		else { await captured.discardUnfinished(review(captured)); assert.equal(captured.current, null); }
		await captured.closeAndJoin();
	}
});

test('opaque deletion and readback failures remain distinct without inspecting either reason', async () => {
	const settings = store(), primary = new Proxy({}, { get() { assert.fail('Opaque primary inspected'); } }), cleanup = Symbol('readback');
	settings.deleteIfCurrent = async () => { throw primary; };
	const owner = new PhotoRasterExportJournalOwnerV1(settings, 'catalog'); await owner.create(journal());
	settings.get = async () => { throw cleanup; };
	// The existing captured reader has stable authority; acquire the faulty pair together.
	await owner.closeAndJoin(); const faulty = new PhotoRasterExportJournalOwnerV1(settings, 'catalog');
	settings.get = async () => settings.value;
	// Its captured failing reader must refuse before any deletion if loading fails.
	await assert.rejects(faulty.load(), error => error === cleanup); await faulty.closeAndJoin();
	const configured = store(); let failRead = false;
	configured.get = async () => { if (failRead) throw cleanup; return configured.value; };
	configured.deleteIfCurrent = async () => { failRead = true; throw primary; };
	const active = new PhotoRasterExportJournalOwnerV1(configured, 'catalog'); await active.create(journal());
	await assert.rejects(active.discardUnfinished(review(active)), error => error instanceof PhotoRasterExportJournalErrorV1 && error.failure.cause === primary && error.failure.cleanup?.cause === cleanup);
	await active.closeAndJoin();
});

test('close fences new admission while joining an already held reviewed deletion', async () => {
	const settings = store(), entered = deferred<void>(), held = deferred<void>(), remove = settings.deleteIfCurrent;
	settings.deleteIfCurrent = async function (...args) { entered.resolve(); await held.promise; return remove.apply(this, args); };
	const owner = new PhotoRasterExportJournalOwnerV1(settings, 'catalog'); await owner.create(journal());
	const work = owner.discardUnfinished(review(owner)); await entered.promise;
	const close = owner.closeAndJoin(); assert.equal(await remainsPending(close), true); assert.throws(() => owner.discardUnfinished(review(owner)));
	held.resolve(); await work; await close; assert.equal(settings.value, undefined);
});

test('optional deletion pins its receiver, refuses accessors and fails closed for older transports', async () => {
	const settings = store(), owner = new PhotoRasterExportJournalOwnerV1(settings, 'catalog'); settings.deleteIfCurrent = async () => assert.fail('Late substituted deletion');
	await owner.create(journal()); await owner.discardUnfinished(review(owner)); await owner.closeAndJoin();
	let reads = 0; assert.throws(() => new PhotoRasterExportJournalOwnerV1(Object.defineProperty(store(), 'deleteIfCurrent', { get() { reads++; return async () => true; } }), 'catalog')); assert.equal(reads, 0);
	const older = store(); Reflect.deleteProperty(older, 'deleteIfCurrent'); const unsupported = new PhotoRasterExportJournalOwnerV1(older, 'catalog');
	await unsupported.create(journal()); await assert.rejects(unsupported.discardUnfinished(review(unsupported)), /unavailable/u); assert.ok(older.value); await unsupported.closeAndJoin();
});

test('the actual selected Session forgets only its reviewed queue across close and reopen', async () => {
	const native = mediaRestoreFixture(), seeded = await seedCurrentAppPhoto(native.factory, currentAppLocks()), session = await seeded.createSession();
	try {
		const access = await session.exportJournal!.open(), owner = new PhotoRasterExportJournalOwnerV1(access.settings, access.catalogId);
		await owner.create(journal(access.catalogId)); await owner.started('batch:1');
		await assert.rejects(access.settings.deleteIfCurrent!('photo-library:managed-import', owner.current), /journal/u);
		await assert.rejects(access.settings.deleteIfCurrent!(`photo-library:raster-export-journal:v1:${access.catalogId}`, journal('other')), /catalog/u);
		await owner.discardUnfinished(review(owner)); await owner.closeAndJoin();
	} finally { await session.close(); }
	const reopened = await seeded.createSession();
	try {
		const access = await reopened.exportJournal!.open(), owner = new PhotoRasterExportJournalOwnerV1(access.settings, access.catalogId); assert.equal(await owner.load(), null); await owner.closeAndJoin();
		const photo = await reopened.develop.read({ schemaVersion: 2, photoId: seeded.photo.id }); assert.equal(photo.revision, seeded.photo.revision);
		await reopened.close(); await assert.rejects(access.settings.deleteIfCurrent!(`photo-library:raster-export-journal:v1:${access.catalogId}`, journal(access.catalogId)), /closed/u);
	} finally { await reopened.close(); }
});
