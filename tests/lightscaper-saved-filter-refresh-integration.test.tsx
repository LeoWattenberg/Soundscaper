/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import { usePhotoLibraryWorkflow } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow.ts';
import { usePhotoSavedFilters, type PhotoSavedFilterApplyResultV1 } from '../src/common/editor/ui/lightscaper/use-photo-saved-filters.ts';
import type { PhotoLibrarySavedCollectionAcknowledgementV1, PhotoLibrarySavedCollectionCommandV1,
	PhotoLibrarySavedCollectionPortV1, PhotoLibrarySavedCollectionQueryStepV1 } from '../src/common/editor/photo-library-saved-collection-port-v1.ts';
import { createImportTestPort } from './helpers/photo-import-workflow-fixture.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, settle } from './helpers/async-test-control.ts';

const context = { catalogId: 'catalog', catalogRevision: 4, indexRevision: 3, collectionStateRevision: 2, collectionCount: 1 };
const queryJson = JSON.stringify({ schemaVersion: 2, kind: 'photo-catalog-query', text: 'tree', filter: null,
	sort: { field: 'photo-id', direction: 'ascending' }, predicate: null });
const row = { id: 'photo', fileName: 'Photo.png', width: 2, height: 3, rating: 0, flag: 'unflagged' as const, colorLabel: 'none' as const };
const page = { catalogName: 'Library', totalCount: 1, rows: [row], cursor: 'old-saved-cursor' };
const step = (collectionId = 'saved'): PhotoLibrarySavedCollectionQueryStepV1 => ({ ...page, scanned: 1,
	collectionId, collectionName: 'Saved', mode: 'ordinary', context, definitionRevision: 2,
	definitionSha256: 'a'.repeat(64), querySha256: 'b'.repeat(64), stackStateRevision: null });
const update = (collectionId = 'saved'): PhotoLibrarySavedCollectionCommandV1 => ({ type: 'update', context,
	collectionId, expectedDefinitionRevision: 2, name: 'Edited filter', queryJson });
function receipt(command: PhotoLibrarySavedCollectionCommandV1): PhotoLibrarySavedCollectionAcknowledgementV1 {
	const collectionId = command.type === 'create' ? 'created' : command.collectionId;
	return { outcome: command.type === 'create' ? 'created' : command.type === 'delete' ? 'deleted' : 'updated', collectionId,
		context: { ...context, catalogRevision: 5, indexRevision: 4, collectionStateRevision: 3 },
		summary: command.type === 'delete' ? null : { id: collectionId, revision: command.type === 'create' ? 0 : 3, name: command.name }, notices: [] };
}
async function mount() {
	const reads: Parameters<PhotoLibrarySavedCollectionPortV1['readQueryStep']>[0][] = [], writes: PhotoLibrarySavedCollectionCommandV1[] = [];
	const unexpected = async (): Promise<never> => { throw new Error('Refresh must not load an authoring recipe.'); };
	const saved: PhotoLibrarySavedCollectionPortV1 = { readPage: unexpected, readSnapshot: unexpected,
		readQueryStep: async request => { reads.push(request); return step(request.collectionId); },
		apply: async command => { writes.push(command); return receipt(command); } };
	const owner = { ...createImportTestPort(), savedCollections: saved };
	owner.readPage = async () => ({ ...page, cursor: 'all-cursor' });
	let opens = 0, closes = 0, generation = {};
	const factory = async () => { opens++; return owner; };
	owner.close = async () => { closes++; };
	let current: { library: ReturnType<typeof usePhotoLibraryWorkflow>; filters: ReturnType<typeof usePhotoSavedFilters> } | undefined;
	function Harness() {
		const library = usePhotoLibraryWorkflow(factory);
		const filters = usePhotoSavedFilters({ generation, execute: library.executeSavedFilters });
		current = { library, filters }; return null;
	}
	const mounted = await mountPhotoImportUi(() => <StrictMode><Harness /></StrictMode>);
	return { ...mounted, owner, saved, reads, writes, get current() { assert.ok(current); return current; },
		get opens() { return opens; }, get closes() { return closes; },
		async replaceControls() { generation = {}; await mounted.render(); },
		async activate() { await act(async () => { await current?.filters.use('saved'); });
			assert.equal(current?.library.savedCollectionId, 'saved'); } };
}

test('active saved UPDATE ACK retires the actual workflow cursor and review identity before failed refresh', async () => {
	const mounted = await mount();
	try {
		await mounted.activate(); const previous = mounted.current.library.page, identity = mounted.current.library.queryIdentity;
		mounted.saved.readQueryStep = async () => { throw new Error('Updated saved definition could not be refreshed.'); };
		await act(async () => {
			const result = await mounted.current.filters.apply(update()); assert.equal(result.outcome, 'acknowledged');
			if (result.outcome === 'acknowledged') { assert.deepEqual(result.receipt, receipt(update())); assert.equal(result.notice, 'refresh-failed'); }
		});
		assert.equal(mounted.current.library.savedCollectionId, 'saved');
		assert.notEqual(mounted.current.library.queryIdentity, identity); assert.notEqual(mounted.current.library.page, previous);
		assert.equal(mounted.current.library.page?.cursor, null); assert.equal(mounted.current.library.page?.rows, previous?.rows);
		assert.equal(mounted.current.filters.notice, 'refresh-failed'); assert.match(mounted.current.filters.error ?? '', /could not be refreshed/u);
		assert.equal(mounted.current.library.busy, false); assert.equal(mounted.current.filters.busy, false);
	} finally { await mounted.dispose(); }
});

test('post-ACK cancellation joins the held refresh and cannot release exclusion or revive its late page', async () => {
	const mounted = await mount(), held = deferred<PhotoLibrarySavedCollectionQueryStepV1>();
	let pending: Promise<PhotoSavedFilterApplyResultV1> | undefined, settled = false, signal: AbortSignal | undefined;
	try {
		await mounted.activate(); const identity = mounted.current.library.queryIdentity;
		mounted.saved.readQueryStep = request => { mounted.reads.push(request); signal = request.signal; return held.promise; };
		await act(async () => { pending = mounted.current.filters.apply(update()); void pending.then(() => { settled = true; }); await settle(); });
		assert.deepEqual(mounted.current.filters.receipt, receipt(update())); assert.notEqual(mounted.current.library.queryIdentity, identity);
		const retiredIdentity = mounted.current.library.queryIdentity, retiredPage = mounted.current.library.page;
		assert.equal(retiredPage?.cursor, null);
		await act(async () => { mounted.current.library.cancel();
			assert.deepEqual(await mounted.current.filters.apply(update()), { outcome: 'busy' }); await mounted.current.library.readPage(); });
		assert.equal(signal?.aborted, true); assert.equal(settled, false); assert.equal(mounted.reads.length, 2);
		assert.equal(mounted.current.library.busy, true); assert.equal(mounted.current.filters.busy, true);
		await act(async () => { held.resolve({ ...step(), rows: [{ ...row, fileName: 'Late page.png' }], cursor: 'late-cursor' });
			const result = await pending; assert.equal(result?.outcome, 'acknowledged');
			if (result?.outcome === 'acknowledged') assert.equal(result.notice, 'refresh-failed'); });
		assert.equal(mounted.current.library.page, retiredPage); assert.equal(mounted.current.library.queryIdentity, retiredIdentity);
		assert.equal(mounted.current.filters.notice, 'refresh-failed'); assert.equal(mounted.current.filters.error, null);
		assert.equal(mounted.current.library.busy, false); assert.equal(mounted.current.filters.busy, false); assert.equal(mounted.writes.length, 1);
	} finally { held.resolve(step()); await pending; await mounted.dispose(); }
});

test('cancellation delivered with the durable active UPDATE ACK still retires before attempting refresh', async () => {
	const mounted = await mount();
	try {
		await mounted.activate(); const identity = mounted.current.library.queryIdentity;
		mounted.saved.apply = async command => { mounted.writes.push(command); mounted.current.library.cancel(); return receipt(command); };
		await act(async () => { const result = await mounted.current.filters.apply(update());
			assert.equal(result.outcome, 'acknowledged'); if (result.outcome === 'acknowledged') assert.equal(result.notice, 'refresh-failed'); });
		assert.notEqual(mounted.current.library.queryIdentity, identity); assert.equal(mounted.current.library.page?.cursor, null);
		assert.equal(mounted.current.library.savedCollectionId, 'saved'); assert.equal(mounted.reads.length, 1);
		assert.deepEqual(mounted.current.filters.receipt, receipt(update())); assert.equal(mounted.current.filters.error, null);
	} finally { await mounted.dispose(); }
});

test('a late active UPDATE ACK retires the live Session authority after only the saved-controls generation changes', async () => {
	const mounted = await mount(), held = deferred<PhotoLibrarySavedCollectionAcknowledgementV1>();
	let pending: Promise<PhotoSavedFilterApplyResultV1> | undefined, signal: AbortSignal | undefined;
	try {
		await mounted.activate(); const identity = mounted.current.library.queryIdentity;
		mounted.saved.apply = (command, options) => { mounted.writes.push(command); signal = options?.signal; return held.promise; };
		await act(async () => { pending = mounted.current.filters.apply(update()); await settle(); });
		await act(async () => { mounted.current.library.cancel(); }); await mounted.replaceControls();
		assert.equal(signal?.aborted, true); assert.equal(mounted.current.filters.busy, true); assert.equal(mounted.current.library.busy, true);
		assert.equal(mounted.current.filters.receipt, null); assert.equal(mounted.current.filters.loaded, null);
		await act(async () => { held.resolve(receipt(update())); const result = await pending;
			assert.equal(result?.outcome, 'acknowledged'); if (result?.outcome === 'acknowledged') assert.deepEqual(result.receipt, receipt(update())); });
		assert.equal(mounted.opens, 1); assert.equal(mounted.closes, 0); assert.equal(mounted.current.library.savedCollectionId, 'saved');
		assert.notEqual(mounted.current.library.queryIdentity, identity); assert.equal(mounted.current.library.page?.cursor, null);
		assert.equal(mounted.current.filters.receipt, null); assert.equal(mounted.current.filters.loaded, null);
		assert.equal(mounted.current.filters.notice, null); assert.equal(mounted.current.filters.error, null);
		assert.equal(mounted.current.library.busy, false); assert.equal(mounted.current.filters.busy, false); assert.equal(mounted.reads.length, 1);
	} finally { held.resolve(receipt(update())); await pending; await mounted.dispose(); }
});

test('nonactive create and UPDATE refresh the selected ID without retiring its review identity', async () => {
	const mounted = await mount();
	try {
		await mounted.activate(); const identity = mounted.current.library.queryIdentity;
		for (const command of [{ type: 'create' as const, context, name: 'New filter', queryJson }, update('other')]) {
			await act(async () => { const result = await mounted.current.filters.apply(command); assert.equal(result.outcome, 'acknowledged');
				if (result.outcome === 'acknowledged') assert.equal(result.notice, null); });
			assert.equal(mounted.current.library.queryIdentity, identity); assert.equal(mounted.current.library.savedCollectionId, 'saved');
			assert.equal(mounted.current.library.page?.cursor, 'old-saved-cursor');
		}
		assert.deepEqual(mounted.reads.map(request => request.collectionId), ['saved', 'saved', 'saved']);
		assert.ok(mounted.reads.every(request => request.cursor === null && !Object.hasOwn(request, 'query')));
	} finally { await mounted.dispose(); }
});

test('active DELETE is refused until actual Show all changes workflow selection', async () => {
	const mounted = await mount(), command: PhotoLibrarySavedCollectionCommandV1 = { type: 'delete', context,
		collectionId: 'saved', expectedDefinitionRevision: 2 };
	try {
		await mounted.activate(); const identity = mounted.current.library.queryIdentity, previous = mounted.current.library.page;
		await act(async () => { assert.deepEqual(await mounted.current.filters.apply(command), { outcome: 'failed' }); });
		assert.equal(mounted.writes.length, 0); assert.equal(mounted.current.library.queryIdentity, identity);
		assert.equal(mounted.current.library.page, previous); assert.equal(mounted.current.library.savedCollectionId, 'saved');
		await act(async () => { await mounted.current.filters.showAll(); });
		assert.equal(mounted.current.library.savedCollectionId, null); assert.equal(mounted.current.library.queryIdentity, null);
		assert.equal(mounted.current.library.page?.cursor, 'all-cursor');
		await act(async () => { const result = await mounted.current.filters.apply(command); assert.equal(result.outcome, 'acknowledged');
			if (result.outcome === 'acknowledged') assert.equal(result.receipt.outcome, 'deleted'); });
		assert.equal(mounted.writes.length, 1); assert.equal(mounted.reads.length, 1); assert.equal(mounted.current.library.savedCollectionId, null);
	} finally { await mounted.dispose(); }
});

test('a refused active UPDATE before ACK preserves the existing cursor and review identity', async () => {
	const mounted = await mount();
	try {
		await mounted.activate(); const identity = mounted.current.library.queryIdentity, previous = mounted.current.library.page;
		mounted.saved.apply = async () => { throw new Error('Definition revision conflict.'); };
		await act(async () => { assert.deepEqual(await mounted.current.filters.apply(update()), { outcome: 'failed' }); });
		assert.equal(mounted.current.library.queryIdentity, identity); assert.equal(mounted.current.library.page, previous);
		assert.equal(mounted.current.library.page?.cursor, 'old-saved-cursor'); assert.equal(mounted.current.filters.receipt, null);
		assert.equal(mounted.current.filters.notice, null); assert.equal(mounted.reads.length, 1);
	} finally { await mounted.dispose(); }
});
