/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import type { PhotoLibrarySavedCollectionPortV1, PhotoLibrarySavedCollectionQueryStepV1 } from '../src/common/editor/photo-library-saved-collection-port-v1.ts';
import { DEFAULT_PHOTO_LIBRARY_QUERY_V2 } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow.ts';
import { createImportTestPort, mountImportWorkflow } from './helpers/photo-import-workflow-fixture.tsx';
import { deferred, settle } from './helpers/async-test-control.ts';

const row = { id: 'photo', fileName: 'Photo.png', width: 2, height: 3, rating: 0, flag: 'unflagged' as const, colorLabel: 'none' as const };
const page = { catalogName: 'Library', totalCount: 10, rows: [row], cursor: 'photo-next' };
const context = { catalogId: 'catalog', catalogRevision: 2, indexRevision: 1, collectionStateRevision: 1 };
const step = (collectionId = 'saved', mode: 'ordinary' | 'collapsed' = 'ordinary'): PhotoLibrarySavedCollectionQueryStepV1 => ({
	...page, scanned: 64, collectionId, collectionName: 'Saved', mode, context, definitionRevision: 1,
	definitionSha256: 'a'.repeat(64), querySha256: 'b'.repeat(64), stackStateRevision: mode === 'collapsed' ? 0 : null,
});
function fixture() {
	const base = createImportTestPort(), calls: Parameters<PhotoLibrarySavedCollectionPortV1['readQueryStep']>[0][] = [];
	const unexpected = async (): Promise<never> => { throw new Error('Navigation must not load authoring authority.'); };
	const savedCollections: PhotoLibrarySavedCollectionPortV1 = { readPage: unexpected, readSnapshot: unexpected, apply: unexpected,
		readQueryStep: async request => { calls.push(request); return step(request.collectionId, request.mode); } };
	base.readPage = async () => page;
	return { owner: { ...base, savedCollections }, calls };
}

test('saved navigation remains dormant and uses only the selected ID through sparse paging and mode changes', async () => {
	const { owner, calls } = fixture(); let opens = 0;
	owner.savedCollections.readQueryStep = async request => { calls.push(request); return request.cursor === null
		? { ...step(request.collectionId, request.mode), rows: [], cursor: 'after-64' } : step(request.collectionId, request.mode); };
	const mounted = await mountImportWorkflow(async () => { opens++; return owner; });
	try {
		assert.equal(opens, 0); assert.equal(mounted.current.savedCollectionId, null); assert.equal(mounted.current.queryIdentity, null);
		await act(async () => { assert.equal(await mounted.current.executeSavedFilters(async current => { await current.activate({ kind: 'saved', collectionId: 'saved' }); }), 'completed'); });
		assert.equal(opens, 1); assert.equal(mounted.current.savedCollectionId, 'saved'); assert.equal(mounted.current.query, null);
		assert.deepEqual(calls.map(({ collectionId, mode, cursor }) => ({ collectionId, mode, cursor })), [
			{ collectionId: 'saved', mode: 'ordinary', cursor: null }, { collectionId: 'saved', mode: 'ordinary', cursor: 'after-64' }]);
		assert.ok(calls.every(request => !Object.hasOwn(request, 'query')));
		assert.deepEqual(Object.keys(mounted.current.page!).sort(), ['catalogName', 'cursor', 'rows', 'totalCount']);
		await act(async () => { await mounted.current.readPage('photo-next'); await mounted.current.setStackCollapsed(true); });
		assert.equal(calls[2]?.cursor, 'photo-next'); assert.equal(calls[3]?.mode, 'collapsed');
		assert.equal(mounted.current.stackCollapsed, true); assert.equal(mounted.current.savedCollectionId, 'saved');
	} finally { await mounted.dispose(); }
});

test('saved culling and import refresh reread by ID without duplicating criteria or retiring unchanged query identity', async () => {
	const { owner, calls } = fixture(); owner.setRating = async (_id, rating) => ({ ...row, rating });
	owner.importFiles = async () => [{ index: 0, fileName: 'New.png', photoId: 'imported', status: 'imported', reusedOriginal: false, message: null, hasMetadataNotices: false }];
	const mounted = await mountImportWorkflow(async () => owner);
	try {
		await act(async () => { await mounted.current.executeSavedFilters(async current => { await current.activate({ kind: 'saved', collectionId: 'saved' }); }); });
		const identity = mounted.current.queryIdentity;
		await act(async () => { assert.equal((await mounted.current.setRating(row.id, 5)).outcome, 'saved'); });
		assert.equal(calls.length, 2); assert.equal(mounted.current.queryIdentity, identity);
		await act(async () => { assert.equal((await mounted.current.importFiles([new File(['x'], 'New.png')])).outcome, 'acknowledged'); });
		assert.equal(calls.length, 3); assert.ok(calls.every(request => request.collectionId === 'saved' && request.cursor === null));
		assert.equal(mounted.current.queryIdentity, identity); assert.equal(mounted.current.query, null);
	} finally { await mounted.dispose(); }
});

test('explicit saved reactivation retires the cursor identity, while failed transitions keep the old selection and page', async () => {
	const { owner } = fixture(); const mounted = await mountImportWorkflow(async () => owner);
	try {
		const activate = () => mounted.current.executeSavedFilters(async current => { await current.activate({ kind: 'saved', collectionId: 'saved' }); });
		await act(async () => { await activate(); }); const old = mounted.current.queryIdentity;
		await act(async () => { await activate(); }); assert.notEqual(mounted.current.queryIdentity, old);
		const identity = mounted.current.queryIdentity, previous = mounted.current.page;
		owner.savedCollections.readQueryStep = async () => { throw new Error('Saved definition changed.'); };
		await act(async () => { assert.equal(await activate(), 'failed'); });
		assert.equal(mounted.current.queryIdentity, identity); assert.equal(mounted.current.page, previous);
		await act(async () => { await mounted.current.applyQuery(DEFAULT_PHOTO_LIBRARY_QUERY_V2); });
		assert.equal(mounted.current.savedCollectionId, 'saved'); assert.equal(mounted.current.page, previous);
		owner.readQueryStepV2 = async () => ({ ...page, scanned: 1 });
		await act(async () => { await mounted.current.applyQuery(DEFAULT_PHOTO_LIBRARY_QUERY_V2); });
		assert.equal(mounted.current.savedCollectionId, null); assert.equal(mounted.current.queryIdentity, DEFAULT_PHOTO_LIBRARY_QUERY_V2);
		await act(async () => { await mounted.current.executeSavedFilters(async current => { await current.activate({ kind: 'all' }); }); });
		assert.equal(mounted.current.query, null); assert.equal(mounted.current.queryIdentity, null);
	} finally { await mounted.dispose(); }
});

test('saved activation borrows synchronous exclusion and cancellation joins a held read before releasing it', async () => {
	const { owner } = fixture(), held = deferred<PhotoLibrarySavedCollectionQueryStepV1>(); let reads = 0, signal: AbortSignal | undefined;
	owner.savedCollections.readQueryStep = request => { reads++; signal = request.signal; return held.promise; };
	const mounted = await mountImportWorkflow(async () => owner); let pending: Promise<string> | undefined;
	try {
		await act(async () => { await mounted.current.readPage(); }); const previous = mounted.current.page;
		await act(async () => { pending = mounted.current.executeSavedFilters(async current => { await current.activate({ kind: 'saved', collectionId: 'saved' }); });
			assert.equal(await mounted.current.executeSavedFilters(async () => { assert.fail('A second gesture cannot enter.'); }), 'busy'); await settle(); });
		await act(async () => { mounted.current.cancel(); await mounted.current.readPage(); });
		assert.equal(signal?.aborted, true); assert.equal(reads, 1); assert.equal(mounted.current.busy, true);
		await act(async () => { held.resolve(step()); assert.equal(await pending, 'cancelled'); });
		assert.equal(mounted.current.savedCollectionId, null); assert.equal(mounted.current.page, previous); assert.equal(mounted.current.busy, false);
	} finally { held.resolve(step()); await pending; await mounted.dispose(); }
});

test('retained saved callbacks cannot reacquire a retired factory, and replacement waits for the old native close', async () => {
	const { owner } = fixture(), closing = deferred<void>(), replacement = fixture(); let opens = 0;
	owner.close = () => closing.promise;
	const mounted = await mountImportWorkflow(async () => owner);
	try {
		await act(async () => { await mounted.current.executeSavedFilters(async current => { await current.activate({ kind: 'saved', collectionId: 'saved' }); }); });
		const stale = mounted.current.executeSavedFilters;
		await mounted.replace(async () => { opens++; return replacement.owner; });
		await act(async () => { assert.equal(await stale(async () => { assert.fail('Stale saved handler entered.'); }), 'cancelled');
			void mounted.current.readPage(); await settle(); });
		assert.equal(opens, 0); assert.equal(mounted.current.savedCollectionId, null);
		await act(async () => { closing.resolve(); await settle(); }); assert.equal(opens, 1);
	} finally { closing.resolve(); await mounted.dispose(); }
});

test('a held lazy saved demand can be cancelled before it starts reading', async () => {
	const { owner, calls } = fixture(), opening = deferred<typeof owner>(); const mounted = await mountImportWorkflow(() => opening.promise);
	let pending: Promise<string> | undefined;
	try {
		await act(async () => { pending = mounted.current.executeSavedFilters(async current => { await current.activate({ kind: 'saved', collectionId: 'saved' }); }); await settle(); });
		await act(async () => { mounted.current.cancel(); opening.resolve(owner); assert.equal(await pending, 'cancelled'); });
		assert.equal(calls.length, 0); assert.equal(mounted.current.savedCollectionId, null); assert.equal(mounted.current.page, null);
	} finally { opening.resolve(owner); await pending; await mounted.dispose(); }
});

test('acknowledged active edits retire cursor and query identity before a failed or cancelled refresh', async () => {
	for (const cancel of [false, true]) {
		const { owner } = fixture(), mounted = await mountImportWorkflow(async () => owner);
		try {
			await act(async () => { await mounted.current.executeSavedFilters(async current => { await current.activate({ kind: 'saved', collectionId: 'saved' }); }); });
			const identity = mounted.current.queryIdentity;
			owner.savedCollections.readQueryStep = async () => { throw new Error('Post-save refresh failed.'); };
			await act(async () => { await mounted.current.executeSavedFilters(async current => {
				if (cancel) mounted.current.cancel();
				current.retireSavedSelection('other'); current.retireSavedSelection('saved');
				await current.activate({ kind: 'saved', collectionId: 'saved' });
			}); });
			assert.equal(mounted.current.savedCollectionId, 'saved'); assert.equal(mounted.current.page?.cursor, null);
			assert.notEqual(mounted.current.queryIdentity, identity); assert.deepEqual(mounted.current.page?.rows, page.rows);
		} finally { await mounted.dispose(); }
	}
});
