/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import type { PhotoLibraryPageV1, PhotoLibraryQueryV1, PhotoLibraryQueryStepV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import { DEFAULT_PHOTO_LIBRARY_QUERY_V2 } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow.ts';
import { createImportTestPort, mountImportWorkflow } from './helpers/photo-import-workflow-fixture.tsx';
import { deferred, settle } from './helpers/async-test-control.ts';

const rows = ['a', 'b', 'c'].map(id => ({ id, fileName: `${id}.png`, width: 2, height: 3, rating: 0, flag: 'unflagged' as const, colorLabel: 'none' as const }));
const page = (count = 3, cursor: string | null = null): PhotoLibraryPageV1 => ({ catalogName: 'Library', totalCount: 3, rows: rows.slice(0, count), cursor });
const query: PhotoLibraryQueryV1 = { text: 'sunrise', filter: { kind: 'rating', value: 3 }, sort: { field: 'file-name', direction: 'descending' } };

test('collapse is opt-in, drains only empty steps, and resumes the exact global cursor without page-local dedupe', async () => {
	const owner = createImportTestPort(); let ordinary = 0; const calls: unknown[] = [];
	owner.readPage = async () => { ordinary++; return page(); };
	owner.readStackQueryStep = async request => { calls.push({ query: request.query, cursor: request.cursor });
		return request.cursor === null ? { ...page(0, 'probe-member-64'), scanned: 64 } : { ...page(2, 'global-next'), scanned: 64 }; };
	const mounted = await mountImportWorkflow(async () => owner);
	try {
		assert.equal(mounted.current.stackCollapsed, false); assert.equal(calls.length, 0);
		await act(async () => { await mounted.current.readPage(); }); const before = mounted.current.page;
		await act(async () => { await mounted.current.setStackCollapsed(true); });
		assert.equal(mounted.current.stackCollapsed, true); assert.equal(mounted.current.page?.rows.length, 2);
		assert.notEqual(mounted.current.page, before); assert.equal(calls.length, 2);
		assert.deepEqual(calls, [{ query: DEFAULT_PHOTO_LIBRARY_QUERY_V2, cursor: null }, { query: DEFAULT_PHOTO_LIBRARY_QUERY_V2, cursor: 'probe-member-64' }]);
		await act(async () => { await mounted.current.readPage('global-next'); }); assert.equal(calls.length, 3);
		assert.equal(mounted.current.page?.rows.length, 2); assert.equal(ordinary, 1);
		await act(async () => { await mounted.current.setStackCollapsed(false); });
		assert.equal(mounted.current.stackCollapsed, false); assert.equal(mounted.current.query, null); assert.equal(mounted.current.page?.rows.length, 3); assert.equal(ordinary, 2);
	} finally { await mounted.dispose(); }
});

test('current text/filter/global sort stay unchanged across collapse, apply, saved edits and expansion', async () => {
	const owner = createImportTestPort(), seen: PhotoLibraryQueryV1[] = []; let expanded = 0;
	owner.readQueryStep = async request => { expanded++; assert.equal(request.query, query); return { ...page(), scanned: 3 }; };
	owner.readStackQueryStep = async request => { seen.push(request.query); return { ...page(1), scanned: 3 }; };
	owner.setRating = async (_id, rating) => ({ ...rows[0]!, rating });
	const mounted = await mountImportWorkflow(async () => owner);
	try {
		await act(async () => { await mounted.current.applyQuery(query); await mounted.current.setStackCollapsed(true); });
		assert.equal(mounted.current.query, query); assert.equal(mounted.current.page?.rows.length, 1);
		await act(async () => { assert.equal((await mounted.current.setRating('a', 5)).outcome, 'saved'); });
		await act(async () => { await mounted.current.applyQuery(query); }); assert.equal(seen.length, 3); assert.ok(seen.every(value => value === query));
		await act(async () => { await mounted.current.setStackCollapsed(false); }); assert.equal(expanded, 2); assert.equal(mounted.current.query, query);
	} finally { await mounted.dispose(); }
});

test('cancel joins a held member-probe step, keeps old page/mode, and does not queue another toggle', async () => {
	const owner = createImportTestPort(), held = deferred<PhotoLibraryQueryStepV1>(); let calls = 0, signal: AbortSignal | undefined;
	owner.readPage = async () => page(); owner.readStackQueryStep = async request => { calls++; signal = request.signal; return held.promise; };
	const mounted = await mountImportWorkflow(async () => owner); let pending: Promise<void> | undefined;
	try {
		await act(async () => { await mounted.current.readPage(); }); const before = mounted.current.page;
		await act(async () => { pending = mounted.current.setStackCollapsed(true); await settle(); });
		assert.equal(mounted.current.busy, true); await act(async () => { mounted.current.cancel(); await mounted.current.setStackCollapsed(true); });
		assert.equal(signal?.aborted, true); assert.equal(calls, 1); assert.equal(mounted.current.busy, true);
		await act(async () => { held.resolve({ ...page(1), scanned: 64 }); await pending; });
		assert.equal(mounted.current.stackCollapsed, false); assert.equal(mounted.current.page, before); assert.equal(mounted.current.busy, false);
	} finally { held.resolve({ ...page(0), scanned: 0 }); await pending; await mounted.dispose(); }
});

test('a nonadvancing collapsed cursor refuses without flipping mode or replacing the old page', async () => {
	const owner = createImportTestPort(); owner.readPage = async () => page();
	owner.readStackQueryStep = async request => ({ ...page(0, request.cursor ?? 'same'), scanned: 64 });
	const mounted = await mountImportWorkflow(async () => owner);
	try {
		await act(async () => { await mounted.current.readPage(); }); const before = mounted.current.page;
		await act(async () => { await mounted.current.setStackCollapsed(true); });
		assert.equal(mounted.current.stackCollapsed, false); assert.equal(mounted.current.page, before);
		assert.match(mounted.current.error ?? '', /did not advance/u);
	} finally { await mounted.dispose(); }
});

test('factory replacement retires collapsed mode and waits for the old close before admitting replacement', async () => {
	const first = createImportTestPort(), second = createImportTestPort(), held = deferred<PhotoLibraryQueryStepV1>(), close = deferred<void>(); let opens = 0;
	first.readPage = async () => page(); first.readStackQueryStep = async () => held.promise; first.close = async () => close.promise;
	second.readPage = async () => page(); const mounted = await mountImportWorkflow(async () => first); let pending: Promise<void> | undefined;
	try {
		await act(async () => { await mounted.current.readPage(); pending = mounted.current.setStackCollapsed(true); await settle(); });
		await mounted.replace(async () => { opens++; return second; }); await act(async () => { void mounted.current.readPage(); await settle(); });
		assert.equal(opens, 0); await act(async () => { held.resolve({ ...page(1), scanned: 64 }); await pending; }); assert.equal(opens, 0);
		await act(async () => { close.resolve(); await settle(); }); assert.equal(opens, 1); assert.equal(mounted.current.stackCollapsed, false);
	} finally { held.resolve({ ...page(0), scanned: 0 }); close.resolve(); await pending; await mounted.dispose(); }
});

test('an empty member-probe continuation yields to native tasks so cancellation stops before another64 probes', async () => {
	const owner = createImportTestPort(); let calls = 0; const timers: ReturnType<typeof setTimeout>[] = [];
	const mounted = await mountImportWorkflow(async () => owner); owner.readPage = async () => page();
	owner.readStackQueryStep = async () => { calls++; timers.push(setTimeout(() => { mounted.current.cancel(); }, 0)); return { ...page(0, 'after-64'), scanned: 64 }; };
	try {
		await act(async () => { await mounted.current.readPage(); }); const before = mounted.current.page;
		await act(async () => { await mounted.current.setStackCollapsed(true); });
		assert.equal(calls, 1); assert.equal(mounted.current.page, before); assert.equal(mounted.current.stackCollapsed, false);
	} finally { for (const timer of timers) clearTimeout(timer); await mounted.dispose(); }
});
