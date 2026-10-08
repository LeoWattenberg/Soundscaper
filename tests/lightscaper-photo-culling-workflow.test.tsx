/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import { usePhotoLibraryWorkflow } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow.ts';
import type { PhotoLibraryCullReceiptV1 } from '../src/common/editor/controller/shared/photo-library-culling-v1.ts';
import type { CreatePhotoLibrarySessionV1, PhotoLibraryPageV1, PhotoLibraryQueryV1, PhotoLibraryRowV1,
	PhotoLibrarySessionPortV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { deferred } from './helpers/async-test-control.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

const ROW: Readonly<PhotoLibraryRowV1> = Object.freeze({ id: 'photo-a', fileName: 'A.png', width: 1, height: 1,
	rating: 0, flag: 'unflagged', colorLabel: 'none' });
const QUERY: Readonly<PhotoLibraryQueryV1> = Object.freeze({ text: '', filter: null,
	sort: Object.freeze({ field: 'rating', direction: 'descending' }) });
const page = (catalogName = 'Library'): Readonly<PhotoLibraryPageV1> => Object.freeze({ catalogName, totalCount: 1,
	rows: Object.freeze([ROW]), cursor: 'old-continuation' });

test('rating receipts identify the exact published page after acknowledgement and invalidate the old cursor', async () => {
	const session = owner(), mounted = await mount(async () => session.port); let saves = 0;
	session.port.setRating = async (id, rating) => { saves++; assert.equal(id, ROW.id); return Object.freeze({ ...ROW, rating }); };
	try {
		await act(async () => { await mounted.current.readPage(); }); const before = mounted.current.page;
		let receipt: PhotoLibraryCullReceiptV1 | undefined;
		await act(async () => { receipt = await mounted.current.setRating(ROW.id, 5); });
		assert.ok(receipt); assert.equal(receipt.outcome, 'saved');
		if (receipt.outcome !== 'saved') assert.fail('Acknowledged rating must return a saved receipt.');
		assert.equal(receipt.photoId, ROW.id); assert.equal(receipt.page, mounted.current.page); assert.notEqual(receipt.page, before);
		assert.equal(receipt.notice, null); assert.equal(receipt.page?.rows[0]?.rating, 5); assert.equal(receipt.page?.cursor, null);
		assert.equal(saves, 1); assert.equal(mounted.current.busy, false);
	} finally { await mounted.dispose(); }
});

test('attribute receipts preserve the same durable photo identity and publish the exact acknowledged page', async () => {
	const session = owner(), mounted = await mount(async () => session.port);
	session.port.applyAttributes = async (id, changes) => { assert.equal(id, ROW.id); return Object.freeze({ ...ROW, ...changes }); };
	try {
		let receipt: PhotoLibraryCullReceiptV1 | undefined;
		await act(async () => { await mounted.current.readPage(); receipt = await mounted.current.applyAttributes(ROW.id, { flag: 'pick', colorLabel: 'green' }); });
		assert.ok(receipt); if (receipt.outcome !== 'saved') assert.fail('Acknowledged attributes must return saved.');
		assert.equal(receipt.page, mounted.current.page); assert.equal(receipt.photoId, ROW.id);
		assert.deepEqual(receipt.page?.rows[0], { ...ROW, flag: 'pick', colorLabel: 'green' }); assert.equal(receipt.page?.cursor, null);
	} finally { await mounted.dispose(); }
});

test('a saved active-query receipt uses the projected scalar page and exact globally reordered publication', async () => {
	const session = owner(), mounted = await mount(async () => session.port); let savedRating = 0;
	const second = Object.freeze({ ...ROW, id: 'photo-b', fileName: 'B.png', rating: 3 });
	session.port.setRating = async (_id, rating) => { savedRating = rating; return Object.freeze({ ...ROW, rating }); };
	session.port.readQueryStep = async () => Object.freeze({ ...page(), totalCount: 2, scanned: 2,
		rows: Object.freeze(savedRating === 0 ? [second, ROW] : [{ ...ROW, rating: savedRating }, second]) });
	try {
		let receipt: PhotoLibraryCullReceiptV1 | undefined;
		await act(async () => { await mounted.current.applyQuery(QUERY); receipt = await mounted.current.setRating(ROW.id, 5); });
		assert.ok(receipt); if (receipt.outcome !== 'saved') assert.fail('The query refresh must retain a saved receipt.');
		assert.equal(receipt.page, mounted.current.page); assert.deepEqual(receipt.page?.rows.map(row => row.id), [ROW.id, second.id]);
		assert.deepEqual(Object.keys(receipt.page!).sort(), ['catalogName', 'cursor', 'rows', 'totalCount']);
		assert.deepEqual(mounted.current.query, QUERY);
	} finally { await mounted.dispose(); }
});

test('refresh failure after a durable active-query save returns saved and preserves its fallback row without a cursor', async () => {
	const session = owner(), mounted = await mount(async () => session.port); let reads = 0, durableRating = 0;
	session.port.readQueryStep = async () => {
		if (++reads > 1) throw new Error('Query storage unavailable after save');
		return Object.freeze({ ...page(), scanned: 1 });
	};
	session.port.setRating = async (_id, rating) => { durableRating = rating; return Object.freeze({ ...ROW, rating }); };
	try {
		let receipt: PhotoLibraryCullReceiptV1 | undefined;
		await act(async () => { await mounted.current.applyQuery(QUERY); receipt = await mounted.current.setRating(ROW.id, 4); });
		assert.deepEqual(receipt, { outcome: 'saved', photoId: ROW.id, page: null, notice: 'refresh-failed' });
		assert.equal(durableRating, 4); assert.equal(mounted.current.page?.rows[0]?.rating, 4); assert.equal(mounted.current.page?.cursor, null);
		assert.equal(mounted.current.error, 'Query storage unavailable after save'); assert.deepEqual(mounted.current.query, QUERY);
	} finally { await mounted.dispose(); }
});

test('save refusal before acknowledgement returns failed and leaves the displayed page unchanged', async () => {
	const session = owner(), mounted = await mount(async () => session.port);
	session.port.setRating = async () => { throw new Error('Photo revision conflict'); };
	try {
		await act(async () => { await mounted.current.readPage(); }); const before = mounted.current.page;
		let receipt: PhotoLibraryCullReceiptV1 | undefined;
		await act(async () => { receipt = await mounted.current.setRating(ROW.id, 5); });
		assert.deepEqual(receipt, { outcome: 'failed' }); assert.equal(mounted.current.page, before);
		assert.equal(mounted.current.page?.rows[0]?.rating, 0); assert.equal(mounted.current.error, 'Photo revision conflict');
	} finally { await mounted.dispose(); }
});

test('external cancellation before acknowledgement reaches the save port and returns cancelled without publishing', async () => {
	const session = owner(), mounted = await mount(async () => session.port), external = new AbortController();
	const result = deferred<PhotoLibraryRowV1>(), entered = deferred<void>(); let observed: AbortSignal | undefined;
	session.port.setRating = async (_id, _rating, options) => { observed = options?.signal; entered.resolve(); return result.promise; };
	let work: Promise<PhotoLibraryCullReceiptV1> | undefined;
	try {
		await act(async () => { await mounted.current.readPage(); }); const before = mounted.current.page;
		work = (await mounted.start(() => mounted.current.setRating(ROW.id, 5, { signal: external.signal }))).pending; await entered.promise;
		let receipt: PhotoLibraryCullReceiptV1 | undefined;
		await act(async () => { external.abort(); result.reject(new DOMException('Cancelled before save', 'AbortError')); receipt = await work; });
		assert.equal(observed?.aborted, true); assert.deepEqual(receipt, { outcome: 'cancelled' });
		assert.equal(mounted.current.page, before); assert.equal(mounted.current.error, null);
	} finally { result.resolve(ROW); await work; await mounted.dispose(); }
});

test('external cancellation after durable acknowledgement cannot relabel the completed save as cancelled', async () => {
	const session = owner(), mounted = await mount(async () => session.port), external = new AbortController(); let durableRating = 0;
	session.port.setRating = async (_id, rating) => { durableRating = rating; external.abort(); return Object.freeze({ ...ROW, rating }); };
	try {
		let receipt: PhotoLibraryCullReceiptV1 | undefined;
		await act(async () => { await mounted.current.readPage(); receipt = await mounted.current.setRating(ROW.id, 5, { signal: external.signal }); });
		assert.ok(receipt); assert.equal(durableRating, 5); assert.equal(receipt.outcome, 'saved');
		if (receipt.outcome !== 'saved') assert.fail('The durable acknowledgement remains saved.');
		assert.equal(receipt.photoId, ROW.id); assert.equal(mounted.current.page?.rows[0]?.rating, 5);
		if (receipt.page !== null) assert.equal(receipt.page, mounted.current.page);
		else assert.equal(receipt.notice, 'refresh-failed');
	} finally { await mounted.dispose(); }
});

test('a second foreground cull returns busy immediately and is never queued behind an admitted save', async () => {
	const session = owner(), mounted = await mount(async () => session.port), result = deferred<PhotoLibraryRowV1>(), entered = deferred<void>();
	let saves = 0, work: Promise<PhotoLibraryCullReceiptV1> | undefined;
	session.port.setRating = async () => { saves++; entered.resolve(); return result.promise; };
	try {
		await act(async () => { await mounted.current.readPage(); });
		work = (await mounted.start(() => mounted.current.setRating(ROW.id, 4))).pending; await entered.promise;
		await act(async () => { assert.deepEqual(await mounted.current.applyAttributes(ROW.id, { flag: 'reject' }), { outcome: 'busy' }); });
		let receipt: PhotoLibraryCullReceiptV1 | undefined;
		await act(async () => { result.resolve({ ...ROW, rating: 4 }); receipt = await work; });
		assert.equal(receipt?.outcome, 'saved'); assert.equal(saves, 1); assert.equal(mounted.current.page?.rows[0]?.flag, 'unflagged');
	} finally { result.resolve(ROW); await work; await mounted.dispose(); }
});

test('a retired generation acknowledges a late durable save without replacing the new library page', async () => {
	const first = owner('First'), replacement = owner('Replacement'), result = deferred<PhotoLibraryRowV1>(), entered = deferred<void>();
	const mounted = await mount(async () => first.port); let work: Promise<PhotoLibraryCullReceiptV1> | undefined, observed: AbortSignal | undefined;
	first.port.setRating = async (_id, _rating, options) => { observed = options?.signal; entered.resolve(); return result.promise; };
	try {
		await act(async () => { await mounted.current.readPage(); });
		work = (await mounted.start(() => mounted.current.setRating(ROW.id, 5))).pending; await entered.promise;
		await mounted.render(async () => replacement.port); assert.equal(observed?.aborted, true);
		await act(async () => { await mounted.current.readPage(); }); const replacementPage = mounted.current.page;
		let receipt: PhotoLibraryCullReceiptV1 | undefined;
		await act(async () => { result.resolve({ ...ROW, rating: 5 }); receipt = await work; });
		assert.deepEqual(receipt, { outcome: 'saved', photoId: ROW.id, page: null, notice: 'refresh-failed' });
		assert.equal(mounted.current.page, replacementPage); assert.equal(mounted.current.page?.catalogName, 'Replacement');
		assert.equal(mounted.current.page?.rows[0]?.rating, 0); assert.equal(first.closes(), 1);
	} finally { result.resolve(ROW); await work; await mounted.dispose(); }
});

function owner(catalogName = 'Library') {
	let closes = 0;
	const port: PhotoLibrarySessionPortV1 = {
		readPage: async () => page(catalogName),
		readQueryStep: async () => Object.freeze({ ...page(catalogName), scanned: 1 }),
		rebuildQueryStep: async () => Object.freeze({ processed: 0, readBytes: 0, ready: true }),
		readDefinitionPage: async () => Object.freeze({ rootRevision: 0, rows: [], parent: null, selected: null, cursor: null }),
		readPreview: async () => Object.freeze({ outcome: 'missing' }), importFiles: async () => Object.freeze([]),
		setRating: async (_id, rating) => Object.freeze({ ...ROW, rating }),
		applyAttributes: async (_id, changes) => Object.freeze({ ...ROW, ...changes }),
		readMetadata: async () => { throw new Error('Unexpected metadata read in scalar culling test'); },
		applyMetadata: async () => { throw new Error('Unexpected metadata write in scalar culling test'); },
		close: async () => { closes++; },
	};
	return { port, closes: () => closes };
}

async function mount(initialFactory: CreatePhotoLibrarySessionV1) {
	const dom = installReactTestDom(), global = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }, prior = global.IS_REACT_ACT_ENVIRONMENT;
	global.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client'), root = createRoot(dom.container as unknown as Element);
	let state: ReturnType<typeof usePhotoLibraryWorkflow> | null = null, unmounted = false;
	function Harness({ factory }: Readonly<{ factory: CreatePhotoLibrarySessionV1 }>) { state = usePhotoLibraryWorkflow(factory); return null; }
	const render = async (factory = initialFactory) => { await act(async () => { root.render(<StrictMode><Harness factory={factory} /></StrictMode>); }); };
	const unmount = async () => { if (unmounted) return; unmounted = true; await act(async () => { root.unmount(); }); };
	await render();
	return { render,
		get current() { if (!state) throw new Error('Culling workflow hook did not mount.'); return state; },
		async start(action: () => Promise<PhotoLibraryCullReceiptV1>) {
			let work: Promise<PhotoLibraryCullReceiptV1> | undefined;
			await act(async () => { work = action(); await Promise.resolve(); });
			if (!work) throw new Error('Culling action did not start.'); return { pending: work };
		},
		async dispose() { try { await unmount(); } finally { dom.restore(); global.IS_REACT_ACT_ENVIRONMENT = prior; } },
	};
}
