/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import type { PhotoLibraryImportRequestOptionsV1, PhotoLibraryImportSettingsV1 } from '../src/common/editor/photo-library-import-settings-port-v1.ts';
import { deferred, settle } from './helpers/async-test-control.ts';
import { createImportTestPort, mountImportWorkflow } from './helpers/photo-import-workflow-fixture.tsx';

const file = new File(['x'], '東京 é source.png');
const imported = Object.freeze({ index: 0, fileName: file.name, photoId: 'photo', status: 'imported' as const,
	reusedOriginal: false, message: null, hasMetadataNotices: false });
const settings: PhotoLibraryImportSettingsV1 = { rename: null, metadata: { title: '' }, keywordIds: [] };

test('plain legacy imports omit settings and return a finished reviewable receipt even when all per-file results failed', async () => {
	const port = createImportTestPort(); let calls = 0;
	const failed = { ...imported, photoId: null, status: 'failed' as const, message: 'Unsupported source' };
	port.importFiles = async (files, options) => { calls++; assert.equal(files[0], file); assert.equal(Object.hasOwn(options ?? {}, 'settings'), false); return [failed]; };
	const mounted = await mountImportWorkflow(async () => port);
	try {
		await act(async () => { assert.deepEqual(await mounted.current.importFiles([file]), { outcome: 'acknowledged',
			items: [failed], completion: 'finished', notice: null }); });
		assert.equal(calls, 1); assert.deepEqual(mounted.current.receipts, [failed]);
	} finally { await mounted.dispose(); }
});

test('authored settings are detached before lazy acquisition and pre-ack refusal reports failed', async () => {
	const ready = deferred<ReturnType<typeof createImportTestPort>>(), port = createImportTestPort();
	const mutable = { rename: { template: '{stem}.{extension}', sequenceStart: 1, sequencePadding: 3 }, metadata: { creator: 'Initial' }, keywordIds: ['keyword'] };
	port.importFiles = async (_files, options) => { assert.equal(options?.settings?.metadata.creator, 'Initial');
		assert.equal(Object.isFrozen(options?.settings?.metadata), true); throw new Error('Invalid name template'); };
	const mounted = await mountImportWorkflow(() => ready.promise);
	let pending: Promise<unknown> | undefined;
	try {
		await act(async () => { pending = mounted.current.importFiles([file], { settings: mutable }); });
		mutable.metadata.creator = 'Changed'; mutable.keywordIds.push('other');
		await act(async () => { ready.resolve(port); assert.deepEqual(await pending, { outcome: 'failed' }); });
		assert.equal(mounted.current.error, 'Invalid name template'); assert.deepEqual(mounted.current.receipts, []); assert.equal(file.name, imported.fileName);
	} finally { ready.resolve(port); await pending; await mounted.dispose(); }
});

test('exactly one durable indexed acknowledgement survives a later legacy exception and invalidates its old cursor', async () => {
	const port = createImportTestPort();
	port.readPage = async () => ({ catalogName: 'Library', totalCount: 0, rows: [], cursor: 'old' });
	port.importFiles = async (_files, options) => { options?.onAcknowledged?.(imported); options?.onAcknowledged?.(imported); throw new Error('Promotion interrupted'); };
	const mounted = await mountImportWorkflow(async () => port);
	try {
		await act(async () => { await mounted.current.readPage(); });
		await act(async () => { assert.deepEqual(await mounted.current.importFiles([file], { settings }),
			{ outcome: 'acknowledged', items: [imported], completion: 'failed', notice: 'refresh-failed' }); });
		assert.deepEqual(mounted.current.receipts, [imported]); assert.equal(mounted.current.page?.cursor, null);
		assert.equal(mounted.current.error, 'Promotion interrupted');
	} finally { await mounted.dispose(); }
});

test('pre-ack external cancellation is cancelled; post-ack cancellation retains interrupted durable items', async () => {
	const port = createImportTestPort(), stop = new AbortController();
	port.importFiles = async (_files, options) => { options?.onAcknowledged?.(imported); stop.abort(); options?.signal?.throwIfAborted(); return [imported]; };
	const mounted = await mountImportWorkflow(async () => port);
	try {
		const before = new AbortController(); before.abort();
		await act(async () => { assert.deepEqual(await mounted.current.importFiles([file], { signal: before.signal }), { outcome: 'cancelled' }); });
		await act(async () => { assert.deepEqual(await mounted.current.importFiles([file], { signal: stop.signal }),
			{ outcome: 'acknowledged', items: [imported], completion: 'cancelled', notice: 'refresh-failed' }); });
		assert.deepEqual(mounted.current.receipts, [imported]); assert.equal(mounted.current.error, null);
		assert.deepEqual(mounted.current.importReceipt, { outcome: 'acknowledged', items: [imported], completion: 'cancelled', notice: 'refresh-failed' });
	} finally { await mounted.dispose(); }
});

test('finished observer callbacks retire before a later gesture and cannot replace its receipts', async () => {
	const second = new File(['next'], 'second.png'), next = { ...imported, fileName: second.name, photoId: 'next' };
	const port = createImportTestPort(); let callback: PhotoLibraryImportRequestOptionsV1['onAcknowledged'], calls = 0;
	port.importFiles = async (_files, options) => { if (++calls === 1) { callback = options?.onAcknowledged; return [imported]; } return [next]; };
	const mounted = await mountImportWorkflow(async () => port);
	try {
		await act(async () => { await mounted.current.importFiles([file]); await mounted.current.importFiles([second]); callback?.(imported); });
		assert.deepEqual(mounted.current.receipts, [next]); assert.deepEqual(mounted.current.importReceipt,
			{ outcome: 'acknowledged', items: [next], completion: 'finished', notice: null });
	} finally { await mounted.dispose(); }
});

test('65 selected Files refuse before opening resources while original names bypass hostile own getters', async () => {
	const selected = new File(['source'], 'immutable original.png'), original = { ...imported, fileName: selected.name };
	let opens = 0, getters = 0;
	Object.defineProperty(selected, 'name', { get() { getters++; throw new Error('Own source getter'); } });
	const port = createImportTestPort(); port.importFiles = async () => [original];
	const mounted = await mountImportWorkflow(async () => { opens++; return port; });
	try {
		await act(async () => { assert.deepEqual(await mounted.current.importFiles(Array<File>(65).fill(selected)), { outcome: 'failed' }); });
		assert.equal(opens, 0); assert.equal(getters, 0);
		await act(async () => { assert.equal((await mounted.current.importFiles([selected])).outcome, 'acknowledged'); });
		assert.equal(opens, 1); assert.equal(getters, 0); assert.equal(mounted.current.receipts[0]?.fileName, 'immutable original.png');
	} finally { await mounted.dispose(); }
});

test('oversized original source names refuse before lazy acquisition and keep their File identity unchanged', async () => {
	const selected = new File(['original'], '東'.repeat(257)); let opens = 0;
	const mounted = await mountImportWorkflow(async () => { opens++; return createImportTestPort(); });
	try {
		await act(async () => { assert.deepEqual(await mounted.current.importFiles([selected]), { outcome: 'failed' }); });
		assert.equal(opens, 0); assert.equal(selected.name, '東'.repeat(257)); assert.deepEqual(mounted.current.receipts, []);
	} finally { await mounted.dispose(); }
});

test('an incomplete final array preserves its known durable publication with failed completion', async () => {
	const second = new File(['next'], 'second.png'), port = createImportTestPort(); port.importFiles = async () => [imported];
	const mounted = await mountImportWorkflow(async () => port);
	try {
		await act(async () => { assert.deepEqual(await mounted.current.importFiles([file, second]),
			{ outcome: 'acknowledged', items: [imported], completion: 'failed', notice: 'refresh-failed' }); });
		assert.match(mounted.current.error ?? '', /incomplete/u);
	} finally { await mounted.dispose(); }
});

test('final imported/failed results merge once and refresh failure remains acknowledged with an invalidated query cursor', async () => {
	const second = new File(['y'], 'second.png'), failed = { ...imported, index: 1, fileName: second.name, photoId: null, status: 'failed' as const };
	const port = createImportTestPort(); let reads = 0;
	port.readQueryStep = async () => { if (++reads > 1) throw new Error('Refresh unavailable');
		return { catalogName: 'Filtered', totalCount: 0, rows: [], cursor: null, scanned: 0 }; };
	port.importFiles = async (_files, options) => { options?.onAcknowledged?.(imported); return [imported, failed]; };
	const mounted = await mountImportWorkflow(async () => port);
	try {
		await act(async () => { await mounted.current.applyQuery({ text: '', filter: null, sort: { field: 'photo-id', direction: 'ascending' } }); });
		await act(async () => { assert.deepEqual(await mounted.current.importFiles([file, second]),
			{ outcome: 'acknowledged', items: [imported, failed], completion: 'finished', notice: 'refresh-failed' }); });
		assert.equal(mounted.current.error, 'Refresh unavailable'); assert.deepEqual(mounted.current.receipts, [imported, failed]);
		assert.equal(mounted.current.page?.cursor, null);
	} finally { await mounted.dispose(); }
});

test('busy second imports refuse without queuing and a retired generation keeps late acknowledgement out of its replacement', async () => {
	const held = deferred<readonly typeof imported[]>(), drain = deferred<void>(), port = createImportTestPort(), next = createImportTestPort();
	let calls = 0, replacementOpens = 0;
	port.importFiles = async (_files, options) => { calls++; const results = await held.promise; options?.onAcknowledged?.(imported); return results; };
	port.close = () => drain.promise;
	const mounted = await mountImportWorkflow(async () => port); let pending: Promise<unknown> | undefined;
	try {
		await act(async () => { pending = mounted.current.importFiles([file]); });
		await act(async () => { assert.deepEqual(await mounted.current.importFiles([file]), { outcome: 'busy' }); }); assert.equal(calls, 1);
		await mounted.replace(async () => { replacementOpens++; return next; });
		await act(async () => { held.resolve([imported]); assert.deepEqual(await pending,
			{ outcome: 'acknowledged', items: [imported], completion: 'finished', notice: 'refresh-failed' }); });
		assert.deepEqual(mounted.current.receipts, []); assert.equal(replacementOpens, 0);
		drain.resolve(); await act(async () => { await settle(); await mounted.current.readPage(); }); assert.equal(replacementOpens, 1);
	} finally { held.resolve([imported]); drain.resolve(); await pending; await mounted.dispose(); }
});

test('preset callbacks keep identity across presentation changes and preserve post-ack cancellation', async () => {
	const port = createImportTestPort(), stop = new AbortController();
	port.readImportPresets = async () => ({ revision: 0, presets: [] });
	port.applyImportPreset = async () => { stop.abort(); return { revision: 1, presets: [] }; };
	const mounted = await mountImportWorkflow(async () => port);
	try {
		const read = mounted.current.readImportPresets, write = mounted.current.applyImportPreset;
		await act(async () => { await mounted.current.readPage(); assert.deepEqual(await read(), { revision: 0, presets: [] }); });
		assert.equal(mounted.current.readImportPresets, read); assert.equal(mounted.current.applyImportPreset, write);
		await act(async () => { assert.deepEqual(await write({ type: 'delete', expectedRevision: 0, id: 'preset' }, { signal: stop.signal }), { revision: 1, presets: [] }); });
	} finally { await mounted.dispose(); }
});
