/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import type { PhotoLibraryBatchRenameReceiptV1, PhotoLibraryBatchRenameSnapshotV1,
	PhotoLibraryBatchRenameUndoV1 } from '../src/common/editor/photo-library-batch-rename-port-v1.ts';
import { planPhotoBatchRenameV1 } from '../src/lightscaper/controller/photo-batch-rename-v1.ts';
import { createImportTestPort, mountImportWorkflow } from './helpers/photo-import-workflow-fixture.tsx';

const snapshot: PhotoLibraryBatchRenameSnapshotV1 = Object.freeze({ schemaVersion: 1, catalogId: 'catalog-1', selection: Object.freeze([
	Object.freeze({ photoId: 'a', expectedRevision: 1, fileName: '原本 e\u0301.PNG' }),
	Object.freeze({ photoId: 'b', expectedRevision: 2, fileName: 'Second.JPG' }),
]) });
const rename = Object.freeze({ template: '{stem}-{sequence}.{extension}', sequenceStart: 7, sequencePadding: 3 });
const plan = planPhotoBatchRenameV1({ ...snapshot, rename });
const undo: PhotoLibraryBatchRenameUndoV1 = Object.freeze({ schemaVersion: 1, kind: 'photo-batch-rename-undo', catalogId: snapshot.catalogId,
	items: Object.freeze(plan.items.map(item => Object.freeze({ index: item.index, photoId: item.photoId, expectedRevision: item.expectedRevision + 1,
		fileName: item.fileName, previousDisplayName: item.sourceFileName }))) });
function receipt(overrides: Partial<PhotoLibraryBatchRenameReceiptV1> = {}): PhotoLibraryBatchRenameReceiptV1 {
	return Object.freeze({ schemaVersion: 1, action: 'rename', completion: 'finished', items: Object.freeze(plan.items.map(item => Object.freeze({
		index: item.index, photoId: item.photoId, previousDisplayName: item.sourceFileName, fileName: item.fileName,
		revision: item.expectedRevision + 1, status: 'renamed' as const, message: null }))), undo, message: null, ...overrides });
}
function restoration(overrides: Partial<PhotoLibraryBatchRenameReceiptV1> = {}): PhotoLibraryBatchRenameReceiptV1 {
	return receipt({ action: 'undo', undo: null, items: Object.freeze(receipt().items.map(item => {
		assert.ok(item.status !== 'failed');
		return Object.freeze({ ...item, previousDisplayName: item.fileName, fileName: item.previousDisplayName, revision: item.revision + 1, status: 'restored' as const });
	})), ...overrides });
}
function page(names = snapshot.selection.map(item => item.fileName)) {
	return Object.freeze({ catalogName: 'Library', totalCount: 2, cursor: 'old-cursor', rows: Object.freeze(snapshot.selection.map((item, index) => Object.freeze({
		id: item.photoId, fileName: names[index]!, width: 1, height: 1, rating: 0, flag: 'unflagged' as const, colorLabel: 'none' as const }))) });
}
function port() {
	const owner = createImportTestPort(); owner.readPage = async () => page();
	owner.readBatchRenameSelection = async () => snapshot; owner.planBatchRename = planPhotoBatchRenameV1;
	owner.renamePhotos = async () => receipt(); owner.undoBatchRename = async () => restoration();
	return owner;
}
async function prepare() {
	const owner = port(), mounted = await mountImportWorkflow(async () => owner);
	await act(async () => { await mounted.current.readPage(); await mounted.current.readBatchRenameSelection(['a', 'b']); });
	return { owner, mounted };
}

test('selection capture snapshots bounded page-order IDs before acquisition and planning stays synchronous', async () => {
	let opens = 0, selected: readonly string[] = [], plans = 0;
	const factory = deferred<ReturnType<typeof port>>(), owner = port();
	owner.readBatchRenameSelection = async ids => { selected = ids; return snapshot; };
	owner.planBatchRename = value => { plans++; return planPhotoBatchRenameV1(value); };
	const mounted = await mountImportWorkflow(() => { opens++; return factory.promise; });
	try {
		assert.equal(opens, 0); assert.throws(() => mounted.current.planBatchRename({ ...snapshot, rename }));
		const ids = ['a', 'b']; let pending: Promise<void> | undefined;
		await act(async () => { pending = mounted.current.readBatchRenameSelection(ids); await settle(); }); ids.reverse();
		await act(async () => { factory.resolve(owner); await pending; });
		assert.deepEqual(selected, ['a', 'b']); assert.equal(Object.isFrozen(selected), true);
		assert.equal(mounted.current.batchRenameSnapshot, snapshot);
		const admitted = mounted.current.planBatchRename({ ...snapshot, rename });
		assert.equal(admitted instanceof Promise, false); assert.equal(plans, 1); assert.deepEqual(admitted, plan);
	} finally { await mounted.dispose(); }
});

test('65 selected IDs refuse before opening a resource or retaining a partial capture', async () => {
	let opens = 0; const mounted = await mountImportWorkflow(async () => { opens++; return port(); });
	try {
		await act(async () => { await mounted.current.readBatchRenameSelection(Array.from({ length: 65 }, (_, index) => String(index))); });
		assert.equal(opens, 0); assert.equal(mounted.current.batchRenameSnapshot, null); assert.ok(mounted.current.error);
	} finally { await mounted.dispose(); }
});

test('durable rename and inverse are remembered before a blocked refresh and retire the old cursor', async () => {
	const { owner, mounted } = await prepare(), refresh = deferred<ReturnType<typeof page>>(); owner.readPage = () => refresh.promise;
	let result: ReturnType<typeof mounted.current.renamePhotos> | undefined;
	try {
		await act(async () => { result = mounted.current.renamePhotos(plan); await settle(); });
		assert.equal(mounted.current.batchRenameReceipt?.receipt.action, 'rename');
		assert.equal(mounted.current.batchRenameUndo, undo); assert.equal(mounted.current.page?.cursor, null);
		await act(async () => { refresh.resolve(page(plan.items.map(item => item.fileName))); const saved = await result;
			assert.equal(saved?.outcome, 'acknowledged'); if (saved?.outcome === 'acknowledged') assert.equal(saved.notice, null); });
		assert.deepEqual(mounted.current.page?.rows.map(row => row.fileName), plan.items.map(item => item.fileName));
	} finally { await mounted.dispose(); }
});

test('refresh failure keeps the exact durable receipt and changed display names with a truthful notice', async () => {
	const { owner, mounted } = await prepare(), saved = receipt(); owner.renamePhotos = async () => saved;
	owner.readPage = async () => { throw new Error('Refresh refused'); };
	try {
		await act(async () => { const result = await mounted.current.renamePhotos(plan);
			assert.equal(result.outcome, 'acknowledged'); if (result.outcome === 'acknowledged') {
				assert.equal(result.receipt, saved); assert.equal(result.notice, 'refresh-failed');
			} });
		assert.equal(mounted.current.batchRenameUndo, undo); assert.equal(mounted.current.page?.cursor, null);
		assert.deepEqual(mounted.current.page?.rows.map(row => row.fileName), plan.items.map(item => item.fileName));
	} finally { await mounted.dispose(); }
});

test('refusal and all-no-op attempts retain the previous durable inverse', async () => {
	const { owner, mounted } = await prepare();
	try {
		await act(async () => { await mounted.current.renamePhotos(plan); });
		owner.renamePhotos = async () => { throw new Error('Save refused'); };
		await act(async () => { assert.equal((await mounted.current.renamePhotos(plan)).outcome, 'failed'); });
		assert.equal(mounted.current.batchRenameUndo, undo);
		owner.renamePhotos = async () => receipt({ undo: null, items: Object.freeze(receipt().items.map(item => {
			assert.ok(item.status !== 'failed'); return Object.freeze({ ...item, status: 'unchanged' as const });
		})) });
		await act(async () => { await mounted.current.renamePhotos(plan); }); assert.equal(mounted.current.batchRenameUndo, undo);
	} finally { await mounted.dispose(); }
});

test('a new capture or admitted undo retires the prior receipt while preserving its bounded inverse', async () => {
	const { owner, mounted } = await prepare(), held = deferred<PhotoLibraryBatchRenameReceiptV1>();
	try {
		await act(async () => { await mounted.current.renamePhotos(plan); });
		assert.ok(mounted.current.batchRenameReceipt);
		await act(async () => { await mounted.current.readBatchRenameSelection(['a', 'b']); });
		assert.equal(mounted.current.batchRenameReceipt, null); assert.equal(mounted.current.batchRenameUndo, undo);
		await act(async () => { await mounted.current.renamePhotos(plan); }); owner.undoBatchRename = () => held.promise;
		let pending: ReturnType<typeof mounted.current.undoBatchRename> | undefined;
		await act(async () => { pending = mounted.current.undoBatchRename(undo); await settle(); });
		assert.equal(mounted.current.batchRenameReceipt, null); assert.equal(mounted.current.batchRenameUndo, undo);
		await act(async () => { held.resolve(restoration()); await pending; });
		assert.deepEqual(mounted.current.batchRenameReceipt, { outcome: 'acknowledged', receipt: restoration(), notice: null });
	} finally { held.resolve(restoration()); await mounted.dispose(); }
});

test('pre-ack abort is cancelled while an already-returned partial cancellation stays acknowledged', async () => {
	const { owner, mounted } = await prepare(), cancellation = new AbortController(); cancellation.abort(); let saves = 0;
	owner.renamePhotos = async () => { saves++; return receipt({ completion: 'cancelled', items: [receipt().items[0]!], undo: { ...undo, items: [undo.items[0]!] } }); };
	try {
		await act(async () => { assert.equal((await mounted.current.renamePhotos(plan, { signal: cancellation.signal })).outcome, 'cancelled'); });
		assert.equal(saves, 0);
		await act(async () => { const result = await mounted.current.renamePhotos(plan);
			assert.equal(result.outcome, 'acknowledged'); if (result.outcome === 'acknowledged') {
				assert.equal(result.receipt.completion, 'cancelled'); assert.equal(result.receipt.items.length, 1);
			} });
	} finally { await mounted.dispose(); }
});

test('a second batch call is busy and has no queued writer invocation', async () => {
	const { owner, mounted } = await prepare(), saved = deferred<PhotoLibraryBatchRenameReceiptV1>(); let saves = 0;
	owner.renamePhotos = () => { saves++; return saved.promise; };
	let result: ReturnType<typeof mounted.current.renamePhotos> | undefined;
	try {
		await act(async () => { result = mounted.current.renamePhotos(plan); await settle(); });
		await act(async () => { assert.equal((await mounted.current.renamePhotos(plan)).outcome, 'busy'); }); assert.equal(saves, 1);
		await act(async () => { saved.resolve(receipt()); await result; }); assert.equal(saves, 1);
	} finally { await mounted.dispose(); }
});

test('a hostile pre-ack failure cannot throw from diagnostics or keep the workflow busy', async () => {
	const { owner, mounted } = await prepare(); let propertyReads = 0;
	const failure = new Proxy({}, { get: () => { propertyReads++; throw new Error('Unexpected failure property evaluation'); },
		getOwnPropertyDescriptor: () => { throw new Error('Unavailable diagnostic descriptor'); } });
	owner.renamePhotos = async () => { throw failure; };
	try {
		await act(async () => { assert.equal((await mounted.current.renamePhotos(plan)).outcome, 'failed'); });
		assert.equal(propertyReads, 0); assert.equal(mounted.current.busy, false); assert.equal(mounted.current.batchRenameReceipt, null);
		assert.equal(mounted.current.error, 'The photo library action failed.');
	} finally { await mounted.dispose(); }
});

test('partial undo retains exact remaining fences and a completed undo clears only its inverse', async () => {
	const { owner, mounted } = await prepare(), remaining = Object.freeze({ ...undo, items: Object.freeze([undo.items[1]!]) });
	let received: PhotoLibraryBatchRenameUndoV1 | undefined;
	owner.undoBatchRename = async value => { received = value; return restoration({ completion: 'cancelled', undo: remaining, items: [restoration().items[0]!] }); };
	try {
		await act(async () => { await mounted.current.renamePhotos(plan); await mounted.current.undoBatchRename(undo); });
		assert.equal(received, undo); assert.equal(mounted.current.batchRenameUndo, remaining);
		owner.undoBatchRename = async () => restoration();
		await act(async () => { await mounted.current.undoBatchRename(remaining); }); assert.equal(mounted.current.batchRenameUndo, null);
	} finally { await mounted.dispose(); }
});

test('a retired generation returns late durable results without publishing them into its replacement', async () => {
	const { owner, mounted } = await prepare(), saved = deferred<PhotoLibraryBatchRenameReceiptV1>(); owner.renamePhotos = () => saved.promise;
	let result: ReturnType<typeof mounted.current.renamePhotos> | undefined;
	try {
		await act(async () => { result = mounted.current.renamePhotos(plan); await settle(); });
		await mounted.replace(async () => port());
		await act(async () => { saved.resolve(receipt()); const returned = await result; assert.equal(returned?.outcome, 'acknowledged'); });
		assert.equal(mounted.current.batchRenameReceipt, null); assert.equal(mounted.current.batchRenameUndo, null);
	} finally { await mounted.dispose(); }
});

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function settle() { await new Promise<void>(resolve => { setTimeout(resolve, 0); }); }
