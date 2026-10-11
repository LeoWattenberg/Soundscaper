/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React, { act } from 'react';
import { usePhotoLibraryWorkflowV2 } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow-v2.ts';
import { createPhotoLibrarySessionV3 } from '../src/lightscaper/photo-library-session-runtime-v3.ts';
import type { CreatePhotoLibrarySessionV3 } from '../src/common/editor/photo-library-session-port-v2.ts';
import { MemoryLockManager } from './helpers/offline-browser-runtime-store-fixture.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';

const priorRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (priorRange) Object.defineProperty(globalThis, 'IDBKeyRange', priorRange); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });

async function fixture() {
	const native = mediaRestoreFixture(), events: string[] = [];
	const create: CreatePhotoLibrarySessionV3 = async () => {
		events.push('open'); const owner = await createPhotoLibrarySessionV3({ name: 'Export library', indexedDB: native.factory, locks: new MemoryLockManager() as unknown as LockManager });
		const close = owner.close.bind(owner); owner.close = async () => { events.push('original-close'); await close(); }; return owner;
	};
	let factory = create, current: ReturnType<typeof usePhotoLibraryWorkflowV2> | undefined;
	function Harness() { current = usePhotoLibraryWorkflowV2(factory); return null; }
	const mounted = await mountPhotoImportUi(() => <Harness />);
	return { ...mounted, events, get current() { assert.ok(current); return current; },
		async replace() { factory = () => create(); await mounted.render(); } };
}

test('explicit restore retirement joins the PNG destination before the original owner closes', async () => {
	const f = await fixture(), drain = deferred<void>(); let cancels = 0;
	try {
		await act(async () => { await f.current.readPage(); }); assert.equal(f.current.error, null);
		f.current.registerExportDestination(() => { cancels++; return drain.promise; });
		const closing = f.current.retireAndJoin(); assert.equal(cancels, 1);
		assert.equal(await remainsPending(closing), true); assert.equal(f.events.includes('original-close'), false);
		drain.resolve(); await closing; assert.equal(f.events.at(-1), 'original-close');
	} finally { drain.resolve(); await f.dispose(); }
});

test('generation replacement fences old export registration and waits for destination cleanup before opening originals', async () => {
	const f = await fixture(), drain = deferred<void>(); let cancels = 0;
	try {
		await act(async () => { await f.current.readPage(); }); assert.equal(f.current.error, null);
		const registerOld = f.current.registerExportDestination;
		registerOld(() => { cancels++; return drain.promise; });
		await f.replace(); assert.equal(cancels, 1);
		assert.throws(() => registerOld(async () => undefined), { name: 'AbortError' });
		let reading: Promise<void> | undefined;
		await act(async () => { reading = f.current.readPage(); await settle(); });
		assert.equal(f.events.filter(event => event === 'open').length, 1); assert.equal(f.events.includes('original-close'), false);
		drain.resolve(); await act(async () => { await reading; });
		assert.deepEqual(f.events.slice(0, 3), ['open', 'original-close', 'open']);
	} finally { drain.resolve(); await f.dispose(); }
});

test('dialog unregister preserves its held cleanup for the following library unmount', async () => {
	const f = await fixture(), drain = deferred<void>(); let cancels = 0;
	await act(async () => { await f.current.readPage(); }); assert.equal(f.current.error, null);
	const unregister = f.current.registerExportDestination(() => { cancels++; return drain.promise; });
	unregister(); unregister(); assert.equal(cancels, 1);
	await f.dispose(); assert.equal(f.events.includes('original-close'), false);
	drain.resolve(); await f.current.retireAndJoin(); assert.equal(f.events.at(-1), 'original-close');
});
