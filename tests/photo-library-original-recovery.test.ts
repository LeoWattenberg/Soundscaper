/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibraryOriginalRecoveryV1 } from '../src/common/editor/controller/shared/photo-library-original-recovery-v1.ts';
import type { PhotoLibraryOriginalInspectionPageV1, PhotoLibraryOriginalRestoreTargetV1,
	PhotoLibraryOriginalRestorationReceiptV1 } from '../src/common/editor/photo-library-original-recovery-port-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const binding = Object.freeze({ catalogId: 'catalog-1', importId: 'import-1', photoId: 'photo-1',
	assetId: 'original-1', sourceId: 'source-1', sha256: 'a'.repeat(64), size: 3, name: 'Exact original.png', mimeType: 'image/png' });
const target: PhotoLibraryOriginalRestoreTargetV1 = Object.freeze({ schemaVersion: 1, catalogRevision: 4,
	activeImportId: 'import-1', photoRevision: 2, binding });
const receipt: PhotoLibraryOriginalRestorationReceiptV1 = Object.freeze({ photoId: binding.photoId, assetId: binding.assetId,
	sha256: binding.sha256, size: binding.size, notices: Object.freeze([]) });
const page = (): PhotoLibraryOriginalInspectionPageV1 => ({ schemaVersion: 1, catalogId: binding.catalogId, catalogName: 'Catalog',
	revision: 4, activeImportId: binding.importId, startupFailure: { message: 'Recovery refused' }, scanned: 1, cursor: 'opaque-next',
	rows: [{ photoId: binding.photoId, revision: 2, fileName: 'Authored.png', binding: { ...binding },
		inspection: { status: 'missing', reason: 'media-row' } }] });

test('one explicit inspection stays pending through cancellation and refuses a second operation without queueing', async () => {
	const owner = new PhotoLibraryOriginalRecoveryV1(), entered = deferred<void>(), held = deferred<PhotoLibraryOriginalInspectionPageV1>();
	let calls = 0;
	const work = owner.startInspection({ cursor: null, inspectOriginals: async options => {
		calls++; assert.equal(owner.isPending(), true); assert.equal(options?.cursor, null); entered.resolve(); return held.promise;
	} });
	await entered.promise;
	await assert.rejects(owner.startRestore({ target, file: new Blob(['abc']), restoreOriginalBody: async () => receipt }), /pending/iu);
	const closing = owner.cancelAndJoin(); assert.equal(await remainsPending(closing), true);
	assert.equal(owner.getSnapshot().phase, 'inspecting'); held.resolve(page());
	assert.deepEqual(await work, { status: 'cancelled' }); await closing;
	assert.equal(calls, 1); assert.equal(owner.isPending(), false); assert.equal(owner.getSnapshot().page, null);
});

test('a durable restore ACK wins late cancellation and remains scalar with truthful cleanup notices', async () => {
	const owner = new PhotoLibraryOriginalRecoveryV1(), entered = deferred<void>(), held = deferred<PhotoLibraryOriginalRestorationReceiptV1>();
	const file = new Blob(['abc']); let receivedSignal: AbortSignal | undefined;
	const work = owner.startRestore({ target, file, restoreOriginalBody: async (captured, selected, options) => {
		assert.deepEqual(captured, target); assert.notEqual(captured, target); assert.equal(selected, file);
		receivedSignal = options?.signal; entered.resolve(); return held.promise;
	} });
	await entered.promise; const closing = owner.cancelAndJoin(new Error('Dialog closed'));
	assert.equal(receivedSignal?.aborted, true); assert.equal(await remainsPending(closing), true);
	held.resolve({ ...receipt, notices: ['cleanup-failed'] });
	const acknowledgment = await work; await closing;
	assert.deepEqual(acknowledgment, { ...receipt, notices: ['cleanup-failed'] });
	assert.equal(owner.getSnapshot().receipt, acknowledgment);
	assert.deepEqual(Object.keys(owner.getSnapshot()).sort(), ['error', 'page', 'phase', 'receipt']);
	assert.equal(JSON.stringify(owner.getSnapshot()).includes('Exact original.png'), false);
	assert.ok(Object.isFrozen(acknowledgment)); assert.ok(Object.isFrozen(owner.getSnapshot()));
});

test('observers cannot veto ACKs and synchronous reentry sees registered pending ownership', async () => {
	const owner = new PhotoLibraryOriginalRecoveryV1(); const rejected: Promise<unknown>[] = []; let reentered = false;
	owner.subscribe(snapshot => {
		if (snapshot.phase === 'restoring' && !reentered) {
			reentered = true; rejected.push(assert.rejects(owner.startInspection({ inspectOriginals: async () => page() }), /pending/iu));
		}
		throw new Error('Observer failed');
	});
	assert.deepEqual(await owner.startRestore({ target, file: new Blob(['abc']), restoreOriginalBody: async () => receipt }), receipt);
	await Promise.all(rejected); assert.equal(reentered, true); assert.equal(owner.getSnapshot().receipt?.photoId, binding.photoId);
});

test('retired inspection callbacks cannot publish late pages and unsubscribed observers remain retired', async () => {
	const owner = new PhotoLibraryOriginalRecoveryV1(); const first = await owner.startInspection({ inspectOriginals: async () => page() });
	const entered = deferred<void>(), held = deferred<PhotoLibraryOriginalInspectionPageV1>(); let publications = 0;
	const unsubscribe = owner.subscribe(() => { publications++; });
	const pending = owner.startInspection({ inspectOriginals: async () => { entered.resolve(); return held.promise; } });
	await entered.promise; unsubscribe(); const before = publications; const closing = owner.cancelAndJoin();
	held.resolve({ ...page(), revision: 5 }); assert.deepEqual(await pending, { status: 'cancelled' }); await closing;
	assert.equal(owner.getSnapshot().page, first); assert.equal(publications, before);
	const stop = new AbortController(); stop.abort(); let called = false;
	await assert.rejects(owner.startInspection({ signal: stop.signal, inspectOriginals: async () => { called = true; return page(); } }), { name: 'AbortError' });
	assert.equal(called, false);
});

test('cancellation plus a distinct cleanup failure remains rejected and visible rather than cleanly cancelled', async () => {
	const owner = new PhotoLibraryOriginalRecoveryV1(), entered = deferred<void>(), held = deferred<void>();
	let failure: AggregateError | undefined;
	const work = owner.startRestore({ target, file: new Blob(['abc']), restoreOriginalBody: async (_target, _body, options) => {
		entered.resolve(); await held.promise;
		failure = new AggregateError([options?.signal?.reason as unknown, new Error('Discard failed')], 'Restore cleanup failed');
		throw failure;
	} });
	await entered.promise; const closing = owner.cancelAndJoin(); const refused = assert.rejects(work, error => error === failure);
	held.resolve(); await refused; await closing;
	assert.match(owner.getSnapshot().error ?? '', /Restore cleanup failed.*Discard failed/iu);
	assert.equal(owner.getSnapshot().receipt, null); assert.equal(owner.isPending(), false);
});

test('closed targets, request fields, genuine Blob size and native signals refuse before the restore port runs', async () => {
	let calls = 0, getters = 0;
	const accessor = Object.defineProperty({ ...target }, 'photoRevision', { enumerable: true, get() { getters++; return 2; } });
	const hidden = Object.defineProperty({ ...target }, 'hidden', { value: true });
	for (const value of [accessor, hidden, { ...target, extra: true }, { ...target, [Symbol('extra')]: true },
		{ ...target, schemaVersion: 2 }, { ...target, catalogRevision: -1 }, { ...target, photoRevision: Infinity },
		{ ...target, activeImportId: null }, { ...target, binding: { ...binding, extra: true } },
		Object.assign(Object.create({ inherited: true }) as object, target)]) {
		const owner = new PhotoLibraryOriginalRecoveryV1();
		await assert.rejects(owner.startRestore({ target: value as PhotoLibraryOriginalRestoreTargetV1,
			file: new Blob(['abc']), restoreOriginalBody: async () => { calls++; return receipt; } }));
		assert.equal(owner.isPending(), false);
	}
	const owner = new PhotoLibraryOriginalRecoveryV1(), restoreOriginalBody = async () => { calls++; return receipt; };
	await assert.rejects(owner.startRestore({ target, file: new Blob(['too-long']), restoreOriginalBody }));
	await assert.rejects(owner.startRestore({ target, file: { size: 3 } as Blob, restoreOriginalBody }));
	await assert.rejects(owner.startRestore({ target, file: new Blob(['abc']), restoreOriginalBody, extra: true } as Parameters<typeof owner.startRestore>[0]));
	const signal = new AbortController().signal; Object.defineProperty(signal, 'reason', { get() { getters++; return null; } });
	await assert.rejects(owner.startRestore({ target, file: new Blob(['abc']), restoreOriginalBody, signal }));
	assert.equal(calls, 0); assert.equal(getters, 0);
});

test('pages are detached, deeply frozen and reject invalid authority, sparse arrays and aggregate growth', async () => {
	const owner = new PhotoLibraryOriginalRecoveryV1(), raw = page();
	const result = await owner.startInspection({ inspectOriginals: async () => raw });
	assert.notEqual(result, raw); assert.ok(!('status' in result));
	if ('status' in result) throw new Error('Unexpected cancellation');
	assert.notEqual(result.rows, raw.rows); assert.ok(Object.isFrozen(result.rows[0]?.binding));
	assert.ok(Object.isFrozen(result.rows[0]?.inspection)); assert.ok(Object.isFrozen(result.startupFailure));
	Object.assign(raw.rows[0]!.binding, { name: 'Changed after publication.png' }); assert.equal(result.rows[0]?.binding.name, binding.name);
	for (const invalid of [{ ...page(), schemaVersion: 2 }, { ...page(), rows: Array(1) },
		{ ...page(), rows: Array.from({ length: 65 }, () => page().rows[0]) }, { ...page(), scanned: 0 },
		{ ...page(), rows: [{ ...page().rows[0], photoId: 'wrong-photo' }] },
		{ ...page(), rows: [{ ...page().rows[0], binding: { ...binding, catalogId: 'wrong-catalog' } }] },
		{ ...page(), activeImportId: null }, { ...page(), cursor: 'x'.repeat(2049) }, { ...page(), cursor: undefined },
		{ ...page(), startupFailure: { message: 'x'.repeat(2049) } }, { ...page(), extra: true }]) {
		await assert.rejects(owner.startInspection({ inspectOriginals: async () => invalid as PhotoLibraryOriginalInspectionPageV1 }));
		assert.equal(owner.getSnapshot().page, result);
	}
});

test('a malformed or mismatched restore acknowledgment never fabricates success even after cancellation', async () => {
	for (const invalid of [{ ...receipt, assetId: 'other' }, { ...receipt, photoId: 'other' }, { ...receipt, sha256: 'b'.repeat(64) },
		{ ...receipt, size: 4 }, { ...receipt, notices: ['future'] }, { ...receipt, notices: ['cleanup-failed', 'cleanup-failed'] },
		{ ...receipt, extra: new Blob(['abc']) }]) {
		const owner = new PhotoLibraryOriginalRecoveryV1(), entered = deferred<void>(), held = deferred<PhotoLibraryOriginalRestorationReceiptV1>();
		const work = owner.startRestore({ target, file: new Blob(['abc']), restoreOriginalBody: async () => { entered.resolve(); return held.promise; } });
		await entered.promise; const joined = owner.cancelAndJoin(); const rejected = assert.rejects(work);
		held.resolve(invalid as PhotoLibraryOriginalRestorationReceiptV1); await rejected; await joined;
		assert.equal(owner.getSnapshot().receipt, null); assert.ok(owner.getSnapshot().error);
	}
});

test('hostile descriptor admission cannot overwrite an operation admitted by synchronous reentry', async () => {
	const owner = new PhotoLibraryOriginalRecoveryV1(), held = deferred<PhotoLibraryOriginalInspectionPageV1>();
	let inner: Promise<unknown> | undefined, calls = 0;
	const request = new Proxy({ target, file: new Blob(['abc']), restoreOriginalBody: async () => { calls++; return receipt; } }, {
		getPrototypeOf() {
			inner ??= owner.startInspection({ inspectOriginals: async () => held.promise });
			return Object.prototype;
		},
	});
	await assert.rejects(owner.startRestore(request), /pending/iu);
	assert.equal(calls, 0); assert.equal(owner.getSnapshot().phase, 'inspecting');
	held.resolve(page()); await inner; assert.equal(owner.isPending(), false);
});

test('finalization observers cannot publish an obsolete idle snapshot into a reentrant operation', async () => {
	const owner = new PhotoLibraryOriginalRecoveryV1(), held = deferred<PhotoLibraryOriginalInspectionPageV1>();
	const publications: string[] = []; let next: Promise<unknown> | undefined, armed = false;
	owner.subscribe(snapshot => {
		if (armed && snapshot.phase === 'idle' && !next) next = owner.startInspection({ inspectOriginals: async () => held.promise });
	});
	owner.subscribe(snapshot => { publications.push(snapshot.phase); });
	armed = true;
	await owner.startRestore({ target, file: new Blob(['abc']), restoreOriginalBody: async () => receipt });
	assert.equal(owner.isPending(), true); assert.equal(owner.getSnapshot().phase, 'inspecting');
	assert.equal(publications.at(-1), 'inspecting'); held.resolve(page()); await next;
});

test('borrowed code cannot poison private native signal methods or getters to publish a cancelled page', async () => {
	const owner = new PhotoLibraryOriginalRecoveryV1(), entered = deferred<void>(), held = deferred<PhotoLibraryOriginalInspectionPageV1>();
	let getters = 0;
	const work = owner.startInspection({ inspectOriginals: async options => {
		assert.ok(options?.signal);
		Object.defineProperties(options.signal, {
			throwIfAborted: { get() { getters++; return () => undefined; } },
			aborted: { get() { getters++; return false; } },
			reason: { get() { getters++; throw new Error('Do not inspect shadowed reason'); } },
		});
		entered.resolve(); return held.promise;
	} });
	await entered.promise; const joined = owner.cancelAndJoin(); held.resolve(page());
	assert.deepEqual(await work, { status: 'cancelled' }); await joined;
	assert.equal(getters, 0); assert.equal(owner.getSnapshot().page, null);
});

test('external cancellation triggered by target admission refuses before invoking the borrowed restore port', async () => {
	const owner = new PhotoLibraryOriginalRecoveryV1(), stop = new AbortController(); let calls = 0;
	const hostile = new Proxy({ ...target }, { getPrototypeOf() { stop.abort(); return Object.prototype; } });
	await assert.rejects(owner.startRestore({ target: hostile, file: new Blob(['abc']), signal: stop.signal,
		restoreOriginalBody: async () => { calls++; return receipt; } }), error => error === stop.signal.reason);
	assert.equal(calls, 0); assert.equal(owner.isPending(), false); assert.equal(owner.getSnapshot().receipt, null);
});

test('independent subscriptions of the same listener retire only their own notification ownership', async () => {
	const owner = new PhotoLibraryOriginalRecoveryV1(); let events = 0;
	const listener = () => { events++; }, oldUnsubscribe = owner.subscribe(listener), liveUnsubscribe = owner.subscribe(listener);
	events = 0; oldUnsubscribe();
	await owner.startRestore({ target, file: new Blob(['abc']), restoreOriginalBody: async () => receipt });
	assert.ok(events > 0); liveUnsubscribe(); const previous = events;
	await owner.startInspection({ inspectOriginals: async () => page() }); assert.equal(events, previous);
});

test('native body admission reads no bytes or shadowed metadata and detaches exact authored target data', async () => {
	const owner = new PhotoLibraryOriginalRecoveryV1(), supplied = { ...target, binding: { ...binding, name: 'e\u0301.PNG' } };
	const file = new File(['abc'], 'Unrelated selected name.raw'); let traps = 0;
	for (const key of ['size', 'name', 'type', 'arrayBuffer', 'stream', 'slice']) Object.defineProperty(file, key, {
		get() { traps++; throw new Error('No body reads or borrowed property evaluation'); },
	});
	const work = owner.startRestore({ target: supplied, file, restoreOriginalBody: async (captured, body) => {
		assert.equal(body, file); assert.equal(captured.binding.name, 'e\u0301.PNG');
		assert.ok(Object.isFrozen(captured.binding)); return receipt;
	} });
	supplied.binding.name = 'Changed before port execution'; await work; assert.equal(traps, 0);
});

test('hostile rejected values preserve identity and cannot veto bounded diagnostics or settlement', async () => {
	const owner = new PhotoLibraryOriginalRecoveryV1();
	const failure = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('No error descriptors'); } });
	await assert.rejects(owner.startInspection({ inspectOriginals: async () => { throw failure; } }), error => error === failure);
	assert.equal(owner.isPending(), false); assert.equal(owner.getSnapshot().error, 'Original recovery failed.');
	const huge = new Error('x'.repeat(10_000));
	await assert.rejects(owner.startInspection({ inspectOriginals: async () => { throw huge; } }), error => error === huge);
	assert.equal(owner.getSnapshot().error?.length, 2048);
});

test('cancellation during returned-page descriptor admission cannot publish an otherwise valid page', async () => {
	const owner = new PhotoLibraryOriginalRecoveryV1(); let joined: Promise<void> | undefined;
	const hostile = new Proxy(page(), { getPrototypeOf() { joined ??= owner.cancelAndJoin(); return Object.prototype; } });
	assert.deepEqual(await owner.startInspection({ inspectOriginals: async () => hostile }), { status: 'cancelled' });
	await joined; assert.equal(owner.getSnapshot().page, null); assert.equal(owner.isPending(), false);
});
