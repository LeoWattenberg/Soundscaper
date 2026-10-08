/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import { PhotoCommandOwnerV1 } from '../src/lightscaper/controller/photo-command-owner.ts';
import { planPhotoBatchRenameV1, normalizePhotoBatchRenamePlanV1, applyPhotoBatchRenameItemV1,
	PHOTO_BATCH_RENAME_MAXIMUM_BYTES_V1 } from '../src/lightscaper/controller/photo-batch-rename-v1.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import type { PhotoDocumentV1 } from '../src/lightscaper/catalog/types.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { value: InstrumentedKeyRange, configurable: true });

const recipe = { template: '{stem}-{sequence}.{extension}', sequenceStart: 7, sequencePadding: 3 };
const request = (fileName = 'Edited ÉTÉ.JpG') => ({ schemaVersion: 1, catalogId: 'catalog-1',
	selection: [{ photoId: 'photo-1', expectedRevision: 0, fileName }], rename: { ...recipe } });

function fixture(fileName = 'Edited ÉTÉ.JpG', lateAbort?: AbortController, index = 1) {
	const source = photoArchiveFixture(index).photo;
	let durable = normalizePhotoDocumentV1({ ...source, metadata: { ...source.metadata, fileName, title: 'Retained title' },
		extractedMetadata: { schemaVersion: 1, container: 'png', exif: null, iptc: null, issues: ['unsupported-text-encoding'] } });
	let writes = 0;
	const owner = new PhotoCommandOwnerV1({ loadPhoto: async () => durable,
		savePhoto: async (photo, expectedRevision, options = {}) => {
			options.signal?.throwIfAborted();
			assert.equal(expectedRevision, durable.revision);
			durable = normalizePhotoDocumentV1({ ...normalizePhotoDocumentV1(photo), revision: expectedRevision + 1 }); writes++;
			lateAbort?.abort(); return durable;
		} }, durable);
	return { owner, before: durable, current: () => durable, writes: () => writes };
}

test('batch plans preserve explicit selection order, display-name source and failed-slot numbering', () => {
	const plan = planPhotoBatchRenameV1({ ...request(), selection: [
		{ photoId: 'photo-3', expectedRevision: 8, fileName: 'Display ÉTÉ.JpG' },
		{ photoId: 'missing', expectedRevision: 0, fileName: '.hidden' },
		{ photoId: 'photo-1', expectedRevision: 3, fileName: 'Multi.part.PNG' },
	] });
	assert.deepEqual(plan.items.map(item => [item.index, item.photoId, item.expectedRevision, item.sourceFileName, item.fileName]), [
		[0, 'photo-3', 8, 'Display ÉTÉ.JpG', 'Display ÉTÉ-007.JpG'],
		[1, 'missing', 0, '.hidden', '.hidden-008.'], [2, 'photo-1', 3, 'Multi.part.PNG', 'Multi.part-009.PNG'],
	]);
	assert.equal(Object.isFrozen(plan), true); assert.equal(Object.isFrozen(plan.items), true);
	assert.ok(plan.items.every(Object.isFrozen)); assert.equal(Object.isFrozen(plan.rename), true);
});

test('all names and sequence slots are admitted before any borrowed owner is traversed', async () => {
	let ownerReads = 0;
	const owner = Object.defineProperty({}, 'history', { get: () => { ownerReads++; throw new Error('Owner traversed'); } }) as PhotoCommandOwnerV1;
	const invalid = { ...request(), selection: [...request().selection, { photoId: 'photo-2', expectedRevision: 0, fileName: 'x'.repeat(256) }] };
	assert.throws(() => planPhotoBatchRenameV1(invalid), /name bound/iu);
	await assert.rejects(applyPhotoBatchRenameItemV1(owner, { ...request(), kind: 'future' }, 0));
	assert.equal(ownerReads, 0);
	assert.throws(() => planPhotoBatchRenameV1({ ...request(), rename: { ...recipe, sequenceStart: Number.MAX_SAFE_INTEGER },
		selection: [...request().selection, { photoId: 'photo-2', expectedRevision: 0, fileName: 'Photo.png' }] }), /safe integer/iu);
});

test('strict request admission refuses future, foreign, duplicate, sparse and hostile authored values', () => {
	let getters = 0;
	const hostile = Object.defineProperty({}, 'fileName', { enumerable: true, get: () => { getters++; return 'Photo.png'; } });
	for (const invalid of [
		{ ...request(), schemaVersion: 2 }, { ...request(), extra: true }, { ...request(), catalogId: '../catalog' },
		{ ...request(), rename: null }, { ...request(), rename: { ...recipe, template: '{path}' } },
		{ ...request(), selection: [] }, { ...request(), selection: new Array(1) },
		{ ...request(), selection: [...request().selection, ...request().selection] },
		{ ...request(), selection: [{ ...request().selection[0], expectedRevision: -1 }] },
		{ ...request(), selection: [hostile] },
		{ ...request(), selection: Array.from({ length: 65 }, (_, index) => ({ photoId: `photo-${index}`, expectedRevision: 0, fileName: 'Photo.png' })) },
	]) assert.throws(() => planPhotoBatchRenameV1(invalid));
	assert.equal(getters, 0);
	const data = new Proxy(request().selection[0]!, { get: () => { getters++; throw new Error('Proxy get trap ran'); } });
	assert.equal(planPhotoBatchRenameV1({ ...request(), selection: [data] }).items[0]?.fileName, 'Edited ÉTÉ-007.JpG');
	assert.equal(getters, 0);
});

test('detached recipe/selection and strict plan re-admission bind every scalar output and index', () => {
	const input = request(), plan = planPhotoBatchRenameV1(input);
	input.selection[0]!.fileName = 'Replaced.png'; input.rename.template = 'Changed';
	assert.equal(plan.items[0]?.fileName, 'Edited ÉTÉ-007.JpG');
	assert.deepEqual(normalizePhotoBatchRenamePlanV1(JSON.parse(JSON.stringify(plan)) as unknown), plan);
	for (const mutated of [
		{ ...plan, schemaVersion: 2 }, { ...plan, kind: 'different' }, { ...plan, extra: true },
		{ ...plan, items: [{ ...plan.items[0], index: 1 }] },
		{ ...plan, items: [{ ...plan.items[0], fileName: 'Forged.png' }] },
	]) assert.throws(() => normalizePhotoBatchRenamePlanV1(mutated));
});

test('future plans refuse before traversing the selected payload and admitted plan records never invoke get traps', () => {
	const plan = planPhotoBatchRenameV1(request()); let payloadReads = 0;
	const future = { ...plan, schemaVersion: 2, items: new Proxy([...plan.items], { get: () => { payloadReads++; throw new Error('Future payload read'); } }) };
	assert.throws(() => normalizePhotoBatchRenamePlanV1(future), /future/iu); assert.equal(payloadReads, 0);
	let recordReads = 0;
	const transported = new Proxy({ ...plan }, { get: () => { recordReads++; throw new Error('Plan get trap'); } });
	assert.deepEqual(normalizePhotoBatchRenamePlanV1(transported), plan); assert.equal(recordReads, 0);
});

test('all64 maximal Unicode names and IDs fit the finite whole-plan admission budget', () => {
	const plan = planPhotoBatchRenameV1({ schemaVersion: 1, catalogId: 'c'.repeat(128),
		rename: { template: '\ud801'.repeat(256), sequenceStart: Number.MAX_SAFE_INTEGER - 63, sequencePadding: 16 },
		selection: Array.from({ length: 64 }, (_, index) => ({ photoId: `${'p'.repeat(125)}${String(index).padStart(3, '0')}`,
			expectedRevision: Number.MAX_SAFE_INTEGER, fileName: '\ud800'.repeat(256) })) });
	const bytes = new TextEncoder().encode(JSON.stringify(plan)).byteLength;
	assert.equal(plan.items.length, 64); assert.equal(PHOTO_BATCH_RENAME_MAXIMUM_BYTES_V1, 256 * 1024);
	assert.equal(bytes, 212_749);
	assert.ok(bytes < PHOTO_BATCH_RENAME_MAXIMUM_BYTES_V1, `${bytes} bytes`);
	assert.deepEqual(normalizePhotoBatchRenamePlanV1(JSON.parse(JSON.stringify(plan)) as unknown), plan);
});

test('renaming uses the real owner command/history and keeps original, facts and develop identity across undo/redo', async () => {
	const f = fixture();
	try {
		const ack = await applyPhotoBatchRenameItemV1(f.owner, planPhotoBatchRenameV1(request()), 0);
		assert.deepEqual(ack, { index: 0, photoId: 'photo-1', previousDisplayName: 'Edited ÉTÉ.JpG', fileName: 'Edited ÉTÉ-007.JpG', revision: 1, status: 'renamed' });
		assert.equal(Object.isFrozen(ack), true); assert.equal(f.writes(), 1); assert.equal(f.owner.history.past.length, 1);
		assertPreserved(f.current(), f.before);
		await f.owner.undo(); assert.equal(f.current().metadata.fileName, 'Edited ÉTÉ.JpG'); assertPreserved(f.current(), f.before);
		await f.owner.redo(); assert.equal(f.current().metadata.fileName, 'Edited ÉTÉ-007.JpG'); assertPreserved(f.current(), f.before);
	} finally { await f.owner.close(); }
});

test('an unchanged name invokes no command, save or history publication', async () => {
	const f = fixture(); let commands = 0;
	const nativeExecute = f.owner.execute.bind(f.owner);
	f.owner.execute = async (...args) => { commands++; return nativeExecute(...args); };
	try {
		const before = f.owner.history;
		const plan = planPhotoBatchRenameV1({ ...request(), rename: { ...recipe, template: '{stem}.{extension}' } });
		assert.deepEqual(await applyPhotoBatchRenameItemV1(f.owner, plan, 0), { index: 0, photoId: 'photo-1', previousDisplayName: 'Edited ÉTÉ.JpG',
			fileName: 'Edited ÉTÉ.JpG', revision: 0, status: 'unchanged' });
		assert.equal(commands, 0); assert.equal(f.writes(), 0); assert.equal(f.owner.history, before);
	} finally { await f.owner.close(); }
});

test('catalog, photo, source-name and revision fences refuse before command publication', async () => {
	for (const changes of [{ catalogId: 'other' }, { photoId: 'photo-2' }, { fileName: 'Other.png' }, { expectedRevision: 1 }]) {
		const f = fixture();
		try {
			const plan = planPhotoBatchRenameV1({ ...request(), ...(Object.hasOwn(changes, 'catalogId') ? changes : {}),
				selection: [{ ...request().selection[0], ...(!Object.hasOwn(changes, 'catalogId') ? changes : {}) }] });
			const before = f.owner.history;
			await assert.rejects(applyPhotoBatchRenameItemV1(f.owner, plan, 0));
			assert.equal(f.writes(), 0); assert.equal(f.owner.history, before);
		} finally { await f.owner.close(); }
	}
});

test('native cancellation before access is inert, while late cancellation retains durable acknowledgment and history', async () => {
	const pre = new AbortController(); pre.abort(); let ownerReads = 0, getters = 0;
	Object.defineProperty(pre.signal, 'throwIfAborted', { get: () => { getters++; return () => undefined; } });
	const owner = Object.defineProperty({}, 'history', { get: () => { ownerReads++; throw new Error('Owner traversed'); } }) as PhotoCommandOwnerV1;
	await assert.rejects(applyPhotoBatchRenameItemV1(owner, planPhotoBatchRenameV1(request()), 0, { signal: pre.signal }), { name: 'AbortError' });
	assert.equal(ownerReads, 0); assert.equal(getters, 0);
	const late = new AbortController(), f = fixture(undefined, late);
	try {
		const ack = await applyPhotoBatchRenameItemV1(f.owner, planPhotoBatchRenameV1(request()), 0, { signal: late.signal });
		assert.equal(late.signal.aborted, true); assert.equal(ack.revision, 1); assert.equal(f.owner.canUndo, true); assert.equal(f.writes(), 1);
	} finally { await f.owner.close(); }
});

test('serial per-photo failures retain successful acknowledgments and later selected sequence numbers', async () => {
	const owners = [fixture('One.png', undefined, 1), fixture('Two.png', undefined, 2), fixture('Three.png', undefined, 3)];
	const plan = planPhotoBatchRenameV1({ ...request(), selection: owners.map((f, index) => ({ photoId: f.before.id,
		expectedRevision: index === 1 ? 1 : 0, fileName: f.before.metadata.fileName })) });
	const successful = [], failed = [];
	try {
		for (const [index, f] of owners.entries()) {
			try { successful.push(await applyPhotoBatchRenameItemV1(f.owner, plan, index)); }
			catch (failure) { failed.push({ index, failure }); }
		}
		assert.deepEqual(successful.map(ack => [ack.index, ack.fileName]), [[0, 'One-007.png'], [2, 'Three-009.png']]);
		assert.deepEqual(failed.map(item => item.index), [1]);
		assert.deepEqual(owners.map(f => f.writes()), [1, 0, 1]);
		assert.deepEqual(owners.map(f => f.owner.history.past.length), [1, 0, 1]);
		for (const f of owners) assertPreserved(f.current(), f.before);
	} finally { await Promise.all(owners.map(f => f.owner.close())); }
});

test('real durable photo and query publication failures keep the existing owner history and stored name unchanged', async () => {
	for (const store of ['photos', 'summaries', 'memberships', 'photoQueryRows', 'catalogStates']) {
		const indexedDB = createInstrumentedIndexedDB();
		const repository = new PhotoCatalogRepositoryV1({ indexedDB: indexedDB as unknown as IDBFactory,
			databaseName: `batch-rename-${store}`, verifyOriginal: async () => undefined });
		await repository.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1',
			name: 'Rename qualification', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
		const photo = photoArchiveFixture().photo;
		await repository.publishPhotos('catalog-1', 0, [photo]);
		const owner = await PhotoCommandOwnerV1.open(repository, 'catalog-1', photo.id);
		try {
			const before = owner.history;
			const plan = planPhotoBatchRenameV1(request(photo.metadata.fileName));
			indexedDB.failNextPutForStore(store, new DOMException('Rename quota refused', 'QuotaExceededError'));
			await assert.rejects(applyPhotoBatchRenameItemV1(owner, plan, 0), { name: 'QuotaExceededError' });
			assert.equal(owner.history, before, store); assert.deepEqual(await repository.loadPhoto('catalog-1', photo.id), photo);
			assert.equal((await repository.readSummaryPage('catalog-1')).items[0]?.fileName, photo.metadata.fileName);
			assert.equal(indexedDB.stats.activeTransactions, 0);
			const ack = await applyPhotoBatchRenameItemV1(owner, plan, 0);
			assert.equal(ack.revision, 1); assert.equal(owner.canUndo, true);
			const query = await repository.readQueryPage('catalog-1', { query: { text: '', filter: null,
				sort: { field: 'file-name', direction: 'ascending' } } });
			assert.equal(query.items[0]?.fileName, 'Photo 1-007.png');
			assertPreserved((await repository.loadPhoto('catalog-1', photo.id))!, photo);
		} finally { await owner.close(); await repository.close(); }
	}
});

test('bounded pure plans preserve deterministic scalar output across generated valid selections', () => {
	fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 999_999 }), { minLength: 1, maxLength: 64 }), values => {
		const selection = values.map((value, index) => ({ photoId: `photo-${index}`, expectedRevision: value, fileName: `Source-${value}.PNG` }));
		const plan = planPhotoBatchRenameV1({ ...request(), selection });
		assert.deepEqual(plan.items.map(item => item.fileName), values.map((value, index) => `Source-${value}-${String(7 + index).padStart(3, '0')}.PNG`));
		assert.deepEqual(normalizePhotoBatchRenamePlanV1(JSON.parse(JSON.stringify(plan)) as unknown), plan);
	}), { numRuns: 100, seed: 83_117 });
});

function assertPreserved(photo: PhotoDocumentV1, before: PhotoDocumentV1) {
	assert.deepEqual(photo.original, before.original); assert.deepEqual(photo.extractedMetadata, before.extractedMetadata);
	assert.deepEqual(photo.versions, before.versions); assert.equal(photo.activeVersionId, before.activeVersionId);
	assert.equal(photo.metadata.title, before.metadata.title); assert.deepEqual(photo.metadata.captureTime, before.metadata.captureTime);
}
