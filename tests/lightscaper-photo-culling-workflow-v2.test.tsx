/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React, { act, StrictMode } from 'react';
import { usePhotoLibraryWorkflowV2 } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow-v2.ts';
import { usePhotoLibrarySelection } from '../src/common/editor/ui/lightscaper/use-photo-library-selection.ts';
import type { CreatePhotoLibrarySessionV3 } from '../src/common/editor/photo-library-session-port-v2.ts';
import type { PhotoLibraryCullAdvanceRequestV1 } from '../src/common/editor/controller/shared/photo-library-cull-advance-v1.ts';
import type { PhotoLibraryCullingNavigationPortV1 } from '../src/common/editor/photo-library-culling-navigation-port-v1.ts';
import type { PhotoLibraryCullReceiptV1 } from '../src/common/editor/controller/shared/photo-library-culling-v1.ts';
import type { PhotoLibraryAttributePatchV1, PhotoLibraryPageV1, PhotoLibraryQueryV1, PhotoLibraryRowV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import type { PhotoLibrarySavedCollectionSnapshotV1 } from '../src/common/editor/photo-library-saved-collection-port-v1.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { PhotoLibrarySessionV2 } from '../src/lightscaper/controller/photo-library-session-v2.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { seedCurrentAppPhoto } from './helpers/lightscaper-current-app-fixture.tsx';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const row = (id: string, rating = 0): Readonly<PhotoLibraryRowV1> => Object.freeze({ id, fileName: `${id}.png`, width: 1, height: 1,
	rating, flag: 'unflagged', colorLabel: 'none' });
const firstRows = Object.freeze(Array.from({ length: 64 }, (_, index) => row(`photo-${String(index).padStart(3, '0')}`)));
const nextRows = Object.freeze(Array.from({ length: 16 }, (_, index) => row(`photo-${String(index + 64).padStart(3, '0')}`)));
const page = (rows: readonly PhotoLibraryRowV1[], cursor: string | null): Readonly<PhotoLibraryPageV1> =>
	Object.freeze({ catalogName: 'Current', totalCount: 80, rows, cursor });
function advance(current = () => true) {
	const ids: string[] = [];
	const request: Readonly<PhotoLibraryCullAdvanceRequestV1> = Object.freeze({ successorIds: Object.freeze([] as string[]), isCurrent: current,
		captureNextPage(values: readonly string[]) { ids.push(...values); } });
	return { ids, request };
}
async function fixture() {
	const native = mediaRestoreFixture(), seeded = await seedCurrentAppPhoto(native.factory), owner = await seeded.createSession();
	const events: string[] = [], first = page(firstRows, 'old-valid-cursor'), destination = page(nextRows, 'fresh-cursor');
	const navigation: PhotoLibraryCullingNavigationPortV1 = { async readDestinationPage(_context, options) {
		events.push(`destination:${options.photoId}`); return options.photoId === firstRows[0]!.id ? first : destination;
	} };
	const port = Object.assign(owner, { readPage: async (options: { cursor?: string | null } = {}) => {
		events.push(`read:${options.cursor ?? 'first'}`); return options.cursor ? destination : first;
	}, setRating: async (id: string, rating: number) => { events.push(`save:${id}`); return row(id, rating); },
		applyAttributes: async (id: string, changes: PhotoLibraryAttributePatchV1) => { events.push(`save:${id}`); return Object.freeze({ ...row(id), ...changes }); },
		cullingNavigation: navigation });
	return { seeded, owner, port, events, first, destination };
}
async function mount(initialFactory: CreatePhotoLibrarySessionV3) {
	const dom = installReactTestDom(), prior = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
	Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
	const { createRoot } = await import('react-dom/client'), root = createRoot(dom.container as unknown as Element);
	let state: ReturnType<typeof usePhotoLibraryWorkflowV2> | null = null, selected: ReturnType<typeof usePhotoLibrarySelection> | null = null, unmounted = false;
	function Harness({ factory }: { factory: CreatePhotoLibrarySessionV3 }) {
		state = usePhotoLibraryWorkflowV2(factory);
		selected = usePhotoLibrarySelection({ photoIds: state.page?.rows.map(value => value.id) ?? [], generation: factory,
			pageIdentity: state.page, queryIdentity: state.queryIdentity, autoAdvance: true }); return null;
	}
	const render = async (factory = initialFactory) => { await act(async () => { root.render(<StrictMode><Harness factory={factory} /></StrictMode>); await settle(); }); };
	const unmount = async () => { if (unmounted) return; unmounted = true; await act(async () => { root.unmount(); await settle(); }); };
	await render();
	return { render, unmount, get current() { assert.ok(state); return state; }, get selection() { assert.ok(selected); return selected; }, async start(action: () => Promise<PhotoLibraryCullReceiptV1>) {
		let pending: Promise<PhotoLibraryCullReceiptV1> | undefined;
		await act(async () => { pending = action(); await settle(); }); assert.ok(pending); return { pending };
	}, async dispose() { try { await unmount(); } finally { dom.restore(); if (prior) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', prior); else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT'); } } };
}

test('current plain auto-off edit refreshes an inclusive page and retains a fresh continuation', async () => {
	const f = await fixture(), mounted = await mount(async () => f.port);
	try {
		await act(async () => { await mounted.current.readPage(); });
		let receipt: PhotoLibraryCullReceiptV1 | undefined;
		await act(async () => { receipt = await mounted.current.setRating(firstRows[0]!.id, 4); });
		assert.ok(receipt); if (receipt.outcome !== 'saved') assert.fail('Durable edit must remain saved.');
		assert.equal(receipt.page, mounted.current.page); assert.equal(receipt.page?.cursor, 'old-valid-cursor');
		assert.deepEqual(f.events, ['read:first', 'save:photo-000', 'destination:photo-000']);
	} finally { await mounted.dispose(); }
});

test('mounted current workflow and actual culling owner advance across the page edge then use the fresh continuation again', async () => {
	const f = await fixture(), mounted = await mount(async () => f.port);
	try {
		await act(async () => { await mounted.current.readPage(); });
		await act(async () => { mounted.selection.select(firstRows[63]!.id); mounted.selection.focus(firstRows[63]!.id); });
		await act(async () => { await mounted.selection.cull(firstRows[63]!.id, (signal, advance) => mounted.current.setRating(firstRows[63]!.id, 5, { signal, ...(advance ? { advance } : {}) })); });
		assert.equal(mounted.selection.snapshot.focusedId, nextRows[0]!.id); assert.deepEqual(mounted.selection.snapshot.selectedIds, [nextRows[0]!.id]);
		assert.equal(mounted.current.page, f.destination);
		const second = page(nextRows.slice(1), null);
		f.port.cullingNavigation.readDestinationPage = async (_context, request) => request.photoId === nextRows[1]!.id ? second : f.destination;
		await act(async () => { await mounted.selection.cull(nextRows[0]!.id, (signal, advance) => mounted.current.applyAttributes(nextRows[0]!.id, { flag: 'pick' }, { signal, ...(advance ? { advance } : {}) })); });
		assert.equal(mounted.selection.snapshot.focusedId, nextRows[1]!.id); assert.equal(mounted.current.page, f.destination);
	} finally { await mounted.dispose(); }
});

test('lookahead failure still saves the requested rating and retains an honest refresh notice without a stale cursor', async () => {
	const f = await fixture(), mounted = await mount(async () => f.port), failure = Symbol('lookahead');
	f.port.readPage = async options => { if (options?.cursor) throw failure; return f.first; };
	try {
		await act(async () => { await mounted.current.readPage(); });
		let receipt: PhotoLibraryCullReceiptV1 | undefined;
		await act(async () => { receipt = await mounted.current.setRating(firstRows[63]!.id, 4, { advance: advance().request }); });
		assert.deepEqual(receipt, { outcome: 'saved', photoId: firstRows[63]!.id, page: null, notice: 'refresh-failed' });
		assert.equal(mounted.current.page?.rows[63]?.rating, 4); assert.equal(mounted.current.page?.cursor, null);
		assert.equal(f.events.filter(value => value.startsWith('save:')).length, 1);
	} finally { await mounted.dispose(); }
});

test('in-page auto-advance retains all three visible rows for subsequent multi-selection and stops at the end', async () => {
	const f = await fixture(), rows = firstRows.slice(0, 3), window = page(rows, null), mounted = await mount(async () => f.port);
	f.port.readPage = async () => window;
	f.port.cullingNavigation.readDestinationPage = async (_context, request) => page(rows.slice(rows.findIndex(value => value.id === request.photoId)), null);
	try {
		await act(async () => { await mounted.current.readPage(); });
		await act(async () => { mounted.selection.select(rows[0]!.id); mounted.selection.focus(rows[0]!.id); });
		for (let index = 0; index < 3; index++) {
			const id = rows[index]!.id;
			await act(async () => { await mounted.selection.cull(id, (signal, advance) => mounted.current.setRating(id, index + 1, { signal, advance })); });
			assert.deepEqual(mounted.current.page?.rows.map(value => value.id), rows.map(value => value.id));
			assert.equal(mounted.selection.snapshot.focusedId, rows[Math.min(index + 1, 2)]!.id);
		}
		await act(async () => { mounted.selection.select(rows[0]!.id, { toggle: true }); });
		assert.deepEqual(mounted.selection.snapshot.selectedIds, [rows[0]!.id, rows[2]!.id]);
	} finally { await mounted.dispose(); }
});

test('queried and saved in-page rating culls keep the edited first row when its actual order is unchanged', async () => {
	for (const kind of ['query', 'saved'] as const) {
		const f = await fixture(), rows = firstRows.slice(0, 3), window = page(rows, null), mounted = await mount(async () => f.port);
		const query: PhotoLibraryQueryV1 = Object.freeze({ text: '', filter: null, sort: Object.freeze({ field: 'file-name', direction: 'ascending' }) });
		f.port.readQueryStep = async () => Object.freeze({ ...window, scanned: 3 });
		Object.assign(f.port, { savedCollections: { ...f.port.savedCollections!,
			readSnapshot: async (): Promise<PhotoLibrarySavedCollectionSnapshotV1> => Object.freeze({ collectionId: 'saved',
				context: { catalogId: 'catalog', catalogRevision: 1, indexRevision: 1, collectionStateRevision: 0, collectionCount: 1 },
				definition: { id: 'saved', revision: 0, name: 'Saved', queryJson: JSON.stringify(query) } }),
			readQueryStep: async () => Object.freeze({ ...window, scanned: 3, collectionId: 'saved', collectionName: 'Saved', mode: 'ordinary' as const,
				context: { catalogId: 'catalog', catalogRevision: 1, indexRevision: 1, collectionStateRevision: 0 }, definitionRevision: 0,
				definitionSha256: 'a'.repeat(64), querySha256: 'b'.repeat(64), stackStateRevision: null }) } });
		f.port.cullingNavigation.readDestinationPage = async (_context, request) => page(rows.slice(rows.findIndex(value => value.id === request.photoId)), null);
		try {
			await act(async () => { if (kind === 'query') await mounted.current.applyQuery(query);
				else await mounted.current.executeSavedFilters(context => context.activate({ kind: 'saved', collectionId: 'saved' }).then(() => undefined)); });
			await act(async () => { mounted.selection.select(rows[0]!.id); mounted.selection.focus(rows[0]!.id); });
			await act(async () => { await mounted.selection.cull(rows[0]!.id, (signal, advance) => mounted.current.setRating(rows[0]!.id, 5, { signal, advance })); });
			assert.deepEqual(mounted.current.page?.rows.map(value => value.id), rows.map(value => value.id));
			assert.equal(mounted.selection.snapshot.focusedId, rows[1]!.id);
		} finally { await mounted.dispose(); }
	}
});

test('native destination refusal after ACK cannot relabel the rating as cancelled or lose the updated fallback row', async () => {
	const f = await fixture(), mounted = await mount(async () => f.port), failure = Symbol('destination');
	f.port.cullingNavigation.readDestinationPage = async () => { throw failure; };
	try {
		await act(async () => { await mounted.current.readPage(); });
		let receipt: PhotoLibraryCullReceiptV1 | undefined;
		await act(async () => { receipt = await mounted.current.setRating(firstRows[0]!.id, 3); });
		assert.deepEqual(receipt, { outcome: 'saved', photoId: firstRows[0]!.id, page: null, notice: 'refresh-failed' });
		assert.equal(mounted.current.page?.rows[0]?.rating, 3); assert.equal(mounted.current.page?.cursor, null); assert.equal(mounted.current.busy, false);
	} finally { await mounted.dispose(); }
});

test('one foreground action joins held lookahead and refuses reentry; native ports and authored attributes pin before that await', async () => {
	const f = await fixture(), gate = deferred<PhotoLibraryPageV1>(), entered = deferred<void>(), mounted = await mount(async () => f.port);
	let writes = 0;
	f.port.readPage = async options => { if (!options?.cursor) return f.first; entered.resolve(); return gate.promise; };
	f.port.applyAttributes = async (photoId, changes) => { writes++; assert.equal(changes.flag, 'pick'); return Object.freeze({ ...row(photoId), ...changes }); };
	const changes: { flag: 'pick' | 'reject' } = { flag: 'pick' }; let work: Promise<PhotoLibraryCullReceiptV1> | undefined;
	try {
		await act(async () => { await mounted.current.readPage(); });
		work = (await mounted.start(() => mounted.current.applyAttributes(firstRows[63]!.id, changes, { advance: advance().request }))).pending;
		await entered.promise; assert.equal(await remainsPending(work), true); assert.equal(writes, 0); changes.flag = 'reject';
		f.port.applyAttributes = async () => { throw new Error('Substituted write invoked.'); };
		f.port.cullingNavigation.readDestinationPage = async () => { throw new Error('Substituted navigation invoked.'); };
		await act(async () => { assert.deepEqual(await mounted.current.setRating(firstRows[0]!.id, 1), { outcome: 'busy' }); });
		let receipt: PhotoLibraryCullReceiptV1 | undefined;
		await act(async () => { gate.resolve(f.destination); receipt = await work; });
		assert.equal(receipt?.outcome, 'saved'); assert.equal(writes, 1); assert.equal(mounted.current.page, f.destination);
	} finally { gate.resolve(f.destination); await work; await mounted.dispose(); }
});

test('sparse query lookahead drains an empty continuation and seeks the first surviving witness in the captured query order', async () => {
	const f = await fixture(), mounted = await mount(async () => f.port), witness = advance();
	const query: PhotoLibraryQueryV1 = Object.freeze({ text: '', filter: null, sort: Object.freeze({ field: 'file-name', direction: 'ascending' }) });
	f.port.readQueryStep = async request => {
		f.events.push(`query:${request.cursor ?? 'first'}`);
		return Object.freeze({ ...(request.cursor === 'old-valid-cursor' ? page([], 'empty-continuation') : request.cursor ? f.destination : f.first), scanned: 64 });
	};
	f.port.cullingNavigation.readDestinationPage = async (context, request) => {
		assert.deepEqual(context, { kind: 'query', query, collapsed: false }); f.events.push(`destination:${request.photoId}`);
		return request.photoId === nextRows[0]!.id ? null : page(nextRows.slice(1), 'fresh-query-cursor');
	};
	try {
		await act(async () => { await mounted.current.applyQuery(query); });
		let receipt: PhotoLibraryCullReceiptV1 | undefined;
		await act(async () => { receipt = await mounted.current.setRating(firstRows[63]!.id, 4, { advance: witness.request }); });
		assert.equal(receipt?.outcome, 'saved'); assert.deepEqual(witness.ids, nextRows.map(value => value.id));
		assert.equal(mounted.current.page?.rows[0]?.id, nextRows[1]!.id); assert.equal(mounted.current.page?.cursor, 'fresh-query-cursor');
		assert.deepEqual(f.events, ['query:first', 'query:old-valid-cursor', 'query:empty-continuation', 'save:photo-063', 'destination:photo-064', 'destination:photo-065']);
	} finally { await mounted.dispose(); }
});

test('a mutable query changed during a held edit cannot publish a destination from its obsolete sort', async () => {
	const f = await fixture(), gate = deferred<PhotoLibraryPageV1>(), entered = deferred<void>(), mounted = await mount(async () => f.port);
	const query = { text: '', filter: null, sort: { field: 'file-name' as const, direction: 'ascending' as 'ascending' | 'descending' } };
	f.port.readQueryStep = async () => Object.freeze({ ...f.first, scanned: 64 });
	f.port.cullingNavigation.readDestinationPage = async context => { assert.equal(context.kind, 'query'); entered.resolve(); return gate.promise; };
	let work: Promise<PhotoLibraryCullReceiptV1> | undefined;
	try {
		await act(async () => { await mounted.current.applyQuery(query); }); const before = mounted.current.page;
		work = (await mounted.start(() => mounted.current.setRating(firstRows[0]!.id, 5))).pending;
		await entered.promise; query.sort.direction = 'descending';
		let receipt: PhotoLibraryCullReceiptV1 | undefined;
		await act(async () => { gate.resolve(f.destination); receipt = await work; });
		assert.deepEqual(receipt, { outcome: 'saved', photoId: firstRows[0]!.id, page: null, notice: 'refresh-failed' });
		assert.equal(mounted.current.page, before);
	} finally { gate.resolve(f.destination); await work; await mounted.dispose(); }
});

test('same-revision saved definition changes after the edit refuse the old successor witness while preserving native ACK', async () => {
	const f = await fixture(), mounted = await mount(async () => f.port); let definition = '{"sort":"before"}', destinations = 0;
	const saved = { ...f.port.savedCollections!, readSnapshot: async (): Promise<PhotoLibrarySavedCollectionSnapshotV1> => Object.freeze({
		collectionId: 'saved', context: Object.freeze({ catalogId: 'catalog', catalogRevision: 1, indexRevision: 1, collectionStateRevision: 3, collectionCount: 1 }),
		definition: Object.freeze({ id: 'saved', revision: 4, name: 'Saved', queryJson: definition }) }),
		readQueryStep: async () => Object.freeze({ ...f.first, scanned: 64, collectionId: 'saved', collectionName: 'Saved', mode: 'ordinary' as const,
			context: { catalogId: 'catalog', catalogRevision: 1, indexRevision: 1, collectionStateRevision: 3 }, definitionRevision: 4,
			definitionSha256: 'a'.repeat(64), querySha256: 'b'.repeat(64), stackStateRevision: null }) };
	Object.assign(f.port, { savedCollections: saved });
	f.port.setRating = async (photoId, rating) => { definition = '{"sort":"after"}'; return row(photoId, rating); };
	f.port.cullingNavigation.readDestinationPage = async () => { destinations++; return f.destination; };
	try {
		await act(async () => { await mounted.current.executeSavedFilters(context => context.activate({ kind: 'saved', collectionId: 'saved' }).then(() => undefined)); });
		let receipt: PhotoLibraryCullReceiptV1 | undefined;
		await act(async () => { receipt = await mounted.current.setRating(firstRows[0]!.id, 3); });
		assert.deepEqual(receipt, { outcome: 'saved', photoId: firstRows[0]!.id, page: null, notice: 'refresh-failed' });
		assert.equal(destinations, 0); assert.equal(mounted.current.page?.rows[0]?.rating, 3);
	} finally { await mounted.dispose(); }
});

test('collapsed-stack state changes across ACK refuse old cover witnesses without substituting hidden member IDs', async () => {
	const f = await fixture(), mounted = await mount(async () => f.port); let revision = 0, destinations = 0;
	f.port.readStackQueryStepV2 = async () => Object.freeze({ ...f.first, scanned: 64 });
	f.port.readStackSnapshot = async () => Object.freeze({ context: Object.freeze({ schemaVersion: 1, catalogId: 'catalog', catalogRevision: 1, indexRevision: 1,
		stateRevision: revision, stackCount: 1 }), stack: Object.freeze({ id: 'stack', revision: 0, photoIds: [firstRows[0]!.id, 'hidden-member'], coverPhotoId: firstRows[0]!.id }) });
	f.port.setRating = async (photoId, rating) => { revision++; return row(photoId, rating); };
	f.port.cullingNavigation.readDestinationPage = async () => { destinations++; return f.destination; };
	try {
		await act(async () => { await mounted.current.setStackCollapsed(true); });
		let receipt: PhotoLibraryCullReceiptV1 | undefined;
		await act(async () => { receipt = await mounted.current.setRating(firstRows[0]!.id, 4); });
		assert.deepEqual(receipt, { outcome: 'saved', photoId: firstRows[0]!.id, page: null, notice: 'refresh-failed' });
		assert.equal(destinations, 0); assert.equal(mounted.current.page?.rows.some(value => value.id === 'hidden-member'), false);
	} finally { await mounted.dispose(); }
});

test('same-root-revision catalog smart predicate changes across ACK refuse obsolete collection navigation', async () => {
	const f = await fixture(), mounted = await mount(async () => f.port); let queryJson = '{"rating":0}', destinations = 0;
	const query: PhotoLibraryQueryV1 = Object.freeze({ text: '', filter: Object.freeze({ kind: 'collection', id: 'smart' }),
		sort: Object.freeze({ field: 'photo-id', direction: 'ascending' }) });
	f.port.readQueryStep = async () => Object.freeze({ ...f.first, scanned: 64 });
	f.port.readDefinition = async () => Object.freeze({ rootRevision: 1, row: Object.freeze({ kind: 'collection', collectionKind: 'smart', id: 'smart', name: 'Smart' }), queryJson });
	f.port.setRating = async (photoId, rating) => { queryJson = '{"rating":5}'; return row(photoId, rating); };
	f.port.cullingNavigation.readDestinationPage = async () => { destinations++; return f.destination; };
	try {
		await act(async () => { await mounted.current.applyQuery(query); });
		let receipt: PhotoLibraryCullReceiptV1 | undefined;
		await act(async () => { receipt = await mounted.current.setRating(firstRows[0]!.id, 5); });
		assert.deepEqual(receipt, { outcome: 'saved', photoId: firstRows[0]!.id, page: null, notice: 'refresh-failed' });
		assert.equal(destinations, 0); assert.equal(mounted.current.page?.rows[0]?.rating, 5);
	} finally { await mounted.dispose(); }
});

test('actual manual selection while destination read is held fences both page installation and automatic focus', async () => {
	const f = await fixture(), gate = deferred<PhotoLibraryPageV1>(), entered = deferred<void>(), mounted = await mount(async () => f.port);
	f.port.cullingNavigation.readDestinationPage = async () => { entered.resolve(); return gate.promise; };
	let work: Promise<PhotoLibraryCullReceiptV1> | undefined;
	try {
		await act(async () => { await mounted.current.readPage(); });
		await act(async () => { mounted.selection.select(firstRows[63]!.id); mounted.selection.focus(firstRows[63]!.id); });
		work = (await mounted.start(() => mounted.selection.cull(firstRows[63]!.id, (signal, advance) => mounted.current.setRating(firstRows[63]!.id, 5, { signal, advance })))).pending;
		await entered.promise;
		await act(async () => { mounted.selection.select(firstRows[0]!.id); mounted.selection.focus(firstRows[0]!.id); });
		await act(async () => { gate.resolve(f.destination); await work; });
		assert.deepEqual(mounted.current.page?.rows.map(value => value.id), firstRows.map(value => value.id));
		assert.equal(mounted.selection.snapshot.focusedId, firstRows[0]!.id); assert.deepEqual(mounted.selection.snapshot.selectedIds, [firstRows[0]!.id]);
		assert.equal(mounted.current.page?.rows[63]?.rating, 5);
	} finally { gate.resolve(f.destination); await work; await mounted.dispose(); }
});

test('no successor at the true end refreshes the same window without wrapping and a missing optional port retains the legacy flow', async () => {
	for (const native of [true, false]) {
		const f = await fixture(), last = page(nextRows, null); f.port.readPage = async () => last;
		if (native) f.port.cullingNavigation.readDestinationPage = async (_context, request) => { assert.equal(request.photoId, nextRows[0]!.id); return last; };
		else Reflect.deleteProperty(f.port, 'cullingNavigation');
		const mounted = await mount(async () => f.port), witness = advance();
		try {
			await act(async () => { await mounted.current.readPage(); await mounted.current.setRating(nextRows[15]!.id, 5, { advance: witness.request }); });
			assert.deepEqual(witness.ids, []); assert.deepEqual(mounted.current.page?.rows.map(value => value.id), nextRows.map(value => value.id));
			assert.equal(mounted.current.page?.cursor, null);
		} finally { await mounted.dispose(); }
	}
});

test('closed advance and attribute requests refuse getters before lazy Session acquisition', async () => {
	let opens = 0, getters = 0;
	const mounted = await mount(async () => { opens++; throw new Error('Unexpected acquisition.'); });
	try {
		const requested = Object.defineProperty({}, 'advance', { enumerable: true, get() { getters++; return advance().request; } });
		await assert.rejects(mounted.current.setRating('photo', 3, requested), /own data/u);
		const changed = Object.defineProperty({}, 'flag', { enumerable: true, get() { getters++; return 'pick'; } });
		assert.throws(() => mounted.current.applyAttributes('photo', changed), /own data/u);
		assert.equal(opens, 0); assert.equal(getters, 0);
	} finally { await mounted.dispose(); }
});

test('current App-shaped omitted advance stays compatible for rating and attribute edits', async () => {
	const f = await fixture(), mounted = await mount(async () => f.port), signal = new AbortController().signal;
	try {
		await act(async () => { await mounted.current.readPage(); });
		await act(async () => { assert.equal((await mounted.current.setRating(firstRows[0]!.id, 2, { signal, advance: undefined })).outcome, 'saved');
			assert.equal((await mounted.current.applyAttributes(firstRows[0]!.id, { flag: 'pick' }, { signal, advance: undefined })).outcome, 'saved'); });
		assert.equal(f.events.filter(value => value.startsWith('save:')).length, 2);
	} finally { await mounted.dispose(); }
});

async function actualFixture(held?: Readonly<{ enter: () => void; wait: Promise<void> }>, ranked = false) {
	const native = mediaRestoreFixture(), seeded = await seedCurrentAppPhoto(native.factory);
	const media = new PhotoMediaStoreV1({ indexedDB: native.factory, locks: null, preferOpfs: false });
	const catalog = new PhotoCatalogRepositoryV2({ indexedDB: native.factory, verifyOriginal: media.verifyOriginal });
	const root = await catalog.loadCatalog(seeded.photo.catalogId); assert.ok(root);
	const photos = Array.from({ length: 79 }, (_, index) => normalizePhotoDocumentV1({ ...seeded.photo, id: `actual-${String(index).padStart(3, '0')}`,
		metadata: { ...seeded.photo.metadata, fileName: `Actual-${index}.png` }, rating: ranked && index < 64 ? 5 : 0 }));
	for (let offset = 0; offset < photos.length; offset += 16) { const current = await catalog.loadCatalog(root.id); assert.ok(current);
		await catalog.publishPhotos(root.id, current.revision, photos.slice(offset, offset + 16)); }
	for (let offset = 0; offset < photos.length; offset += 16) await media.mediaRepository.catalogOriginals.retain(root.id, photos.slice(offset, offset + 16).map(photo => ({ photoId: photo.id, assetId: photo.original.storageKey,
		sourceId: photo.original.id, sha256: photo.original.contentSha256, size: photo.original.byteLength })));
	if (held) { const read = catalog.readCullingDestinationPage; Object.defineProperty(catalog, 'readCullingDestinationPage', { configurable: true,
		value: async (...args: Parameters<typeof read>) => { held.enter(); await held.wait; return Reflect.apply(read, catalog, args); } }); }
	let closed = 0;
	const owner = new PhotoLibrarySessionV2({ catalog, smartCollections: catalog, media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals }, journal: media.settingsRepository,
		initialize: async () => (await catalog.loadCatalog(root.id))!, exclusive: async (_catalogId, consume, signal) => consume(signal),
		async closeResources() { closed++; await Promise.all([catalog.close(), media.close()]); } });
	return { owner, catalog, photos, closed: () => closed };
}

test('actual rating-sorted auto-off edit keeps the selected eligible Photo when it moves before the old window', async () => {
	const f = await actualFixture(undefined, true), mounted = await mount(async () => f.owner);
	const query: PhotoLibraryQueryV1 = Object.freeze({ text: '', filter: null, sort: Object.freeze({ field: 'rating', direction: 'descending' }) });
	try {
		await act(async () => { await mounted.current.applyQuery(query); });
		const cursor = mounted.current.page?.cursor; assert.ok(cursor);
		await act(async () => { await mounted.current.readPage(cursor); });
		assert.equal(mounted.current.page?.rows[0]?.id, 'current-photo');
		await act(async () => { mounted.selection.select('actual-064'); mounted.selection.focus('actual-064'); });
		let receipt: PhotoLibraryCullReceiptV1 | undefined;
		await act(async () => { receipt = await mounted.current.setRating('actual-064', 5, { advance: undefined }); });
		assert.equal(receipt?.outcome, 'saved'); assert.equal(receipt?.outcome === 'saved' ? receipt.notice : undefined, null);
		assert.equal(mounted.current.page?.rows[0]?.id, 'actual-064'); assert.equal(mounted.current.page?.rows[0]?.rating, 5);
		assert.equal(mounted.selection.snapshot.focusedId, 'actual-064'); assert.deepEqual(mounted.selection.snapshot.selectedIds, ['actual-064']);
		assert.equal(receipt?.outcome === 'saved' ? receipt.page : undefined, mounted.current.page); assert.ok(mounted.current.page?.cursor);
		assert.equal((await f.catalog.loadPhoto(f.photos[0]!.catalogId, 'actual-064'))?.revision, 1);
	} finally { await mounted.dispose(); }
});

test('actual saved query retires the old witness when its referenced catalog smart predicate changes across ACK', async () => {
	const f = await actualFixture(), catalogId = f.photos[0]!.catalogId, root = await f.catalog.loadCatalog(catalogId); assert.ok(root);
	await f.catalog.saveCatalog({ ...root, collections: [{ id: 'root-smart', name: 'Root smart', kind: 'smart', query: { kind: 'rating', minimum: 0, maximum: 5 } }] }, root.revision);
	const initial = await f.catalog.readSmartCollectionSnapshotV1(catalogId, null);
	await f.catalog.saveSmartCollection({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId, id: 'saved', revision: 0, name: 'Saved root predicate',
		query: { schemaVersion: 2, kind: 'photo-catalog-query', text: '', filter: { kind: 'collection', id: 'root-smart' },
			sort: { field: 'photo-id', direction: 'ascending' }, predicate: null } }, null, { expectedCatalogRevision: initial.context.catalogRevision,
		expectedIndexRevision: initial.context.indexRevision, expectedStateRevision: initial.context.collectionStateRevision });
	const before = await f.owner.savedCollections.readSnapshot({ collectionId: 'saved' }), write = f.owner.setRating,
		originalNavigation = f.owner.cullingNavigation!, navigation = originalNavigation.readDestinationPage;
	let destinations = 0;
	Object.defineProperty(f.owner, 'cullingNavigation', { value: Object.freeze({ readDestinationPage: async (...args: Parameters<typeof navigation>) => {
		destinations++; return Reflect.apply(navigation, originalNavigation, args); } }) });
	Object.defineProperty(f.owner, 'setRating', { value: async (...args: Parameters<typeof write>) => {
		const updated = await Reflect.apply(write, f.owner, args), current = await f.catalog.loadCatalog(catalogId); assert.ok(current);
		await f.catalog.saveCatalog({ ...current, collections: [{ id: 'root-smart', name: 'Root smart', kind: 'smart', query: { kind: 'rating', minimum: 0, maximum: 4 } }] }, current.revision);
		return updated;
	} });
	const mounted = await mount(async () => f.owner);
	try {
		await act(async () => { await mounted.current.executeSavedFilters(context => context.activate({ kind: 'saved', collectionId: 'saved' }).then(() => undefined)); });
		let receipt: PhotoLibraryCullReceiptV1 | undefined;
		await act(async () => { receipt = await mounted.current.setRating('actual-000', 5, { advance: advance().request }); });
		assert.deepEqual(receipt, { outcome: 'saved', photoId: 'actual-000', page: null, notice: 'refresh-failed' }); assert.equal(destinations, 0);
		const after = await f.owner.savedCollections.readSnapshot({ collectionId: 'saved' });
		assert.deepEqual(after.definition, before.definition); assert.equal(after.context.collectionStateRevision, before.context.collectionStateRevision);
		assert.equal(after.context.catalogRevision, before.context.catalogRevision + 1); assert.equal(mounted.current.page?.rows[0]?.rating, 5);
		assert.equal((await f.catalog.loadPhoto(catalogId, 'actual-000'))?.revision, 1);
	} finally { await mounted.dispose(); }
});

test('already-aborted native options cancel before acquisition and preserve the cull receipt contract', async () => {
	let opens = 0;
	const mounted = await mount(async () => { opens++; throw new Error('Unexpected acquisition.'); }), controller = new AbortController(); controller.abort(Symbol('cancelled'));
	try {
		await act(async () => { assert.deepEqual(await mounted.current.setRating('photo', 2, { signal: controller.signal }), { outcome: 'cancelled' });
			assert.deepEqual(await mounted.current.applyAttributes('photo', { flag: 'pick' }, { signal: controller.signal }), { outcome: 'cancelled' }); });
		assert.equal(opens, 0); assert.equal(mounted.current.busy, false);
	} finally { await mounted.dispose(); }
});

test('actual selected Session edits and freshly pages eighty stored Photos without changing original identity or saved Develop', async () => {
	const f = await actualFixture(), mounted = await mount(async () => f.owner);
	try {
		await act(async () => { await mounted.current.readPage(); });
		assert.equal(mounted.current.page?.rows.length, 64); assert.equal(mounted.current.page?.rows[63]?.id, 'actual-063');
		await act(async () => { await mounted.current.setRating('actual-000', 2); });
		assert.ok(mounted.current.page?.cursor);
		await act(async () => { mounted.selection.select('actual-063'); mounted.selection.focus('actual-063');
			await mounted.selection.cull('actual-063', (signal, advance) => mounted.current.setRating('actual-063', 5, { signal, ...(advance ? { advance } : {}) })); });
		assert.equal(mounted.selection.snapshot.focusedId, 'actual-064'); assert.equal(mounted.current.page?.rows[0]?.id, 'actual-064');
		const edited = await f.catalog.loadPhoto(f.photos[63]!.catalogId, 'actual-063'); assert.ok(edited);
		assert.equal(edited.rating, 5); assert.equal(edited.revision, 1); assert.deepEqual(edited.original, f.photos[63]!.original); assert.deepEqual(edited.versions, f.photos[63]!.versions);
	} finally { await mounted.dispose(); }
});

test('actual Session close joins a held native destination read after ACK and the old page cannot replace a new generation', async () => {
	const entered = deferred<void>(), release = deferred<void>(), f = await actualFixture({ enter: () => entered.resolve(), wait: release.promise });
	const mounted = await mount(async () => f.owner); let work: Promise<PhotoLibraryCullReceiptV1> | undefined, closing: Promise<void> | undefined;
	try {
		await act(async () => { await mounted.current.readPage(); });
		work = (await mounted.start(() => mounted.current.setRating('actual-000', 4))).pending;
		await entered.promise;
		await act(async () => { closing = mounted.current.retireAndJoin(); await settle(); });
		assert.equal(await remainsPending(closing!), true); assert.equal(f.closed(), 0);
		let receipt: PhotoLibraryCullReceiptV1 | undefined;
		await act(async () => { release.resolve(); receipt = await work; await closing; });
		assert.deepEqual(receipt, { outcome: 'saved', photoId: 'actual-000', page: null, notice: 'refresh-failed' }); assert.equal(f.closed(), 1);
	} finally { release.resolve(); await work; await closing; await mounted.dispose(); }
});

test('current page-edge edit captures the next native page before save and publishes the fresh exact destination', async () => {
	const f = await fixture(), mounted = await mount(async () => f.port), witness = advance();
	try {
		await act(async () => { await mounted.current.readPage(); });
		let receipt: PhotoLibraryCullReceiptV1 | undefined;
		await act(async () => { receipt = await mounted.current.setRating(firstRows[63]!.id, 5, { advance: witness.request }); });
		assert.ok(receipt); if (receipt.outcome !== 'saved') assert.fail('Durable edge edit must remain saved.');
		assert.deepEqual(witness.ids, nextRows.map(value => value.id)); assert.equal(receipt.page, f.destination);
		assert.equal(mounted.current.page, f.destination); assert.equal(receipt.notice, null);
		assert.deepEqual(f.events, ['read:first', 'read:old-valid-cursor', 'save:photo-063', 'destination:photo-064']);
	} finally { await mounted.dispose(); }
});

test('manual interaction during held post-ACK navigation keeps the current page and preserves the save ACK', async () => {
	const f = await fixture(), gate = deferred<PhotoLibraryPageV1>(), entered = deferred<void>(); let current = true;
	f.port.cullingNavigation.readDestinationPage = async () => { entered.resolve(); return gate.promise; };
	const mounted = await mount(async () => f.port), witness = advance(() => current); let work: Promise<PhotoLibraryCullReceiptV1> | undefined;
	try {
		await act(async () => { await mounted.current.readPage(); });
		work = (await mounted.start(() => mounted.current.setRating(firstRows[63]!.id, 5, { advance: witness.request }))).pending;
		assert.equal(await remainsPending(work), true); await entered.promise; current = false;
		let receipt: PhotoLibraryCullReceiptV1 | undefined;
		await act(async () => { gate.resolve(f.destination); receipt = await work; });
		assert.deepEqual(receipt, { outcome: 'saved', photoId: firstRows[63]!.id, page: null, notice: 'refresh-failed' });
		assert.deepEqual(mounted.current.page?.rows.map(value => value.id), firstRows.map(value => value.id));
		assert.equal(mounted.current.page?.rows[63]?.rating, 5);
	} finally { gate.resolve(f.destination); await work; await mounted.dispose(); }
});
