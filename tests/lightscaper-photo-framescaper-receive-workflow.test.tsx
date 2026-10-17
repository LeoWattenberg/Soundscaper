/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React, { act } from 'react';
import { usePhotoLibraryWorkflowV2 } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow-v2.ts';
import { usePhotoLibraryWorkflowImageReceive, type CapturedPhotoImageReceive } from '../src/common/editor/ui/lightscaper/photo-library-workflow-image-receive.ts';
import type { PhotoLibraryImageReceivePortV1 } from '../src/common/editor/photo-library-image-receive-port-v1.ts';
import type { CreatePhotoLibrarySessionV3 } from '../src/common/editor/photo-library-session-port-v2.ts';
import type { PhotoLibraryWorkflowSlotV2 } from '../src/common/editor/controller/shared/photo-library-workflow-slot-v2.ts';
import type { LoadPhotoLibraryBackupSaveRuntimeV1 } from '../src/common/editor/controller/shared/photo-library-workflow-slot.ts';
import { seedCurrentAppPhoto, currentAppLocks } from './helpers/lightscaper-current-app-fixture.tsx';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const archive = () => new Blob([Uint8Array.of(11, 22, 33)], { type: 'application/zip' });
const receipt = Object.freeze({ schemaVersion: 1 as const, status: 'imported' as const, catalogId: 'current-catalog', photoId: 'received-photo', originalId: 'received-original', activeVersionId: 'received-master', revision: 0 as const, reusedOriginal: false, settlement: 'complete' as const });
async function fixture(receive: PhotoLibraryImageReceivePortV1['receive'] = async () => receipt) {
	const native = mediaRestoreFixture(), seeded = await seedCurrentAppPhoto(native.factory, currentAppLocks()), events: string[] = [];
	const owner = await seeded.createSession(), originalRead = owner.readPage.bind(owner), originalClose = owner.close.bind(owner);
	const port = { receive }; Object.defineProperty(owner, 'imageReceive', { configurable: true, value: port });
	let reads = 0; owner.readPage = async (...args) => { reads++; return originalRead(...args); };
	owner.close = async () => { events.push('close'); await originalClose(); };
	const factory: CreatePhotoLibrarySessionV3 = () => Promise.resolve(owner);
	let loader: LoadPhotoLibraryBackupSaveRuntimeV1 | undefined, current: ReturnType<typeof usePhotoLibraryWorkflowV2> | undefined;
	function Harness() { current = usePhotoLibraryWorkflowV2(factory, loader); return null; }
	const mounted = await mountPhotoImportUi(() => <Harness />);
	const read = () => { assert.ok(current); return current; };
	await act(async () => { await read().readPage(); });
	return { ...mounted, owner, port, events, read, reads: () => reads, restoreRead() { owner.readPage = async (...args) => { reads++; return originalRead(...args); }; },
		async replaceSameFactory() { loader = async () => { throw new Error('Unused backup loader'); }; await mounted.render(); } };
}

test('Light receive captures archive/source before acquisition and retains the actual receiver', async () => {
	let source = '', bytes: number[] = [];
	const f = await fixture(async function(this: unknown, request) { assert.equal(this, nativePort); assert.equal(Object.hasOwn(request, 'imageClipId'), false); source = request.sourceId; bytes = [...new Uint8Array(await request.archive.arrayBuffer())]; return receipt; });
	const nativePort: object = f.port;
	try {
		const captured = f.read().captureImageReceive(), request = { archive: archive(), sourceId: 'one' };
		let result: Awaited<ReturnType<CapturedPhotoImageReceive['receive']>> | undefined;
		await act(async () => { const work = captured.receive(request, new AbortController().signal); request.sourceId = 'other'; request.archive = new Blob(); result = await work; });
		assert.equal(source, 'one'); assert.deepEqual(bytes, [11, 22, 33]); assert.equal(result?.refresh, 'complete'); assert.ok(Object.isFrozen(result?.receipt));
		assert.equal(f.reads(), 2, 'The plain current query must actually reload after publication.');
		f.port.receive = async () => assert.fail('Same menu generation must retain the originally captured method.');
		await act(async () => { await captured.receive({ archive: archive(), sourceId: 'two' }, new AbortController().signal); }); assert.equal(source, 'two');
	} finally { await f.dispose(); }
});

test('Light ordinary receive captures its own clip scalar before acquisition without evaluating a later getter', async () => {
	let selected: unknown, getters = 0, received: unknown;
	const f = await fixture(async function(this: unknown, request) { assert.equal(this, nativePort); selected = Object.getOwnPropertyDescriptor(request, 'imageClipId')?.value as unknown; received = request; return receipt; });
	const nativePort: object = f.port;
	try {
		const captured = f.read().captureImageReceive(), request = { archive: archive(), sourceId: 'still', imageClipId: 'real-bin-image' };
		await act(async () => { const work = captured.receive(request, new AbortController().signal);
			Object.defineProperty(request, 'imageClipId', { get() { getters++; throw Symbol('late clip getter'); } }); await work; });
		assert.equal(selected, 'real-bin-image'); assert.equal(getters, 0); assert.ok(Object.isFrozen(received));
	} finally { await f.dispose(); }
});

test('Light ordinary receive refuses missing-value and accessor clip fields before native publication', async () => {
	let receives = 0, getters = 0; const f = await fixture(async () => { receives++; return receipt; });
	try {
		const captured = f.read().captureImageReceive();
		for (const imageClipId of [undefined, '', 'foreign/id']) await assert.rejects(captured.receive({ archive: archive(), sourceId: 'still', imageClipId }, new AbortController().signal));
		const request = Object.defineProperty({ archive: archive(), sourceId: 'still', imageClipId: 'real-image' }, 'imageClipId', { get() { getters++; return 'real-image'; } });
		await assert.rejects(captured.receive(request, new AbortController().signal)); assert.equal(receives, 0); assert.equal(getters, 0);
	} finally { await f.dispose(); }
});

test('Light receive retains Imported ACK and opaque refresh failure, then reloads the same generation', async () => {
	const primary = Symbol('page read failed'), f = await fixture();
	try {
		const captured = f.read().captureImageReceive(); f.owner.readPage = async () => { throw primary; };
		let result: Awaited<ReturnType<CapturedPhotoImageReceive['receive']>> | undefined;
		await act(async () => { result = await captured.receive({ archive: archive(), sourceId: 'one' }, new AbortController().signal); });
		assert.equal(result?.receipt.status, 'imported'); assert.equal(result?.refresh, 'failed'); assert.equal(result?.failure, primary);
		f.restoreRead(); await act(async () => { await captured.reload(new AbortController().signal); }); assert.equal(f.reads(), 2);
	} finally { await f.dispose(); }
});

test('Light receive keeps recovery-pending ACK opaque without treating cleanup as unpublication', async () => {
	const reason = Object.freeze(Object.create(null)) as object, f = await fixture(async () => ({ ...receipt, settlement: 'recovery-pending', failure: reason }));
	try {
		let result: Awaited<ReturnType<CapturedPhotoImageReceive['receive']>> | undefined;
		await act(async () => { result = await f.read().captureImageReceive().receive({ archive: archive(), sourceId: 'one' }, new AbortController().signal); });
		assert.equal(result?.receipt.settlement, 'recovery-pending'); assert.equal(result?.receipt.failure, reason); assert.equal(result?.refresh, 'complete');
	} finally { await f.dispose(); }
});

test('Light receive preserves a swallowed undefined native failure rather than claiming completed success', async () => {
	const f = await fixture(async () => Promise.reject(undefined));
	try { await act(async () => { await assert.rejects(f.read().captureImageReceive().receive({ archive: archive(), sourceId: 'one' }, new AbortController().signal), error => error === undefined); }); }
	finally { await f.dispose(); }
});

test('Light receive refuses missing capability and malformed ACK without publishing success', async () => {
	const f = await fixture(async () => ({ ...receipt, revision: 1 }) as unknown as typeof receipt);
	try {
		await act(async () => { await assert.rejects(f.read().captureImageReceive().receive({ archive: archive(), sourceId: 'one' }, new AbortController().signal), /acknowledgement/u); });
		Object.defineProperty(f.owner, 'imageReceive', { configurable: true, value: undefined });
		await act(async () => { await assert.rejects(f.read().captureImageReceive().receive({ archive: archive(), sourceId: 'one' }, new AbortController().signal), /unavailable/u); });
		assert.equal(f.reads(), 1);
	} finally { await f.dispose(); }
});

test('Light receive refuses an old menu capability after same-factory Session generation replacement', async () => {
	let receives = 0; const f = await fixture(async () => { receives++; return receipt; }), captured = f.read().captureImageReceive();
	try { await f.replaceSameFactory(); await assert.rejects(captured.receive({ archive: archive(), sourceId: 'one' }, new AbortController().signal), { name: 'AbortError' }); assert.equal(receives, 0); }
	finally { await f.dispose(); }
});

test('Light receive retirement joins held native publication before original owner close and keeps late ACK', async () => {
	const entered = deferred<void>(), release = deferred<void>();
	const f = await fixture(async () => { entered.resolve(); await release.promise; return receipt; });
	let work: ReturnType<CapturedPhotoImageReceive['receive']> | undefined;
	try {
		await act(async () => { work = f.read().captureImageReceive().receive({ archive: archive(), sourceId: 'one' }, new AbortController().signal); await entered.promise; }); assert.ok(work);
		f.read().registerExportDestination(async () => { await work; }); const closing = f.read().retireAndJoin();
		assert.equal(await remainsPending(closing), true); assert.deepEqual(f.events, []); release.resolve();
		let result: Awaited<ReturnType<CapturedPhotoImageReceive['receive']>> | undefined;
		await act(async () => { result = await work; await closing; await settle(); });
		assert.equal(result?.receipt.status, 'imported'); assert.equal(result?.refresh, 'failed'); assert.deepEqual(f.events, ['close']);
	} finally { release.resolve(); await f.dispose(); }
});

test('Light receive busy action never calls native publication', async () => {
	let receives = 0; const f = await fixture(async () => { receives++; return receipt; }), entered = deferred<void>(), release = deferred<void>();
	let busy: Promise<unknown> | undefined;
	try {
		await act(async () => { busy = f.read().executeDevelop(async () => { entered.resolve(); await release.promise; }); await entered.promise; });
		await assert.rejects(f.read().captureImageReceive().receive({ archive: archive(), sourceId: 'one' }, new AbortController().signal), /already pending/u); assert.equal(receives, 0);
	} finally { release.resolve(); await act(async () => { await busy; }); await f.dispose(); }
});

test('Light receive never accepts executor status when the maintained action callback did not enter', async () => {
	const current: PhotoLibraryWorkflowSlotV2 = { live: true, factory: undefined, proxyFactory: undefined, backupLoader: undefined,
		lifetime: new AbortController(), beforeDrain: null, pending: null, active: null, proxyPending: null, closeOwner: null, query: null, savedCollectionId: null,
		stackCollapsed: false, page: null, batchRenamePlanner: null, backupRuntime: null, backupLoading: null, retirement: null };
	let capture: (() => Readonly<CapturedPhotoImageReceive>) | undefined, status: 'completed' | 'failed' | 'cancelled' | 'busy' = 'completed';
	function Harness() { capture = usePhotoLibraryWorkflowImageReceive({ slot: { current }, factory: { current: undefined }, loader: { current: undefined }, renderer: { current: undefined },
		createSession: undefined, loadBackupSaveRuntime: undefined, createDevelopProxyRuntime: undefined, perform: () => Promise.resolve(status), publishPage: () => assert.fail('No action entered') }); return null; }
	const f = await mountPhotoImportUi(() => <Harness />);
	try { assert.ok(capture); for (const value of ['completed', 'failed', 'cancelled', 'busy'] as const) { status = value; await assert.rejects(capture().receive({ archive: archive(), sourceId: 'one' }, new AbortController().signal)); } }
	finally { await f.dispose(); }
});
