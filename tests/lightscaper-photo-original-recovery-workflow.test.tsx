/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import type { PhotoLibraryOriginalInspectionPageV1, PhotoLibraryOriginalRestorationReceiptV1,
	PhotoLibraryOriginalRestoreTargetV1 } from '../src/common/editor/photo-library-original-recovery-port-v1.ts';
import { createImportTestPort, mountImportWorkflow } from './helpers/photo-import-workflow-fixture.tsx';
import { deferred, settle } from './helpers/async-test-control.ts';

const binding = Object.freeze({ catalogId: 'catalog-1', importId: null, photoId: 'photo-1', assetId: 'asset-1',
	sourceId: 'original-1', sha256: 'a'.repeat(64), size: 3, name: 'source.jpg', mimeType: 'image/jpeg' });
const inspected: PhotoLibraryOriginalInspectionPageV1 = Object.freeze({ schemaVersion: 1, catalogId: 'catalog-1',
	catalogName: 'Library', revision: 4, activeImportId: null, startupFailure: { message: 'Original media row is missing.' },
	rows: Object.freeze([{ photoId: 'photo-1', revision: 2, fileName: 'Authored name.jpg', binding,
		inspection: { status: 'missing' as const, reason: 'media-row' as const } }]), scanned: 1, cursor: null });
const target: PhotoLibraryOriginalRestoreTargetV1 = Object.freeze({ schemaVersion: 1, catalogRevision: 4,
	activeImportId: null, photoRevision: 2, binding });
const restored: PhotoLibraryOriginalRestorationReceiptV1 = Object.freeze({ photoId: binding.photoId,
	assetId: binding.assetId, sha256: binding.sha256, size: binding.size, notices: Object.freeze([]) });
const selected = () => new File([new Uint8Array([1, 2, 3])], 'untrusted-selection.jpg', { type: 'image/jpeg' });

test('opt-in inspection borrows the same session after ordinary library startup fails', async () => {
	const port = createImportTestPort(); let opens = 0, inspections = 0;
	port.readPage = async () => { throw new Error('Original media row is missing.'); };
	port.inspectOriginals = async options => { inspections++; assert.equal(options?.cursor, null); return inspected; };
	const mounted = await mountImportWorkflow(async () => { opens++; return port; });
	try {
		assert.equal(opens, 0); assert.equal(inspections, 0);
		await act(async () => { await mounted.current.readPage(); });
		assert.match(mounted.current.error ?? '', /media row is missing/);
		await act(async () => { await mounted.current.inspectOriginals(); });
		assert.equal(opens, 1); assert.equal(inspections, 1); assert.equal(mounted.current.page, null);
		assert.equal(mounted.current.originalInspectionPage?.rows[0]?.fileName, 'Authored name.jpg');
		assert.equal(mounted.current.error, null); assert.equal(mounted.current.busy, false);
	} finally { await mounted.dispose(); }
});

test('cancellation keeps foreground exclusion until held native inspection settles and refuses its late page', async () => {
	const held = deferred<PhotoLibraryOriginalInspectionPageV1>(), port = createImportTestPort(); let calls = 0, aborted = false;
	port.inspectOriginals = async options => { calls++; options?.signal?.addEventListener('abort', () => { aborted = true; }, { once: true }); return held.promise; };
	let reads = 0; port.readPage = async () => { reads++; return { catalogName: 'Library', totalCount: 0, rows: [], cursor: null }; };
	const mounted = await mountImportWorkflow(async () => port);
	let pending: Promise<void> | undefined;
	try {
		await act(async () => { pending = mounted.current.inspectOriginals(); await settle(); });
		assert.equal(mounted.current.busy, true); assert.equal(mounted.current.originalRecoveryActive, true);
		await act(async () => { mounted.current.cancel(); await mounted.current.readPage(); await mounted.current.inspectOriginals(); });
		assert.equal(aborted, true); assert.equal(calls, 1); assert.equal(reads, 0); assert.equal(mounted.current.busy, true);
		await act(async () => { held.resolve(inspected); await pending; });
		assert.equal(mounted.current.originalInspectionPage, null); assert.equal(mounted.current.originalRecoveryCancelled, true);
		assert.equal(mounted.current.busy, false); assert.equal(mounted.current.error, null);
	} finally { held.resolve(inspected); await pending; await mounted.dispose(); }
});

test('a durable restoration acknowledgement survives failed ordinary recovery and is retried after its lease returned', async () => {
	const port = createImportTestPort(), events: string[] = []; let recoveries = 0;
	port.restoreOriginalBody = async (actual, body) => { events.push('repair-returned'); assert.deepEqual(actual, target); assert.equal(body.size, 3); return restored; };
	port.readPage = async () => { events.push('ordinary-recovery'); if (++recoveries === 1) throw new Error('Another original is missing.');
		return { catalogName: 'Library', totalCount: 1, rows: [], cursor: null }; };
	const mounted = await mountImportWorkflow(async () => port);
	try {
		await act(async () => { assert.deepEqual(await mounted.current.restoreOriginalBody(target, selected()), restored); });
		assert.deepEqual(events, ['repair-returned', 'ordinary-recovery']);
		assert.deepEqual(mounted.current.originalRestorationReceipt, restored);
		assert.equal(mounted.current.originalRestorationNotice, 'refresh-failed'); assert.match(mounted.current.error ?? '', /Another original/);
		await act(async () => { await mounted.current.readPage(); });
		assert.equal(mounted.current.page?.totalCount, 1); assert.equal(mounted.current.originalRestorationReceipt?.assetId, binding.assetId);
	} finally { await mounted.dispose(); }
});

test('late cancellation retains body acknowledgement while keeping cancelled library recovery separate', async () => {
	const held = deferred<PhotoLibraryOriginalRestorationReceiptV1>(), port = createImportTestPort(); let reads = 0;
	port.restoreOriginalBody = async () => held.promise;
	port.readPage = async () => { reads++; throw new Error('No read should start with the cancelled signal.'); };
	const mounted = await mountImportWorkflow(async () => port);
	let pending: Promise<PhotoLibraryOriginalRestorationReceiptV1 | null> | undefined;
	try {
		await act(async () => { pending = mounted.current.restoreOriginalBody(target, selected()); await settle(); });
		await act(async () => { mounted.current.cancel(); });
		assert.equal(mounted.current.busy, true);
		await act(async () => { held.resolve(restored); assert.deepEqual(await pending, restored); });
		assert.equal(reads, 0); assert.deepEqual(mounted.current.originalRestorationReceipt, restored);
		assert.equal(mounted.current.originalRestorationNotice, 'refresh-failed'); assert.equal(mounted.current.originalRecoveryCancelled, false);
		assert.equal(mounted.current.error, null); assert.equal(mounted.current.busy, false);
	} finally { held.resolve(restored); await pending; await mounted.dispose(); }
});

test('factory replacement joins held original work before closing and suppresses retired scalar publication', async () => {
	const held = deferred<PhotoLibraryOriginalInspectionPageV1>(), old = createImportTestPort(), next = createImportTestPort();
	const events: string[] = []; old.inspectOriginals = async () => { events.push('old-inspection'); return held.promise; };
	old.close = async () => { events.push('old-closed'); }; next.inspectOriginals = async () => { events.push('next-inspection'); return inspected; };
	const mounted = await mountImportWorkflow(async () => old); let pending: Promise<void> | undefined;
	const readInspection = () => mounted.current.originalInspectionPage;
	try {
		await act(async () => { pending = mounted.current.inspectOriginals(); await settle(); });
		const stale = mounted.current.inspectOriginals;
		await act(async () => { await mounted.replace(async () => { events.push('next-opened'); return next; }); await stale(); });
		assert.deepEqual(events, ['old-inspection']); assert.equal(mounted.current.originalInspectionPage, null);
		assert.equal(mounted.current.busy, true);
		await act(async () => { held.resolve(inspected); await pending; await settle(); });
		assert.deepEqual(events, ['old-inspection', 'old-closed']); assert.equal(mounted.current.originalInspectionPage, null);
		await act(async () => { await mounted.current.inspectOriginals(); });
		assert.deepEqual(events, ['old-inspection', 'old-closed', 'next-opened', 'next-inspection']);
		assert.equal(readInspection()?.catalogId, binding.catalogId);
	} finally { held.resolve(inspected); await pending; await mounted.dispose(); }
});

test('cleanup failure following cancellation stays visible independently of a clean cancellation outcome', async () => {
	const held = deferred<PhotoLibraryOriginalRestorationReceiptV1>(), old = createImportTestPort();
	old.restoreOriginalBody = async () => held.promise;
	const mounted = await mountImportWorkflow(async () => old); let pending: Promise<PhotoLibraryOriginalRestorationReceiptV1 | null> | undefined;
	try {
		await act(async () => { pending = mounted.current.restoreOriginalBody(target, selected()); await settle(); });
		await act(async () => { mounted.current.cancel(); held.reject(new Error('Staged original cleanup failed.')); await pending; });
		assert.match(mounted.current.error ?? '', /Staged original cleanup failed/);
		assert.equal(mounted.current.originalRecoveryCancelled, false); assert.equal(mounted.current.originalRestorationReceipt, null);
	} finally { held.resolve(restored); await pending; await mounted.dispose(); }
});

test('a held or refused replacement inspection never adopts the previous factory page or durable receipt', async () => {
	const first = createImportTestPort(), next = createImportTestPort(), held = deferred<PhotoLibraryOriginalInspectionPageV1>();
	first.inspectOriginals = async () => inspected; first.restoreOriginalBody = async () => restored;
	next.inspectOriginals = async () => held.promise;
	const mounted = await mountImportWorkflow(async () => first); let pending: Promise<void> | undefined;
	try {
		await act(async () => { await mounted.current.inspectOriginals(); await mounted.current.restoreOriginalBody(target, selected()); });
		assert.equal(mounted.current.originalInspectionPage?.catalogId, binding.catalogId);
		assert.equal(mounted.current.originalRestorationReceipt?.assetId, binding.assetId);
		await act(async () => { await mounted.replace(async () => next); });
		assert.equal(mounted.current.originalInspectionPage, null); assert.equal(mounted.current.originalRestorationReceipt, null);
		await act(async () => { pending = mounted.current.inspectOriginals(); await settle(); });
		assert.equal(mounted.current.originalInspectionPage, null, 'the phase notification carries no old-factory scalar authority');
		assert.equal(mounted.current.originalRestorationReceipt, null);
		await act(async () => { held.reject(new Error('Replacement catalog inspection refused.')); await pending; });
		assert.equal(mounted.current.originalInspectionPage, null); assert.equal(mounted.current.originalRestorationReceipt, null);
		assert.match(mounted.current.error ?? '', /Replacement catalog inspection refused/);
	} finally { held.resolve(inspected); await pending; await mounted.dispose(); }
});

test('original task ownership covers a held factory before the body controller starts', async () => {
	const opened = deferred<ReturnType<typeof createImportTestPort>>(), port = createImportTestPort();
	port.inspectOriginals = async () => inspected;
	const mounted = await mountImportWorkflow(() => opened.promise); let pending: Promise<void> | undefined;
	try {
		await act(async () => { pending = mounted.current.inspectOriginals(); await settle(); });
		assert.equal(mounted.current.busy, true); assert.equal(mounted.current.originalRecoveryActive, true);
		await act(async () => { opened.resolve(port); await pending; });
		assert.equal(mounted.current.busy, false); assert.equal(mounted.current.originalRecoveryActive, false);
	} finally { opened.resolve(port); await pending; await mounted.dispose(); }
});

test('inspection cancelled during factory acquisition publishes clean cancellation after joining the factory', async () => {
	const opened = deferred<ReturnType<typeof createImportTestPort>>(), port = createImportTestPort(); let calls = 0;
	port.inspectOriginals = async () => { calls++; return inspected; };
	const mounted = await mountImportWorkflow(() => opened.promise); let pending: Promise<void> | undefined;
	try {
		await act(async () => { pending = mounted.current.inspectOriginals(); await settle(); });
		await act(async () => { mounted.current.cancel(); });
		assert.equal(mounted.current.busy, true); assert.equal(mounted.current.originalRecoveryActive, true);
		await act(async () => { opened.resolve(port); await pending; });
		assert.equal(calls, 0); assert.equal(mounted.current.originalInspectionPage, null);
		assert.equal(mounted.current.originalRecoveryCancelled, true);
		assert.equal(mounted.current.error, null); assert.equal(mounted.current.busy, false);
	} finally { opened.resolve(port); await pending; await mounted.dispose(); }
});

test('restoration cancelled during factory acquisition publishes cancellation without a body acknowledgement', async () => {
	const opened = deferred<ReturnType<typeof createImportTestPort>>(), port = createImportTestPort(); let calls = 0;
	port.restoreOriginalBody = async () => { calls++; return restored; };
	const mounted = await mountImportWorkflow(() => opened.promise);
	let pending: Promise<PhotoLibraryOriginalRestorationReceiptV1 | null> | undefined;
	try {
		await act(async () => { pending = mounted.current.restoreOriginalBody(target, selected()); await settle(); });
		await act(async () => { mounted.current.cancel(); });
		assert.equal(mounted.current.busy, true);
		await act(async () => { opened.resolve(port); assert.equal(await pending, null); });
		assert.equal(calls, 0); assert.equal(mounted.current.originalRestorationReceipt, null);
		assert.equal(mounted.current.originalRestorationNotice, null);
		assert.equal(mounted.current.originalRecoveryCancelled, true);
		assert.equal(mounted.current.error, null); assert.equal(mounted.current.busy, false);
	} finally { opened.resolve(port); await pending; await mounted.dispose(); }
});

test('original task ownership covers held ordinary recovery after the durable body acknowledgement', async () => {
	const opened = deferred<void>(), port = createImportTestPort(); port.restoreOriginalBody = async () => restored;
	port.readPage = async () => { await opened.promise; return { catalogName: 'Library', totalCount: 1, rows: [], cursor: null }; };
	const mounted = await mountImportWorkflow(async () => port); let pending: Promise<PhotoLibraryOriginalRestorationReceiptV1 | null> | undefined;
	try {
		await act(async () => { pending = mounted.current.restoreOriginalBody(target, selected()); await settle(); });
		assert.deepEqual(mounted.current.originalRestorationReceipt, restored);
		assert.equal(mounted.current.busy, true); assert.equal(mounted.current.originalRecoveryActive, true);
		assert.equal(mounted.current.originalRestorationNotice, null, 'a pending recovery has not failed');
		await act(async () => { opened.resolve(); await pending; });
		assert.equal(mounted.current.busy, false); assert.equal(mounted.current.originalRecoveryActive, false);
		assert.equal(mounted.current.originalRestorationNotice, null);
	} finally { opened.resolve(); await pending; await mounted.dispose(); }
});
