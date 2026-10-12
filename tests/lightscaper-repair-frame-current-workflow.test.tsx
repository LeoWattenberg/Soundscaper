/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import { usePhotoLibraryWorkflowCurrentV1 } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow-current-v1.ts';
import { createPhotoDevelopRenderRuntimeV3 } from '../src/lightscaper/photo-develop-render-runtime-v3.ts';
import { parsePhotoExportSidecarCurrentV1 } from '../src/lightscaper/catalog/photo-export-sidecar-current-v1.ts';
import { repairFrameHandoffFixture, observed, readRepairFrameEntries } from './helpers/lightscaper-repair-frame-handoff-current-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

type Workflow = ReturnType<typeof usePhotoLibraryWorkflowCurrentV1>;
async function fixture(placement: 'active' | 'redo' = 'active') {
	const native = await repairFrameHandoffFixture(placement), factory = async () => native.session;
	const renderer = async () => createPhotoDevelopRenderRuntimeV3({ source: native.session.cubeLuts.source, maskSource: native.session.maskRasterSource });
	let value: Workflow | undefined;
	function Harness() { value = usePhotoLibraryWorkflowCurrentV1(factory, undefined, renderer); return null; }
	const mounted = await mountPhotoImportUi(() => <StrictMode><Harness /></StrictMode>);
	const current = () => { assert.ok(value); return value; };
	await act(async () => { await current().readPage(); });
	return { ...native, current, async dispose() { try { await mounted.dispose(); } finally { await native.close(); } } };
}

for (const placement of ['active', 'redo'] as const) test(`Current menu workflow captures full Photo3 with ${placement} repairs through its pinned named child`, async () => {
	const f = await fixture(placement), handoff = f.session.imageHandoffCurrent!;
	const original = handoff.withCapture; let calls = 0;
	const pinned = { withCapture: function <Result>(this: unknown, ...args: Parameters<typeof original<Result>>) {
		assert.equal(this, pinned); calls++; return Reflect.apply(original, handoff, args) as Promise<Result>;
	} };
	Object.defineProperty(f.session, 'imageHandoffCurrent', { configurable: true, value: pinned });
	Object.defineProperty(f.session, 'imageHandoff', { configurable: true, get() { assert.fail('Current menu captured legacy handoff.'); } });
	try {
		const before = await f.catalog.loadPhoto(f.photo.catalogId, f.photo.id);
		const target = await f.current().captureImageHandoff()(f.photo.id, new AbortController().signal);
		assert.equal(target.schemaVersion, 2); assert.deepEqual(target.binding, f.binding);
		pinned.withCapture = () => { assert.fail('Prepared menu handoff reread a replaced child method.'); };
		await target.checkCurrent(new AbortController().signal);
		await target.capture.withCapture(target.binding, view => {
			assert.equal(view.schemaVersion, 2); const facts = parsePhotoExportSidecarCurrentV1(view.factsJson);
			assert.equal(facts.schemaVersion, 2); assert.deepEqual(facts.version.develop, f.version.develop);
			assert.equal(facts.version.develop.processVersion, placement === 'active' ? 3 : 1);
		});
		assert.equal(calls, 1); assert.deepEqual(await f.catalog.loadPhoto(f.photo.catalogId, f.photo.id), before);
	} finally { await f.dispose(); }
});

test('Current prepared menu handoff refuses actual saved revision changes', async () => {
	const f = await fixture();
	try {
		const target = await f.current().captureImageHandoff()(f.photo.id, new AbortController().signal);
		await act(async () => { await f.current().setRating(f.photo.id, 1); });
		await assert.rejects(target.checkCurrent(new AbortController().signal), /saved photo changed/u);
		let entered = false;
		await assert.rejects(target.capture.withCapture(target.binding, () => { entered = true; }));
		assert.equal(entered, false);
	} finally { await f.dispose(); }
});

test('Current menu retirement joins an admitted original borrower and retires the prepared capture', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
	const target = await f.current().captureImageHandoff()(f.photo.id, new AbortController().signal);
	const work = observed(target.capture.withCapture(target.binding, async () => { entered.resolve(); await release.promise; }));
	const unregister = f.current().registerExportDestination(async () => { await work; });
	try {
		assert.equal(await Promise.race([entered.promise.then(() => true), work.then(() => false)]), true);
		const closing = f.current().retireAndJoin(); assert.equal(await remainsPending(closing), true);
		release.resolve(); assert.equal((await work).ok, false); await closing;
		await assert.rejects(target.checkCurrent(new AbortController().signal), { name: 'AbortError' });
	} finally { release.resolve(); await work; unregister(); await f.dispose(); }
});

test('Current menu receive retains an actual native Photo3 ACK after late caller cancellation', async () => {
	const f = await fixture(), archive = await f.archive(), entries = await readRepairFrameEntries(archive.blob);
	const source = (JSON.parse(new TextDecoder().decode(entries.get('project.json'))) as { sources: { id: string }[] }).sources[0]!;
	const port = f.session.imageReceiveCurrent!, receive = port.receive, entered = deferred<void>(), release = deferred<void>();
	const pinned = { async receive(this: unknown, ...args: Parameters<typeof receive>) {
		assert.equal(this, pinned); const ack = await Reflect.apply(receive, port, args) as Awaited<ReturnType<typeof receive>>;
		assert.equal(ack.schemaVersion, 2); entered.resolve(); await release.promise; return ack;
	} };
	Object.defineProperty(f.session, 'imageReceiveCurrent', { configurable: true, value: pinned });
	Object.defineProperty(f.session, 'imageReceive', { configurable: true, get() { assert.fail('Current menu borrowed legacy receive.'); } });
	const captured = f.current().captureImageReceive(), caller = new AbortController(), reason = Symbol('late menu cancellation');
	assert.equal(captured.schemaVersion, 2);
	let pending: ReturnType<typeof observed<Awaited<ReturnType<typeof captured.receive>>>> | undefined;
	try {
		await act(async () => {
			pending = observed(captured.receive({ archive: archive.blob, sourceId: source.id }, caller.signal));
			assert.equal(await Promise.race([entered.promise.then(() => true), pending.then(() => false)]), true);
			caller.abort(reason); assert.equal(await remainsPending(pending), true); release.resolve(); await pending;
		});
		assert.ok(pending); const outcome = await pending; assert.equal(outcome.ok, true);
		assert.equal(outcome.value.receipt.schemaVersion, 2); assert.equal(outcome.value.refresh, 'failed');
		assert.ok(Object.is(outcome.value.failure, reason));
		const received = await f.catalog.loadPhoto(f.photo.catalogId, outcome.value.receipt.photoId);
		assert.ok(received); assert.equal(received.schemaVersion, 3); assert.notEqual(received.id, f.photo.id);
		assert.deepEqual(received.versions[0]!.develop, f.version.develop);
	} finally { release.resolve(); await pending; await f.dispose(); }
});
