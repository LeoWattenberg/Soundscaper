/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode, useMemo } from 'react';
import type { CreatePhotoLibrarySessionV1, PhotoLibraryPageV1, PhotoLibraryQueryV1, PhotoLibraryRowV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import type { PhotoLibraryCullReceiptV1 } from '../src/common/editor/controller/shared/photo-library-culling-v1.ts';
import { usePhotoCompare } from '../src/common/editor/ui/lightscaper/use-photo-compare.ts';
import { usePhotoLibraryWorkflow, type LoadPhotoLibraryBackupSaveRuntimeV1 } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow.ts';
import { createImportTestPort } from './helpers/photo-import-workflow-fixture.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, settle } from './helpers/async-test-control.ts';

const ROWS: readonly PhotoLibraryRowV1[] = Object.freeze(['a', 'b', 'c', 'd'].map(id => Object.freeze({
	id, fileName: `${id}.png`, width: 2, height: 3, rating: 0, flag: 'unflagged', colorLabel: 'none',
})));
const page = (rows = ROWS): PhotoLibraryPageV1 => Object.freeze({ catalogName: 'Library', totalCount: rows.length, rows, cursor: null });
const query: PhotoLibraryQueryV1 = Object.freeze({ text: '', filter: null, sort: Object.freeze({ field: 'rating', direction: 'descending' }) });
function row(id: string) { const found = ROWS.find(value => value.id === id); assert.ok(found); return found; }

test('Compare stays inert, borrows one existing library session and captures ordered selection at the menu gesture', async () => {
	const port = createImportTestPort(); let opens = 0, reads = 0, saves = 0;
	port.readPage = async () => { reads++; return page(); };
	port.setRating = async (id, rating) => { saves++; return { ...row(id), rating }; };
	const mounted = await mount(async () => { opens++; return port; });
	try {
		assert.equal(opens, 0); assert.equal(mounted.compare.visible, false);
		await act(async () => { await mounted.library.readPage(); });
		await act(async () => { mounted.compare.open(['d', 'b', 'a']); });
		assert.equal(opens, 1); assert.equal(reads, 1); assert.equal(mounted.compare.visible, true);
		assert.deepEqual(mounted.compare.snapshot.photoIds, ['a', 'b', 'd']);
		await act(async () => { mounted.compare.next(); mounted.compare.swap(); mounted.compare.promote(); });
		assert.equal(saves, 0); assert.equal(reads, 1); assert.equal(opens, 1);
		await act(async () => { await mounted.compare.rate('a', 4); });
		assert.equal(saves, 1); assert.equal(opens, 1); assert.equal(mounted.library.page?.rows[0]?.rating, 4);
	} finally { await mounted.dispose(); }
});

test('an actual early workflow page stays behind the cull barrier and its exact receipt reconciles the captured subset', async () => {
	const port = createImportTestPort(), afterSave = deferred<void>(); let saves = 0;
	port.readPage = async () => page(); port.setRating = async (id, rating) => { saves++; return { ...row(id), rating }; };
	const mounted = await mount(async () => port, { afterSave: afterSave.promise }); let pending: Promise<PhotoLibraryCullReceiptV1> | undefined;
	try {
		await act(async () => { await mounted.library.readPage(); });
		await act(async () => { mounted.compare.open(['a', 'b', 'c']); });
		const before = mounted.library.page;
		await act(async () => { pending = mounted.compare.rate('b', 5); await settle(); });
		assert.notEqual(mounted.library.page, before); assert.equal(mounted.library.page?.rows[1]?.rating, 5);
		assert.equal(mounted.compare.visible, true); assert.equal(mounted.compare.snapshot.pendingPhotoId, 'b');
		await act(async () => { assert.deepEqual(await mounted.compare.flag('a', 'pick'), { outcome: 'busy' }); });
		await act(async () => { afterSave.resolve(); assert.equal((await pending)?.outcome, 'saved'); });
		assert.equal(mounted.compare.snapshot.referenceId, 'a'); assert.equal(mounted.compare.snapshot.candidateId, 'b');
		assert.deepEqual(mounted.compare.snapshot.photoIds, ['a', 'b', 'c']); assert.equal(mounted.compare.visible, true); assert.equal(saves, 1);
	} finally { afterSave.resolve(); await pending; await mounted.dispose(); }
});

test('query culling follows captured successor identity without selecting new rows from the refreshed page', async () => {
	const port = createImportTestPort(); let saved = false;
	port.readQueryStep = async () => ({ ...page(saved ? [row('d'), row('a'), row('c')] : ROWS), scanned: 4 });
	port.setRating = async (id, rating) => { saved = true; return { ...row(id), rating }; };
	const mounted = await mount(async () => port, { autoAdvance: true });
	try {
		await act(async () => { await mounted.library.applyQuery(query); });
		await act(async () => { mounted.compare.open(['a', 'b', 'c']); await mounted.compare.rate('b', 5); });
		assert.deepEqual(mounted.compare.snapshot.photoIds, ['a', 'c']);
		assert.equal(mounted.compare.snapshot.referenceId, 'a'); assert.equal(mounted.compare.snapshot.candidateId, 'c');
		assert.deepEqual(mounted.library.page?.rows.map(value => value.id), ['d', 'a', 'c']);
		assert.deepEqual(mounted.library.query, query); assert.equal(mounted.compare.visible, true);
	} finally { await mounted.dispose(); }
});

test('a saved edit with failed query refresh keeps an explicit acknowledgement and a paused Compare surface', async () => {
	const port = createImportTestPort(); let reads = 0, durable = 0;
	port.readQueryStep = async () => { if (++reads > 1) throw new Error('Query refresh unavailable'); return { ...page(), scanned: 4 }; };
	port.setRating = async (id, rating) => { durable = rating; return { ...row(id), rating }; };
	const mounted = await mount(async () => port, { autoAdvance: true });
	try {
		await act(async () => { await mounted.library.applyQuery(query); });
		await act(async () => { mounted.compare.open(['a', 'b', 'c']); });
		await act(async () => { assert.deepEqual(await mounted.compare.rate('b', 4), { outcome: 'saved', photoId: 'b', page: null, notice: 'refresh-failed' }); });
		assert.equal(durable, 4); assert.equal(mounted.library.page?.rows[1]?.rating, 4);
		assert.equal(mounted.compare.notice, 'refresh-failed'); assert.equal(mounted.compare.visible, true);
		assert.equal(mounted.compare.snapshot.candidateId, null, 'no exact receipt page grants fallback row authority');
		assert.equal(mounted.library.error, 'Query refresh unavailable');
		await act(async () => { await mounted.compare.close(); }); assert.equal(mounted.compare.visible, false);
	} finally { await mounted.dispose(); }
});

test('replacing a query with the same IDs retires its previous Compare gesture and stale callbacks', async () => {
	const port = createImportTestPort(); let saves = 0;
	port.readQueryStep = async () => ({ ...page(), scanned: 4 });
	port.setRating = async (id, rating) => { saves++; return { ...row(id), rating }; };
	const mounted = await mount(async () => port);
	try {
		await act(async () => { await mounted.library.applyQuery(query); });
		await act(async () => { mounted.compare.open(['a', 'b']); }); const stale = mounted.compare.rate;
		await act(async () => { await mounted.library.applyQuery({ ...query, text: 'new' }); });
		assert.equal(mounted.compare.visible, false); assert.equal(mounted.compare.snapshot.open, false);
		await act(async () => { assert.deepEqual(await stale('b', 5), { outcome: 'cancelled' }); }); assert.equal(saves, 0);
	} finally { await mounted.dispose(); }
});

test('Close cancels borrowed native work, blocks reopen until settlement and preserves a late durable ACK', async () => {
	const port = createImportTestPort(), saved = deferred<PhotoLibraryRowV1>(), entered = deferred<void>(); let signal: AbortSignal | undefined;
	port.readPage = async () => page(); port.setRating = async (_id, _rating, options) => { signal = options?.signal; entered.resolve(); return saved.promise; };
	const mounted = await mount(async () => port); let pending: Promise<PhotoLibraryCullReceiptV1> | undefined, closing: Promise<void> | undefined;
	try {
		await act(async () => { await mounted.library.readPage(); }); await act(async () => { mounted.compare.open(['a', 'b']); });
		await act(async () => { pending = mounted.compare.rate('b', 3); await entered.promise; });
		await act(async () => { closing = mounted.compare.close(); await settle(); });
		assert.equal(signal?.aborted, true); assert.equal(mounted.compare.visible, false); assert.equal(mounted.library.busy, true);
		await act(async () => { mounted.compare.open(['a', 'b']); }); assert.equal(mounted.compare.visible, false);
		await act(async () => { saved.resolve({ ...row('b'), rating: 3 }); assert.equal((await pending)?.outcome, 'saved'); await closing; });
		assert.equal(mounted.compare.visible, false); assert.equal(mounted.library.page?.rows[1]?.rating, 3);
		await act(async () => { mounted.compare.open(['a', 'b']); }); assert.equal(mounted.compare.visible, true);
	} finally { saved.resolve(row('b')); await pending; await closing; await mounted.dispose(); }
});

for (const retire of ['hide', 'replaceLoader'] as const) test(`${retire} retires a held cull and cannot republish its late saved notice`, async () => {
	const port = createImportTestPort(), saved = deferred<PhotoLibraryRowV1>(), entered = deferred<void>();
	port.readPage = async () => page(); port.setRating = async () => { entered.resolve(); return saved.promise; };
	const mounted = await mount(async () => port); let pending: Promise<PhotoLibraryCullReceiptV1> | undefined;
	try {
		await act(async () => { await mounted.library.readPage(); }); await act(async () => { mounted.compare.open(['a', 'b']); });
		await act(async () => { pending = mounted.compare.rate('b', 5); await entered.promise; });
		await act(async () => { await mounted[retire](); }); assert.equal(mounted.compare.visible, false);
		await act(async () => { saved.resolve({ ...row('b'), rating: 5 }); assert.equal((await pending)?.outcome, 'saved'); });
		assert.equal(mounted.compare.visible, false); assert.equal(mounted.compare.notice, null); assert.equal(mounted.compare.snapshot.open, false);
	} finally { saved.resolve(row('b')); await pending; await mounted.dispose(); }
});

test('a retired preview callback cannot borrow the replacement session after same-factory loader replacement', async () => {
	const first = createImportTestPort(), next = createImportTestPort(); let opens = 0, previews = 0;
	first.readPage = next.readPage = async () => page();
	first.readPreview = next.readPreview = async () => { previews++; return { outcome: 'missing' }; };
	const mounted = await mount(async () => ++opens === 1 ? first : next);
	try {
		await act(async () => { await mounted.library.readPage(); }); const stale = mounted.library.readPreview;
		await mounted.replaceLoader(); await act(async () => { await mounted.library.readPage(); }); assert.equal(opens, 2);
		await assert.rejects(stale('a', 'thumbnail'), /generation is closed/u); assert.equal(previews, 0);
		assert.deepEqual(await mounted.library.readPreview('a', 'thumbnail'), { outcome: 'missing' }); assert.equal(previews, 1);
	} finally { await mounted.dispose(); }
});

async function mount(initialFactory: CreatePhotoLibrarySessionV1, options: Readonly<{ autoAdvance?: boolean; afterSave?: Promise<void> }> = {}) {
	const factory = initialFactory; let enabled = true, loader: LoadPhotoLibraryBackupSaveRuntimeV1 | undefined;
	let library: ReturnType<typeof usePhotoLibraryWorkflow> | undefined, compare: ReturnType<typeof usePhotoCompare> | undefined;
	function Harness() {
		const activeFactory = factory, activeLoader = loader;
		library = usePhotoLibraryWorkflow(activeFactory, activeLoader);
		const active = library;
		const generation = useMemo(() => Object.freeze({ factory: activeFactory, loader: activeLoader }), [activeFactory, activeLoader]);
		compare = usePhotoCompare({ generation, page: active.page, queryIdentity: active.query, enabled,
			busy: active.busy, autoAdvance: options.autoAdvance ?? false,
			setRating: async (...args) => { const receipt = await active.setRating(...args); await options.afterSave; return receipt; },
			applyAttributes: active.applyAttributes });
		return null;
	}
	const mounted = await mountPhotoImportUi(() => <StrictMode><Harness /></StrictMode>);
	return { ...mounted, get library() { assert.ok(library); return library; }, get compare() { assert.ok(compare); return compare; },
		hide: async () => { enabled = false; await mounted.render(); },
		replaceLoader: async () => { loader = async () => { throw new Error('Unexpected backup runtime load'); }; await mounted.render(); },
	};
}
