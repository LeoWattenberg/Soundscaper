/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode, useMemo } from 'react';
import type { CreatePhotoLibrarySessionV1, PhotoLibraryPageV1, PhotoLibraryQueryV1, PhotoLibraryRowV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import type { PhotoLibraryCullReceiptV1 } from '../src/common/editor/controller/shared/photo-library-culling-v1.ts';
import { usePhotoSurvey } from '../src/common/editor/ui/lightscaper/use-photo-survey.ts';
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

test('Survey is inert until requested and temporary removal never writes or changes the library selection page', async () => {
	const port = createImportTestPort(); let opens = 0, saves = 0;
	port.readPage = async () => page(); port.setRating = async (id, rating) => { saves++; return { ...row(id), rating }; };
	const mounted = await mount(async () => { opens++; return port; });
	try {
		assert.equal(opens, 0); assert.equal(mounted.survey.visible, false);
		await act(async () => { await mounted.library.readPage(); });
		await act(async () => { mounted.survey.open(['d', 'b', 'a']); });
		assert.equal(opens, 1); assert.equal(mounted.survey.visible, true);
		assert.deepEqual(mounted.survey.snapshot.photoIds, ['a', 'b', 'd']);
		await act(async () => { mounted.survey.remove('b'); mounted.survey.remove('a'); });
		assert.deepEqual(mounted.survey.snapshot.photoIds, ['d']); assert.equal(mounted.survey.visible, true);
		await act(async () => { mounted.survey.remove('d'); });
		assert.deepEqual(mounted.survey.snapshot.photoIds, []); assert.equal(mounted.survey.visible, true);
		assert.deepEqual(mounted.library.page?.rows, ROWS); assert.equal(saves, 0);
		await act(async () => { mounted.survey.restoreRemoved(); mounted.survey.focus('b'); await mounted.survey.rate('b', 4); });
		assert.deepEqual(mounted.survey.snapshot.photoIds, ['a', 'b', 'd']); assert.equal(saves, 1); assert.equal(opens, 1);
		assert.equal(mounted.library.page?.rows[1]?.rating, 4);
	} finally { await mounted.dispose(); }
});

test('an actual page-before-ACK joins one save while retaining locally removed captured photos', async () => {
	const port = createImportTestPort(), afterSave = deferred<void>(); let saves = 0;
	port.readPage = async () => page(); port.setRating = async (id, rating) => { saves++; return { ...row(id), rating }; };
	const mounted = await mount(async () => port, { afterSave: afterSave.promise }); let pending: Promise<PhotoLibraryCullReceiptV1> | undefined;
	try {
		await act(async () => { await mounted.library.readPage(); });
		await act(async () => { mounted.survey.open(['a', 'b', 'c']); mounted.survey.remove('a'); mounted.survey.focus('b'); });
		const before = mounted.library.page;
		await act(async () => { pending = mounted.survey.rate('b', 5); await settle(); });
		assert.notEqual(mounted.library.page, before); assert.equal(mounted.library.page?.rows[1]?.rating, 5);
		assert.equal(mounted.survey.visible, true); assert.equal(mounted.survey.snapshot.pendingPhotoId, 'b');
		await act(async () => { assert.deepEqual(await mounted.survey.flag('c', 'pick'), { outcome: 'busy' }); });
		await act(async () => { afterSave.resolve(); assert.equal((await pending)?.outcome, 'saved'); });
		assert.deepEqual(mounted.survey.snapshot.photoIds, ['b', 'c']); assert.deepEqual(mounted.survey.snapshot.removedPhotoIds, ['a']);
		assert.equal(mounted.survey.snapshot.focusedPhotoId, 'b'); assert.equal(saves, 1);
	} finally { afterSave.resolve(); await pending; await mounted.dispose(); }
});

test('query culling admits only captured survivors and never restores newly matching photos', async () => {
	const port = createImportTestPort(); let saved = false;
	port.readQueryStep = async () => ({ ...page(saved ? [row('d'), row('a'), row('c')] : ROWS), scanned: 4 });
	port.setRating = async (id, rating) => { saved = true; return { ...row(id), rating }; };
	const mounted = await mount(async () => port, { autoAdvance: true });
	try {
		await act(async () => { await mounted.library.applyQuery(query); });
		await act(async () => { mounted.survey.open(['a', 'b', 'c']); mounted.survey.remove('a'); mounted.survey.focus('b'); await mounted.survey.rate('b', 5); });
		assert.deepEqual(mounted.survey.snapshot.photoIds, ['c']); assert.equal(mounted.survey.snapshot.focusedPhotoId, 'c');
		await act(async () => { mounted.survey.restoreRemoved(); });
		assert.deepEqual(mounted.survey.snapshot.photoIds, ['a', 'c']); assert.equal(mounted.survey.visible, true);
		assert.deepEqual(mounted.library.page?.rows.map(value => value.id), ['d', 'a', 'c']);
	} finally { await mounted.dispose(); }
});

test('a saved edit with failed query refresh leaves a visible paused acknowledgement', async () => {
	const port = createImportTestPort(); let reads = 0, durable = 0;
	port.readQueryStep = async () => { if (++reads > 1) throw new Error('Query refresh unavailable'); return { ...page(), scanned: 4 }; };
	port.setRating = async (id, rating) => { durable = rating; return { ...row(id), rating }; };
	const mounted = await mount(async () => port, { autoAdvance: true });
	try {
		await act(async () => { await mounted.library.applyQuery(query); });
		await act(async () => { mounted.survey.open(['a', 'b', 'c']); });
		await act(async () => { assert.deepEqual(await mounted.survey.rate('b', 4), { outcome: 'saved', photoId: 'b', page: null, notice: 'refresh-failed' }); });
		assert.equal(durable, 4); assert.equal(mounted.survey.notice, 'refresh-failed'); assert.equal(mounted.survey.visible, true);
		assert.equal(mounted.survey.snapshot.focusedPhotoId, null); assert.deepEqual(mounted.survey.snapshot.photoIds, []);
		await act(async () => { await mounted.survey.close(); }); assert.equal(mounted.survey.visible, false);
	} finally { await mounted.dispose(); }
});

for (const retire of ['hide', 'replaceLoader', 'replaceQuery'] as const) test(`${retire} fences stale Survey edits and a held late ACK`, async () => {
	const port = createImportTestPort(), saved = deferred<PhotoLibraryRowV1>(), entered = deferred<void>(); let writes = 0;
	port.readPage = async () => page(); port.readQueryStep = async () => ({ ...page(), scanned: 4 });
	port.setRating = async () => { writes++; entered.resolve(); return saved.promise; };
	const mounted = await mount(async () => port); let pending: Promise<PhotoLibraryCullReceiptV1> | undefined;
	try {
		await act(async () => { await mounted.library.readPage(); }); await act(async () => { mounted.survey.open(['a', 'b', 'c']); });
		const stale = mounted.survey.rate;
		await act(async () => { pending = mounted.survey.rate('b', 5); await entered.promise; });
		await act(async () => { await mounted[retire](); }); assert.equal(mounted.survey.visible, false);
		await act(async () => { saved.resolve({ ...row('b'), rating: 5 }); assert.equal((await pending)?.outcome, 'saved'); });
		await act(async () => { assert.deepEqual(await stale('b', 4), { outcome: 'cancelled' }); });
		assert.equal(mounted.survey.visible, false); assert.equal(mounted.survey.notice, null); assert.equal(writes, 1);
	} finally { saved.resolve(row('b')); await pending; await mounted.dispose(); }
});

async function mount(initialFactory: CreatePhotoLibrarySessionV1, options: Readonly<{ autoAdvance?: boolean; afterSave?: Promise<void> }> = {}) {
	let enabled = true, queryIdentity: unknown = null, loader: LoadPhotoLibraryBackupSaveRuntimeV1 | undefined;
	let library: ReturnType<typeof usePhotoLibraryWorkflow> | undefined, survey: ReturnType<typeof usePhotoSurvey> | undefined;
	function Harness({ activeLoader }: Readonly<{ activeLoader: LoadPhotoLibraryBackupSaveRuntimeV1 | undefined }>) {
		library = usePhotoLibraryWorkflow(initialFactory, activeLoader);
		const active = library;
		const generation = useMemo(() => Object.freeze({ factory: initialFactory, loader: activeLoader }), [activeLoader]);
		survey = usePhotoSurvey({ generation, page: active.page, queryIdentity: queryIdentity ?? active.query, enabled,
			busy: active.busy, autoAdvance: options.autoAdvance ?? false,
			setRating: async (...args) => { const receipt = await active.setRating(...args); await options.afterSave; return receipt; },
			applyAttributes: active.applyAttributes });
		return null;
	}
	const mounted = await mountPhotoImportUi(() => <StrictMode><Harness activeLoader={loader} /></StrictMode>);
	return { ...mounted, get library() { assert.ok(library); return library; }, get survey() { assert.ok(survey); return survey; },
		hide: async () => { enabled = false; await mounted.render(); },
		replaceLoader: async () => { loader = async () => { throw new Error('Unexpected backup runtime load'); }; await mounted.render(); },
		replaceQuery: async () => { queryIdentity = {}; await mounted.render(); },
	};
}
