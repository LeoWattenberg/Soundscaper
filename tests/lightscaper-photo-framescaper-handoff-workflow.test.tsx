/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React, { act } from 'react';
import { usePhotoLibraryWorkflowV2 } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow-v2.ts';
import type { CreatePhotoLibrarySessionV3 } from '../src/common/editor/photo-library-session-port-v2.ts';
import { seedCurrentAppPhoto, currentAppLocks } from './helpers/lightscaper-current-app-fixture.tsx';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
async function fixture() {
	const native = mediaRestoreFixture(), seeded = await seedCurrentAppPhoto(native.factory, currentAppLocks());
	const events: string[] = []; let factory: CreatePhotoLibrarySessionV3 = async () => {
		const owner = await seeded.createSession(), close = owner.close.bind(owner);
		owner.close = async () => { events.push('close'); await close(); }; return owner;
	};
	let current: ReturnType<typeof usePhotoLibraryWorkflowV2> | undefined;
	function Harness() { current = usePhotoLibraryWorkflowV2(factory); return null; }
	const mounted = await mountPhotoImportUi(() => <Harness />);
	const read = () => { assert.ok(current); return current; };
	await act(async () => { await read().readPage(); });
	return { ...mounted, seeded, events, read, async replace() { factory = () => seeded.createSession(); await mounted.render(); } };
}
test('actual selected Session hands off only its active saved binding and scoped unchanged original', async () => {
	const f = await fixture();
	try {
		const target = await f.read().captureImageHandoff()('current-photo', new AbortController().signal);
		assert.deepEqual(target.binding, { catalogId: f.seeded.photo.catalogId, photoId: f.seeded.photo.id, versionId: 'master', expectedRevision: 0 });
		assert.ok(Object.isFrozen(target));
		await target.checkCurrent(new AbortController().signal);
		assert.equal(await target.capture.withCapture(target.binding, async view => {
			assert.equal(view.original.exactName, 'Current.png'); assert.deepEqual([...new Uint8Array(await view.originalBlob.arrayBuffer())], [1, 2, 3]); return 'joined';
		}), 'joined');
		assert.equal(f.read().page?.rows[0]?.fileName, 'Current.png');
	} finally { await f.dispose(); }
});
test('real same-generation revision or active-version mutation refuses the previously prepared binding', async () => {
	const f = await fixture();
	try {
		const target = await f.read().captureImageHandoff()('current-photo', new AbortController().signal);
		await act(async () => { assert.equal(await f.read().executeDevelop(async context => {
			const owner = await context.acquire();
			await owner.apply({ schemaVersion: 2, photoId: 'current-photo', expectedRevision: 0,
				command: { type: 'create-virtual-copy', id: 'copy', name: 'Copy', createdAt: '2026-10-10T00:00:00.000Z', sourceVersionId: 'master' } }, { signal: context.signal });
		}), 'completed'); });
		await assert.rejects(target.checkCurrent(new AbortController().signal), /saved photo changed/u);
		let consumed = false;
		await assert.rejects(target.capture.withCapture(target.binding, () => { consumed = true; })); assert.equal(consumed, false);
	} finally { await f.dispose(); }
});
test('captured handoff preparation never borrows a replacement catalog generation', async () => {
	const f = await fixture(), prepare = f.read().captureImageHandoff();
	try { await f.replace(); await assert.rejects(prepare('current-photo', new AbortController().signal), { name: 'AbortError' }); }
	finally { await f.dispose(); }
});
test('actual generation retirement joins admitted consumer and destination before closing original resources', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
	const target = await f.read().captureImageHandoff()('current-photo', new AbortController().signal);
	const work = target.capture.withCapture(target.binding, async () => { entered.resolve(); await release.promise; });
	const refusal = assert.rejects(work); f.read().registerExportDestination(async () => { await work.catch(() => undefined); });
	try {
		await entered.promise; const closing = f.read().retireAndJoin(); assert.equal(await remainsPending(closing), true); assert.equal(f.events.includes('close'), false);
		release.resolve(); await refusal; await closing; await settle(); assert.deepEqual(f.events, ['close']);
	} finally { release.resolve(); await f.dispose(); }
});
