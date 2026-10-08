/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import { usePhotoSavedFilters, type ExecutePhotoSavedFiltersV1, type PhotoSavedFilterApplyResultV1,
	type PhotoSavedFilterExecutionContextV1 } from '../src/common/editor/ui/lightscaper/use-photo-saved-filters.ts';
import type { PhotoLibrarySavedCollectionAcknowledgementV1, PhotoLibrarySavedCollectionCommandV1,
	PhotoLibrarySavedCollectionPageV1, PhotoLibrarySavedCollectionPortV1, PhotoLibrarySavedCollectionSnapshotV1 } from '../src/common/editor/photo-library-saved-collection-port-v1.ts';
import type { PhotoLibrarySessionPortV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, settle } from './helpers/async-test-control.ts';

const context = { catalogId: 'catalog', catalogRevision: 4, indexRevision: 3, collectionStateRevision: 2, collectionCount: 1 };
const queryJson = JSON.stringify({ schemaVersion: 2, kind: 'photo-catalog-query', text: 'tree', filter: { kind: 'all' },
	sort: { field: 'rating', direction: 'descending' }, predicate: { kind: 'text', column: 'title', operator: 'contains', value: 'RAW' } });
const snapshot: PhotoLibrarySavedCollectionSnapshotV1 = { collectionId: 'saved', context,
	definition: { id: 'saved', revision: 2, name: 'Full recipe', queryJson } };
const libraryPage = { catalogName: 'Library', rows: [], totalCount: 1, cursor: null };
const ack: PhotoLibrarySavedCollectionAcknowledgementV1 = { outcome: 'updated', collectionId: 'saved',
	context: { ...context, catalogRevision: 5, indexRevision: 4, collectionStateRevision: 3 },
	summary: { id: 'saved', revision: 3, name: 'Full recipe' }, notices: [] };
const update = (): Extract<PhotoLibrarySavedCollectionCommandV1, { type: 'update' }> => ({ type: 'update', context: { ...context }, collectionId: 'saved',
	expectedDefinitionRevision: 2, name: 'Full recipe', queryJson });
function savedPort(): PhotoLibrarySavedCollectionPortV1 {
	return { readPage: async () => ({ items: [snapshot.definition!], cursor: null }),
		readSnapshot: async request => request.collectionId === null ? { collectionId: null, context, definition: null } : snapshot,
		readQueryStep: async () => { throw new Error('Authoring cannot scan photos.'); }, apply: async command => command.type === 'create'
			? { ...ack, outcome: 'created', collectionId: 'created', context: { ...ack.context, collectionCount: 2 }, summary: { id: 'created', revision: 0, name: command.name } }
			: command.type === 'delete' ? { ...ack, outcome: 'deleted', summary: null } : ack };
}
function session(savedCollections?: PhotoLibrarySavedCollectionPortV1): PhotoLibrarySessionPortV1 {
	const unexpected = async (): Promise<never> => { throw new Error('Unexpected Session operation.'); };
	return { savedCollections, readPage: unexpected, readQueryStep: unexpected, rebuildQueryStep: unexpected,
		readQueryStepV2: unexpected, readStackQueryStepV2: unexpected, rebuildQueryStepV2: unexpected,
		readStackQueryStep: unexpected, readStackMemberships: unexpected, readStackSnapshot: unexpected, readStackMembers: unexpected,
		readStackSummaryPage: unexpected, applyStack: unexpected, readBatchRenameSelection: unexpected,
		planBatchRename: () => { throw new Error('Unexpected rename.'); }, renamePhotos: unexpected, undoBatchRename: unexpected,
		readDefinitionPage: unexpected, readDefinition: unexpected, applyDefinition: unexpected, readMemberships: unexpected,
		applyMemberships: unexpected, readPreview: unexpected, importFiles: unexpected, setRating: unexpected, applyAttributes: unexpected,
		readMetadata: unexpected, applyMetadata: unexpected, readImportPresets: unexpected, applyImportPreset: unexpected,
		backupCatalog: unexpected, inspectOriginals: unexpected, restoreOriginalBody: unexpected, close: async () => undefined };
}
async function mount(saved: PhotoLibrarySavedCollectionPortV1 = savedPort()) {
	let generation: unknown = {}, hostGeneration: unknown = {}, live = true, active = false, externalBusy = false, selected: string | null = null;
	let operations = 0, acquisitions = 0, refreshes = 0, closes = 0, pending: Promise<unknown> | null = null;
	let stop = new AbortController(), current: ReturnType<typeof usePhotoSavedFilters> | undefined;
	const owner = session(saved), activations: Parameters<PhotoSavedFilterExecutionContextV1['activate']>[0][] = [], retirements: string[] = [];
	const sources = { acquire: async () => owner, refresh: async () => libraryPage,
		activate: async (_selection: Parameters<PhotoSavedFilterExecutionContextV1['activate']>[0]) => libraryPage,
		retire: (_collectionId: string): void => undefined };
	const execute: ExecutePhotoSavedFiltersV1 = async action => {
		if (!live) return 'cancelled'; if (active || externalBusy) return 'busy';
		active = true; operations++; stop = new AbortController(); const signal = stop.signal, admittedHost = hostGeneration;
		const running = (async () => {
			try {
				await action({ signal, isCurrent: () => live && hostGeneration === admittedHost,
					acquire: async () => { acquisitions++; return sources.acquire(); }, selectedCollectionId: () => selected,
					retireSavedSelection: (collectionId: string) => {
						if (live && hostGeneration === admittedHost && selected === collectionId) { retirements.push(collectionId); sources.retire(collectionId); }
					},
					refresh: async () => { refreshes++; return sources.refresh(); }, activate: async selection => {
						activations.push(selection); const page = await sources.activate(selection); signal.throwIfAborted();
						if (live && hostGeneration === admittedHost) selected = selection.kind === 'all' ? null : selection.collectionId;
						return page;
					} }); return 'completed' as const;
			} catch (failure) { return signal.aborted && failure === signal.reason ? 'cancelled' as const : 'failed' as const; }
			finally { active = false; }
		})();
		pending = running; try { return await running; } finally { if (pending === running) pending = null; }
	};
	function Harness() { current = usePhotoSavedFilters({ generation, execute }); return null; }
	const mounted = await mountPhotoImportUi(() => <StrictMode><Harness /></StrictMode>);
	return { ...mounted, owner, sources, activations, retirements, get filters() { assert.ok(current); return current; },
		get acquisitions() { return acquisitions; }, get operations() { return operations; }, get refreshes() { return refreshes; },
		get closes() { return closes; }, get selected() { return selected; },
		select(value: string | null) { selected = value; }, block(value: boolean) { externalBusy = value; },
		cancel(reason?: unknown) { stop.abort(reason); },
		async replace() { generation = {}; hostGeneration = {}; stop.abort(); await mounted.render(); },
		async replaceCodec() { generation = {}; stop.abort(); await mounted.render(); },
		async close() { live = false; stop.abort(); await pending; closes++; await owner.close(); },
	};
}

test('saved filter authoring remains dormant until a menu demand', async () => {
	let calls = 0, current: ReturnType<typeof usePhotoSavedFilters> | undefined;
	const execute: ExecutePhotoSavedFiltersV1 = async () => { calls++; return 'completed'; };
	function Harness() { current = usePhotoSavedFilters({ generation: null, execute }); return null; }
	const mounted = await mountPhotoImportUi(() => <StrictMode><Harness /></StrictMode>);
	try {
		assert.ok(current); assert.equal(calls, 0); assert.equal(current.page, null);
		assert.equal(current.loaded, null); assert.equal(current.receipt, null); assert.equal(current.busy, false);
		await act(async () => { await current?.showAll(); }); assert.equal(calls, 1);
	} finally { await mounted.dispose(); }
});

test('summary paging replaces at most64 detached rows and a loaded recipe is returned only to its caller', async () => {
	const saved = savedPort(), rows = Array.from({ length: 64 }, (_, index) => ({ id: `saved-${String(index)}`, revision: 1, name: `Filter ${String(index)}` }));
	let snapshots = 0;
	saved.readPage = async request => request?.cursor ? { items: [{ id: 'next', revision: 1, name: 'Next' }], cursor: null } : { items: rows, cursor: 'next-page' };
	saved.readSnapshot = async request => { snapshots++; return request.collectionId === null ? { collectionId: null, context, definition: null } : snapshot; };
	const mounted = await mount(saved);
	try {
		await act(async () => { await mounted.filters.readPage(); });
		assert.equal(mounted.filters.page?.items.length, 64); assert.equal(mounted.filters.page?.cursor, 'next-page');
		rows[0]!.name = 'Changed after return'; assert.equal(mounted.filters.page?.items[0]?.name, 'Filter 0');
		await act(async () => { const loaded = await mounted.filters.readSnapshot('saved'); assert.equal(loaded?.definition?.queryJson, queryJson); });
		assert.equal(snapshots, 1); assert.deepEqual(mounted.filters.loaded, { collectionId: 'saved', context, definition: { id: 'saved', revision: 2, name: 'Full recipe' } });
		assert.doesNotMatch(JSON.stringify(mounted.filters), /queryJson|photo-catalog-query/u);
		await act(async () => { await mounted.filters.readPage('next-page'); }); assert.equal(mounted.filters.page?.items.length, 1);
		await act(async () => { const loaded = await mounted.filters.readSnapshot(null); assert.equal(loaded?.definition, null); });
		assert.equal(mounted.filters.loaded?.collectionId, null); assert.equal(mounted.filters.loaded?.definition, null);
	} finally { await mounted.dispose(); }
});

test('update captures closed scalar context and recipe before a held acquisition', async () => {
	const saved = savedPort(), opened = deferred<PhotoLibrarySessionPortV1>(); let actual: PhotoLibrarySavedCollectionCommandV1 | null = null;
	saved.apply = async command => { actual = command; return ack; };
	const mounted = await mount(saved); mounted.sources.acquire = () => opened.promise;
	const mutable = { type: 'update' as const, context: { ...context }, collectionId: 'saved', expectedDefinitionRevision: 2,
		name: 'Full recipe', queryJson };
	let pending: Promise<PhotoSavedFilterApplyResultV1> | undefined;
	try {
		await act(async () => { pending = mounted.filters.apply(mutable); await settle(); });
		assert.equal(mounted.filters.busy, true); assert.equal(mounted.acquisitions, 1);
		mutable.context.catalogRevision = 90; mutable.name = 'Changed'; mutable.queryJson = '{}'; mutable.collectionId = 'other';
		await act(async () => { assert.deepEqual(await mounted.filters.apply(update()), { outcome: 'busy' }); });
		await act(async () => { opened.resolve(mounted.owner); assert.equal((await pending)?.outcome, 'acknowledged'); });
		assert.deepEqual(actual, update()); assert.ok(Object.isFrozen(actual));
		assert.equal(mounted.refreshes, 1); assert.deepEqual(mounted.activations, []);
		assert.deepEqual(mounted.retirements, []);
		assert.equal(mounted.filters.loaded?.definition?.revision, 3); assert.doesNotMatch(JSON.stringify(mounted.filters.loaded), /queryJson/u);
	} finally { opened.resolve(mounted.owner); await pending; await mounted.dispose(); }
});

test('malformed commands, IDs and cursors refuse before acquisition and never inspect accessor values', async () => {
	const mounted = await mount(); let probes = 0;
	try {
		const unsafe = { ...update(), get queryJson(): string { probes++; throw new Error('Do not read'); } };
		await act(async () => {
			assert.deepEqual(await mounted.filters.apply(unsafe), { outcome: 'failed' });
			assert.deepEqual(await mounted.filters.apply({ ...update(), context: { ...context, future: true } } as unknown as PhotoLibrarySavedCollectionCommandV1), { outcome: 'failed' });
			await mounted.filters.readPage('x'.repeat(4097)); assert.equal(await mounted.filters.readSnapshot('../saved'), null);
			await mounted.filters.use('../saved');
		});
		assert.equal(probes, 0); assert.equal(mounted.acquisitions, 0); assert.equal(mounted.operations, 0);
		mounted.block(true); await act(async () => { assert.deepEqual(await mounted.filters.apply(update()), { outcome: 'busy' }); });
		assert.equal(mounted.filters.busy, false); assert.equal(mounted.acquisitions, 0);
	} finally { await mounted.dispose(); }
});

test('cancellation of held acquisition retains exclusion and never starts a late read', async () => {
	const opened = deferred<PhotoLibrarySessionPortV1>(), saved = savedPort(); let reads = 0, probes = 0;
	saved.readSnapshot = async () => { reads++; return snapshot; };
	const mounted = await mount(saved); mounted.sources.acquire = () => opened.promise;
	const reason = new Proxy({}, { get() { probes++; throw new Error('Opaque cancellation'); }, getOwnPropertyDescriptor() { probes++; throw new Error('Opaque cancellation'); } });
	let pending: Promise<PhotoLibrarySavedCollectionSnapshotV1 | null> | undefined, settled = false;
	try {
		await act(async () => { pending = mounted.filters.readSnapshot('saved'); void pending.then(() => { settled = true; }); await settle(); });
		await act(async () => { mounted.cancel(reason); await mounted.filters.readPage(); assert.deepEqual(await mounted.filters.apply(update()), { outcome: 'busy' }); });
		assert.equal(settled, false); assert.equal(mounted.filters.busy, true); assert.equal(reads, 0);
		await act(async () => { opened.resolve(mounted.owner); assert.equal(await pending, null); });
		assert.equal(probes, 0); assert.equal(reads, 0); assert.equal(mounted.filters.error, null); assert.equal(mounted.filters.busy, false);
	} finally { opened.resolve(mounted.owner); await pending; await mounted.dispose(); }
});

test('close joins a held read before cleanup and suppresses the late summary', async () => {
	const held = deferred<PhotoLibrarySavedCollectionPageV1>(), saved = savedPort(); saved.readPage = () => held.promise;
	const mounted = await mount(saved); let pending: Promise<void> | undefined, closing: Promise<void> | undefined;
	try {
		await act(async () => { pending = mounted.filters.readPage(); await settle(); });
		await act(async () => { closing = mounted.close(); await settle(); });
		assert.equal(mounted.closes, 0); assert.equal(mounted.filters.busy, true);
		await act(async () => { held.resolve({ items: [snapshot.definition!], cursor: null }); await pending; await closing; });
		assert.equal(mounted.closes, 1); assert.equal(mounted.filters.page, null); assert.equal(mounted.filters.busy, false);
		await act(async () => { await mounted.filters.readPage(); }); assert.equal(mounted.acquisitions, 1);
	} finally { held.resolve({ items: [], cursor: null }); await pending; await closing; await mounted.dispose(); }
});

test('generation replacement fences held reads, stale callbacks and publication while keeping exclusion', async () => {
	const held = deferred<PhotoLibrarySavedCollectionSnapshotV1>(), saved = savedPort(); let reads = 0;
	saved.readSnapshot = async () => { reads++; return held.promise; };
	const mounted = await mount(saved); let pending: Promise<PhotoLibrarySavedCollectionSnapshotV1 | null> | undefined;
	try {
		await act(async () => { pending = mounted.filters.readSnapshot('saved'); await settle(); }); const stale = mounted.filters.readPage;
		await act(async () => { await mounted.replace(); await stale(); await mounted.filters.readPage(); });
		assert.equal(mounted.filters.loaded, null); assert.equal(mounted.filters.busy, true); assert.equal(mounted.acquisitions, 1);
		await act(async () => { held.resolve(snapshot); assert.equal(await pending, null); });
		assert.equal(reads, 1); assert.equal(mounted.filters.loaded, null); assert.equal(mounted.filters.busy, false);
		await act(async () => { await mounted.filters.readPage(); }); assert.equal(mounted.acquisitions, 2);
	} finally { held.resolve(snapshot); await pending; await mounted.dispose(); }
});

test('known durable ACK survives held write cancellation or generation retirement without publishing retired authority', async () => {
	for (const retirement of ['cancel', 'generation', 'close'] as const) {
		const held = deferred<PhotoLibrarySavedCollectionAcknowledgementV1>(), saved = savedPort(); let writerSignal: AbortSignal | undefined;
		saved.apply = (_command, options) => { writerSignal = options?.signal; return held.promise; };
		const mounted = await mount(saved); mounted.select('saved');
		let pending: Promise<PhotoSavedFilterApplyResultV1> | undefined, closing: Promise<void> | undefined;
		try {
			await act(async () => { pending = mounted.filters.apply(update()); await settle(); });
			await act(async () => { if (retirement === 'generation') await mounted.replace(); else if (retirement === 'close') closing = mounted.close(); else mounted.cancel(); await settle(); });
			assert.equal(mounted.filters.busy, true); assert.equal(mounted.closes, 0); assert.equal(writerSignal?.aborted, true);
			await act(async () => { held.resolve(ack); const result = await pending; assert.equal(result?.outcome, 'acknowledged');
				if (result?.outcome === 'acknowledged') { assert.deepEqual(result.receipt, ack); assert.equal(result.notice, retirement === 'cancel' ? 'refresh-failed' : null); }
				await closing; });
			assert.equal(mounted.refreshes, 0); if (retirement !== 'cancel') assert.equal(mounted.filters.receipt, null);
			assert.deepEqual(mounted.retirements, retirement === 'cancel' ? ['saved'] : []);
			if (retirement === 'cancel') { assert.deepEqual(mounted.filters.receipt, ack); assert.equal(mounted.filters.notice, 'refresh-failed'); assert.equal(mounted.filters.error, null); }
			assert.equal(mounted.filters.busy, false);
		} finally { held.resolve(ack); await pending; await closing; await mounted.dispose(); }
	}
});

test('a codec-only UI generation replacement still retires a late acknowledged edit in the live Session', async () => {
	const held = deferred<PhotoLibrarySavedCollectionAcknowledgementV1>(), saved = savedPort(); saved.apply = () => held.promise;
	const mounted = await mount(saved); mounted.select('saved');
	let pending: Promise<PhotoSavedFilterApplyResultV1> | undefined;
	try {
		await act(async () => { pending = mounted.filters.apply(update()); await settle(); });
		await act(async () => { await mounted.replaceCodec(); });
		assert.equal(mounted.filters.receipt, null); assert.equal(mounted.filters.loaded, null); assert.equal(mounted.filters.busy, true);
		await act(async () => { held.resolve(ack); const result = await pending; assert.equal(result?.outcome, 'acknowledged');
			if (result?.outcome === 'acknowledged') assert.deepEqual(result.receipt, ack); });
		assert.deepEqual(mounted.retirements, ['saved']); assert.equal(mounted.filters.receipt, null); assert.equal(mounted.filters.loaded, null);
		assert.equal(mounted.filters.notice, null); assert.equal(mounted.filters.error, null); assert.equal(mounted.filters.busy, false);
		assert.equal(mounted.activations.length, 0); assert.equal(mounted.refreshes, 0); assert.equal(mounted.closes, 0);
	} finally { held.resolve(ack); await pending; await mounted.dispose(); }
});

test('a retirement notification failure cannot erase the known durable ACK', async () => {
	const mounted = await mount(); mounted.select('saved'); mounted.sources.retire = () => { throw new Error('Host retirement failed.'); };
	try {
		await act(async () => { const result = await mounted.filters.apply(update()); assert.equal(result.outcome, 'acknowledged');
			if (result.outcome === 'acknowledged') { assert.deepEqual(result.receipt, ack); assert.equal(result.notice, 'refresh-failed'); } });
		assert.deepEqual(mounted.filters.receipt, ack); assert.equal(mounted.filters.notice, 'refresh-failed');
		assert.match(mounted.filters.error ?? '', /Host retirement failed/u); assert.equal(mounted.activations.length, 0);
		assert.equal(mounted.filters.busy, false);
	} finally { await mounted.dispose(); }
});

test('failed refresh preserves scalar ACK and active definition updates retire the saved query cursor', async () => {
	const mounted = await mount(); mounted.select('saved'); mounted.sources.activate = async () => {
		assert.deepEqual(mounted.retirements, ['saved']); throw new Error('Updated definition could not be read.');
	};
	try {
		await act(async () => { const result = await mounted.filters.apply(update()); assert.equal(result.outcome, 'acknowledged');
			if (result.outcome === 'acknowledged') assert.equal(result.notice, 'refresh-failed'); });
		assert.deepEqual(mounted.activations, [{ kind: 'saved', collectionId: 'saved' }]); assert.equal(mounted.refreshes, 0);
		assert.deepEqual(mounted.retirements, ['saved']);
		assert.deepEqual(mounted.filters.receipt, ack); assert.equal(mounted.filters.notice, 'refresh-failed'); assert.match(mounted.filters.error ?? '', /Updated definition/u);
		mounted.sources.refresh = async () => { throw new Error('Ordinary refresh failed.'); };
		await act(async () => { const created = { type: 'create' as const, context, name: 'New', queryJson };
			assert.equal((await mounted.filters.apply(created)).outcome, 'acknowledged'); });
		assert.equal(mounted.activations.length, 1); assert.equal(mounted.refreshes, 1); assert.equal(mounted.selected, 'saved');
		assert.deepEqual(mounted.retirements, ['saved']);
	} finally { await mounted.dispose(); }
});

test('an active update retires its saved cursor after known ACK even when cancellation already prevents refresh', async () => {
	const held = deferred<PhotoLibrarySavedCollectionAcknowledgementV1>(), saved = savedPort(); saved.apply = () => held.promise;
	const mounted = await mount(saved); mounted.select('saved');
	let pending: Promise<PhotoSavedFilterApplyResultV1> | undefined;
	try {
		await act(async () => { pending = mounted.filters.apply(update()); await settle(); });
		assert.deepEqual(mounted.retirements, []);
		await act(async () => { mounted.cancel(); held.resolve(ack); const result = await pending;
			assert.equal(result?.outcome, 'acknowledged'); if (result?.outcome === 'acknowledged') assert.equal(result.notice, 'refresh-failed'); });
		assert.deepEqual(mounted.retirements, ['saved']); assert.equal(mounted.selected, 'saved');
		assert.equal(mounted.activations.length, 0); assert.equal(mounted.refreshes, 0); assert.deepEqual(mounted.filters.receipt, ack);
	} finally { held.resolve(ack); await pending; await mounted.dispose(); }
});

test('cancellation during held refresh keeps the known ACK and joins refresh before releasing exclusion', async () => {
	const held = deferred<typeof libraryPage>(), mounted = await mount(); mounted.sources.refresh = () => held.promise;
	let pending: Promise<PhotoSavedFilterApplyResultV1> | undefined, settled = false, probes = 0;
	const reason = new Proxy({}, { get() { probes++; throw new Error('Do not inspect cancellation'); },
		getOwnPropertyDescriptor() { probes++; throw new Error('Do not inspect cancellation'); } });
	try {
		await act(async () => { pending = mounted.filters.apply(update()); void pending.then(() => { settled = true; }); await settle(); });
		assert.deepEqual(mounted.filters.receipt, ack); assert.equal(mounted.refreshes, 1);
		await act(async () => { mounted.cancel(reason); assert.deepEqual(await mounted.filters.apply(update()), { outcome: 'busy' }); });
		assert.equal(settled, false); assert.equal(mounted.filters.busy, true);
		await act(async () => { held.resolve(libraryPage); const result = await pending; assert.equal(result?.outcome, 'acknowledged');
			if (result?.outcome === 'acknowledged') assert.equal(result.notice, 'refresh-failed'); });
		assert.equal(probes, 0); assert.deepEqual(mounted.filters.receipt, ack); assert.equal(mounted.filters.error, null);
		assert.equal(mounted.filters.notice, 'refresh-failed'); assert.equal(mounted.filters.busy, false);
	} finally { held.resolve(libraryPage); await pending; await mounted.dispose(); }
});

test('active deletion refuses before acquisition until explicit Show all or use of another filter', async () => {
	const saved = savedPort(); let writes = 0;
	saved.apply = async command => { writes++; assert.equal(command.type, 'delete'); return { ...ack, outcome: 'deleted', summary: null }; };
	const mounted = await mount(saved); mounted.select('saved');
	const command: PhotoLibrarySavedCollectionCommandV1 = { type: 'delete', context, collectionId: 'saved', expectedDefinitionRevision: 2 };
	try {
		await act(async () => { assert.deepEqual(await mounted.filters.apply(command), { outcome: 'failed' }); });
		assert.equal(writes, 0); assert.equal(mounted.acquisitions, 0); assert.equal(mounted.selected, 'saved'); assert.match(mounted.filters.error ?? '', /Show all/u);
		await act(async () => { await mounted.filters.showAll(); assert.equal((await mounted.filters.apply(command)).outcome, 'acknowledged'); });
		assert.equal(writes, 1); assert.equal(mounted.selected, null); assert.equal(mounted.filters.loaded?.definition, null);
		mounted.select('saved'); await act(async () => { await mounted.filters.use('other'); assert.equal((await mounted.filters.apply(command)).outcome, 'acknowledged'); });
		assert.equal(writes, 2); assert.equal(mounted.selected, 'other'); assert.deepEqual(mounted.activations, [{ kind: 'all' }, { kind: 'saved', collectionId: 'other' }]);
		assert.deepEqual(mounted.retirements, []);
	} finally { await mounted.dispose(); }
});

test('a selection becoming active during held acquisition is checked again before the writer', async () => {
	const opened = deferred<PhotoLibrarySessionPortV1>(), saved = savedPort(); let writes = 0;
	saved.apply = async () => { writes++; return ack; };
	const mounted = await mount(saved); mounted.sources.acquire = () => opened.promise;
	let pending: Promise<PhotoSavedFilterApplyResultV1> | undefined;
	try {
		await act(async () => { pending = mounted.filters.apply({ type: 'delete', context, collectionId: 'saved', expectedDefinitionRevision: 2 }); await settle(); });
		mounted.select('saved'); await act(async () => { opened.resolve(mounted.owner); assert.deepEqual(await pending, { outcome: 'failed' }); });
		assert.equal(writes, 0); assert.equal(mounted.activations.length, 0);
	} finally { opened.resolve(mounted.owner); await pending; await mounted.dispose(); }
});

test('bounded presentation rejects oversized pages and missing capability without opening alternative resources', async () => {
	const saved = savedPort(); saved.readPage = async () => ({ items: Array.from({ length: 65 }, () => snapshot.definition!), cursor: null });
	const mounted = await mount(saved);
	try {
		await act(async () => { await mounted.filters.readPage(); }); assert.equal(mounted.filters.page, null); assert.match(mounted.filters.error ?? '', /64 row/u);
		mounted.sources.acquire = async () => session();
		await act(async () => { assert.equal(await mounted.filters.readSnapshot('saved'), null); }); assert.match(mounted.filters.error ?? '', /unavailable/u);
		assert.equal(mounted.acquisitions, 2); assert.equal(mounted.closes, 0);
	} finally { await mounted.dispose(); }
});

test('a true repository error after cancellation remains visible while an opaque reason is never inspected', async () => {
	const held = deferred<PhotoLibrarySavedCollectionPageV1>(), saved = savedPort(); saved.readPage = () => held.promise;
	const mounted = await mount(saved); let pending: Promise<void> | undefined, probes = 0;
	const reason = new Proxy({}, { getOwnPropertyDescriptor() { probes++; throw new Error('Do not inspect cancellation'); } });
	try {
		await act(async () => { pending = mounted.filters.readPage(); await settle(); });
		await act(async () => { mounted.cancel(reason); held.reject(new Error('Actual repository cleanup failed.')); await pending; });
		assert.equal(probes, 0); assert.match(mounted.filters.error ?? '', /Actual repository cleanup/u); assert.equal(mounted.filters.busy, false);
	} finally { held.resolve({ items: [], cursor: null }); await pending; await mounted.dispose(); }
});
