/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import type { PhotoLibraryBatchRenamePortV1, PhotoLibraryBatchRenameReceiptV1 } from '../src/common/editor/photo-library-batch-rename-port-v1.ts';
import type { CreatePhotoLibrarySessionCurrentV1, PhotoLibrarySessionPortCurrentV1 } from '../src/common/editor/photo-library-session-port-current-v1.ts';
import { usePhotoLibraryWorkflowCurrentV1 } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow-current-v1.ts';
import { capturePhotoLibraryBatchRenameCurrentV1 } from '../src/common/editor/ui/lightscaper/photo-library-workflow-batch-rename-current-v1.ts';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { repairSettingsFixture } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, settle } from './helpers/async-test-control.ts';

type Workflow = ReturnType<typeof usePhotoLibraryWorkflowCurrentV1>;
type CurrentWithRename = PhotoLibrarySessionPortCurrentV1 & { readonly batchRenameCurrent?: Readonly<PhotoLibraryBatchRenamePortV1> };
const rename = Object.freeze({ template: 'Renamed-{sequence}.{extension}', sequenceStart: 11, sequencePadding: 2 });

async function mountWorkflow(initial: CreatePhotoLibrarySessionCurrentV1) {
	let factory = initial, view: Workflow | undefined;
	function Harness() { view = usePhotoLibraryWorkflowCurrentV1(factory); return null; }
	const mounted = await mountPhotoImportUi(() => <StrictMode><Harness /></StrictMode>);
	const current = () => { assert.ok(view); return view; };
	return { current,
		async replace(next: CreatePhotoLibrarySessionCurrentV1) { factory = next; await mounted.render(); },
		async dispose() { try { await current().retireAndJoin(); } finally { await mounted.dispose(); } },
	};
}
function nativeChild(session: PhotoLibrarySessionPortCurrentV1): Readonly<PhotoLibraryBatchRenamePortV1> {
	const child = (session as CurrentWithRename).batchRenameCurrent;
	assert.ok(child, 'The actual selected Current Session must provide its named batch rename capability.'); return child;
}
function installChild(session: PhotoLibrarySessionPortCurrentV1, value: unknown) {
	Object.defineProperty(session, 'batchRenameCurrent', { configurable: true, value });
}
async function capture(mounted: Awaited<ReturnType<typeof mountWorkflow>>, photoId: string) {
	await act(async () => { await mounted.current().readPage(); await mounted.current().readBatchRenameSelection([photoId]); });
	const snapshot = mounted.current().batchRenameSnapshot;
	assert.ok(snapshot, 'The actual Current hook must capture the repaired Photo3 selection.');
	return mounted.current().planBatchRename({ ...snapshot, rename });
}

test('Current capability capture preserves the exact opaque pre-abort reason before observing the Session', () => {
	const { proxy: reason, revoke } = Proxy.revocable({}, {}); revoke(); const controller = new AbortController(); controller.abort(reason);
	let observed = 0; const owner = new Proxy({}, { getOwnPropertyDescriptor() { observed++; assert.fail('A pre-abort must precede capability observation.'); } });
	try { capturePhotoLibraryBatchRenameCurrentV1(owner, controller.signal); assert.fail('An aborted Current capability must refuse.'); }
	catch (error) { assert.equal(Object.is(error, reason), true); }
	assert.equal(observed, 0);
});

test('actual Current workflow renames, preserves a no-op inverse and restores repaired Photo3 through the selected native Session', async () => {
	const f = await repairSettingsFixture(1); let opens = 0;
	const mounted = await mountWorkflow(async () => { opens++; return f.session; });
	try {
		assert.equal(opens, 0); const initial = (await f.inspect())[0]!; assert.equal(initial.photo.schemaVersion, 3);
		const plan = await capture(mounted, f.photos[0]!.id); assert.equal(opens, 1);
		assert.equal(plan.items[0]!.expectedRevision, initial.photo.revision);
		await act(async () => {
			const result = await mounted.current().renamePhotos(plan); assert.equal(result.outcome, 'acknowledged');
			if (result.outcome === 'acknowledged') { assert.equal(result.notice, null); assert.equal(result.receipt.items[0]!.status, 'renamed'); }
		});
		const inverse = mounted.current().batchRenameUndo; assert.ok(inverse);
		let saved = (await f.inspect())[0]!;
		assert.equal(saved.photo.metadata.fileName, plan.items[0]!.fileName); assert.equal(saved.photo.revision, initial.photo.revision + 1);
		assert.equal(saved.photo.schemaVersion, 3); assert.deepEqual(saved.photo.versions, initial.photo.versions);
		assert.deepEqual(saved.photo.original, initial.photo.original); assert.deepEqual(saved.bytes, initial.bytes);
		await act(async () => { await mounted.current().readBatchRenameSelection([saved.photo.id]); });
		const snapshot = mounted.current().batchRenameSnapshot; assert.ok(snapshot);
		const unchanged = mounted.current().planBatchRename({ ...snapshot, rename: { template: '{stem}.{extension}', sequenceStart: 1, sequencePadding: 1 } });
		await act(async () => {
			const result = await mounted.current().renamePhotos(unchanged); assert.equal(result.outcome, 'acknowledged');
			if (result.outcome === 'acknowledged') assert.equal(result.receipt.items[0]!.status, 'unchanged');
		});
		assert.equal(mounted.current().batchRenameUndo, inverse); assert.equal((await f.inspect())[0]!.photo.revision, saved.photo.revision);
		await act(async () => { const result = await mounted.current().undoBatchRename(inverse); assert.equal(result.outcome, 'acknowledged');
			if (result.outcome === 'acknowledged') assert.equal(result.receipt.items[0]!.status, 'restored'); });
		assert.equal(mounted.current().batchRenameUndo, null); saved = (await f.inspect())[0]!;
		assert.equal(saved.photo.metadata.fileName, initial.photo.metadata.fileName); assert.equal(saved.photo.revision, initial.photo.revision + 2);
		assert.deepEqual(saved.photo.versions, initial.photo.versions); assert.deepEqual(saved.photo.original, initial.photo.original);
		assert.deepEqual(saved.bytes, initial.bytes); assert.equal(opens, 1);
	} finally { await mounted.dispose(); await f.close(); }
});

test('Current rename retains its exact native durable ACK and inverse before a held refresh, then reports refresh failure', async () => {
	const f = await repairSettingsFixture(1), mounted = await mountWorkflow(async () => f.session);
	const entered = deferred<void>(), refresh = deferred<never>(); let observed: PhotoLibraryBatchRenameReceiptV1 | undefined;
	void refresh.promise.catch(() => undefined);
	let work: ReturnType<Workflow['renamePhotos']> | undefined;
	try {
		const plan = await capture(mounted, f.photos[0]!.id), child = nativeChild(f.session), write = child.renamePhotos;
		const observer = { ...child, async renamePhotos(...args: Parameters<typeof write>) {
			assert.equal(this, observer); observed = await Reflect.apply(write, child, args) as PhotoLibraryBatchRenameReceiptV1; return observed;
		} }; installChild(f.session, observer);
		Object.defineProperty(f.session, 'readPage', { configurable: true, value: () => { entered.resolve(); return refresh.promise; } });
		await act(async () => { work = mounted.current().renamePhotos(plan); await settle(); });
		assert.ok(work); assert.equal(await Promise.race([entered.promise.then(() => true), work.then(() => false)]), true);
		await act(async () => { await settle(); });
		assert.ok(observed); assert.equal(mounted.current().batchRenameReceipt?.receipt, observed);
		assert.equal(mounted.current().batchRenameUndo, observed.undo); assert.equal(mounted.current().page?.cursor, null);
		assert.equal(mounted.current().page?.rows[0]!.fileName, plan.items[0]!.fileName);
		await act(async () => { refresh.reject(new Error('Native refresh unavailable')); const result = await work;
			assert.equal(result?.outcome, 'acknowledged'); if (result?.outcome === 'acknowledged') {
				assert.equal(result.receipt, observed); assert.equal(result.notice, 'refresh-failed');
			} });
		assert.equal((await f.inspect())[0]!.photo.metadata.fileName, plan.items[0]!.fileName);
	} finally { refresh.reject(new Error('Test retirement')); await work?.catch(() => undefined); await mounted.dispose(); await f.close(); }
});

test('Current selection refuses absent, partial and accessor capabilities without invoking permanent scalar methods or coercion', async () => {
	const f = await repairSettingsFixture(1), mounted = await mountWorkflow(async () => f.session);
	let legacyCalls = 0, childCalls = 0, getters = 0, coercions = 0;
	const full: PhotoLibraryBatchRenamePortV1 = {
		readBatchRenameSelection() { childCalls++; assert.fail('Malformed capability must refuse before native work.'); },
		planBatchRename() { childCalls++; assert.fail('Malformed capability must refuse before planning.'); },
		renamePhotos() { childCalls++; assert.fail('Malformed capability must refuse before a write.'); },
		undoBatchRename() { childCalls++; assert.fail('Malformed capability must refuse before an undo.'); },
	};
	for (const key of ['readBatchRenameSelection', 'planBatchRename', 'renamePhotos', 'undoBatchRename']) {
		Object.defineProperty(f.session, key, { configurable: true, value: () => { legacyCalls++; assert.fail('Current must not fall back to permanent scalar methods.'); } });
	}
	const coercible = { [Symbol.toPrimitive]() { coercions++; return 'callable'; } };
	const getter = Object.defineProperty({ ...full }, 'undoBatchRename', { get() { getters++; return full.undoBatchRename; } });
	try {
		for (const child of [undefined, {}, { readBatchRenameSelection: full.readBatchRenameSelection }, { ...full, renamePhotos: coercible }, getter]) {
			installChild(f.session, child);
			await act(async () => { await mounted.current().readBatchRenameSelection([f.photos[0]!.id]); });
			assert.equal(mounted.current().batchRenameSnapshot, null); assert.ok(mounted.current().error);
		}
		Object.defineProperty(f.session, 'batchRenameCurrent', { configurable: true, get() { getters++; return full; } });
		await act(async () => { await mounted.current().readBatchRenameSelection([f.photos[0]!.id]); });
		assert.equal(mounted.current().batchRenameSnapshot, null); assert.ok(mounted.current().error);
		assert.equal(legacyCalls, 0); assert.equal(childCalls, 0); assert.equal(getters, 0); assert.equal(coercions, 0);
	} finally { await mounted.dispose(); await f.close(); }
});

test('Current selection pins all child methods and their receiver before its actual asynchronous native read', async () => {
	const f = await repairSettingsFixture(1), entered = deferred<void>(), release = deferred<void>();
	const mounted = await mountWorkflow(async () => f.session); let work: Promise<void> | undefined, plans = 0;
	try {
		const child = nativeChild(f.session), read = child.readBatchRenameSelection, plan = child.planBatchRename;
		const observer = { ...child,
			async readBatchRenameSelection(...args: Parameters<typeof read>) {
				assert.equal(this, observer); const snapshot = await Reflect.apply(read, child, args) as Awaited<ReturnType<typeof read>>;
				entered.resolve(); await release.promise; return snapshot;
			},
			planBatchRename(...args: Parameters<typeof plan>) { assert.equal(this, observer); plans++; return Reflect.apply(plan, child, args) as ReturnType<typeof plan>; },
		}; installChild(f.session, observer);
		const ids = [f.photos[0]!.id];
		await act(async () => { work = mounted.current().readBatchRenameSelection(ids); await settle(); });
		assert.ok(work); assert.equal(await Promise.race([entered.promise.then(() => true), work.then(() => false)]), true); ids.length = 0;
		observer.planBatchRename = () => assert.fail('A retained selection must use its admission-time planner.');
		installChild(f.session, { ...child, planBatchRename: () => assert.fail('The selected child must not be looked up after its read yields.') });
		await act(async () => { release.resolve(); await work; });
		const snapshot = mounted.current().batchRenameSnapshot; assert.ok(snapshot);
		assert.equal(snapshot.selection[0]!.photoId, f.photos[0]!.id);
		const admitted = mounted.current().planBatchRename({ ...snapshot, rename }); assert.equal(admitted instanceof Promise, false);
		assert.equal(admitted.items[0]!.sourceFileName, f.photos[0]!.metadata.fileName); assert.equal(plans, 1);
	} finally { release.resolve(); await work?.catch(() => undefined); await mounted.dispose(); await f.close(); }
});

test('Current replacement closes the actual selected Session and refuses retained rename and planner callbacks', async () => {
	const f = await repairSettingsFixture(1), mounted = await mountWorkflow(async () => f.session); let closes = 0;
	try {
		const close = f.session.close; Object.defineProperty(f.session, 'close', { configurable: true, value: function () {
			closes++; return Reflect.apply(close, f.session, []) as Promise<void>;
		} });
		const plan = await capture(mounted, f.photos[0]!.id), staleRename = mounted.current().renamePhotos, stalePlan = mounted.current().planBatchRename;
		await mounted.replace(() => createPhotoLibrarySessionCurrentV1(f.options));
		await act(async () => { assert.equal((await staleRename(plan)).outcome, 'cancelled'); await mounted.current().readPage(); });
		assert.throws(() => stalePlan({ schemaVersion: 1, catalogId: plan.catalogId, selection: [], rename }), { name: 'AbortError' });
		assert.equal(mounted.current().batchRenameReceipt, null); assert.equal(mounted.current().batchRenameUndo, null);
		assert.equal(mounted.current().page?.rows[0]!.fileName, f.photos[0]!.metadata.fileName);
		assert.equal(closes, 1); assert.equal((await f.inspect())[0]!.photo.revision, f.photos[0]!.revision);
	} finally { await mounted.dispose(); await f.close(); }
});
