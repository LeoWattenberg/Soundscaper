/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { acquirePhotoLibraryWorkflowSlotV2, loadPhotoLibraryDevelopProxyV2, retirePhotoLibraryWorkflowSlotV2,
	type PhotoLibraryWorkflowSlotV2 } from '../src/common/editor/controller/shared/photo-library-workflow-slot-v2.ts';
import type { PhotoLibrarySessionPortV2 } from '../src/common/editor/photo-library-session-port-v2.ts';
import type { CreatePhotoLibraryDevelopProxyRuntimeV2 } from '../src/common/editor/photo-library-develop-proxy-port-v2.ts';
import { createPhotoLibrarySessionV3 } from '../src/lightscaper/photo-library-session-runtime-v3.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { MemoryLockManager } from './helpers/offline-browser-runtime-store-fixture.ts';
import { LUT_BODY, LUT_REFERENCE } from './helpers/lightscaper-lut-archive-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
function selected(factory: () => Promise<PhotoLibrarySessionPortV2>, proxyFactory?: CreatePhotoLibraryDevelopProxyRuntimeV2): PhotoLibraryWorkflowSlotV2 {
	return { live: true, factory, proxyFactory, backupLoader: undefined, lifetime: new AbortController(), beforeDrain: null,
		pending: null, active: null, query: null, savedCollectionId: null, stackCollapsed: false, page: null, batchRenamePlanner: null,
		backupRuntime: null, backupLoading: null, proxyPending: null, closeOwner: null, retirement: null };
}
function nativeOwner() {
	const f = mediaRestoreFixture();
	return createPhotoLibrarySessionV3({ name: 'Selected', indexedDB: f.factory, locks: new MemoryLockManager() as unknown as LockManager });
}

test('selected current render binding is lazy, shared and reads immutable LUT bytes from its actual Session', async () => {
	const session = await nativeOwner(); let opens = 0, renderers = 0;
	await session.cubeLuts.importFile(new File([LUT_BODY], 'Profile.cube'));
	const slot = selected(async () => { opens++; return session; }, async source => {
		renderers++; await source.withBytes(LUT_REFERENCE, bytes => assert.deepEqual(bytes, LUT_BODY));
		return createPhotoDevelopRenderRuntimeV2({ source });
	});
	try {
		assert.equal(opens, 0); assert.equal(renderers, 0);
		const first = loadPhotoLibraryDevelopProxyV2(slot), second = loadPhotoLibraryDevelopProxyV2(slot);
		assert.equal(first, second); assert.equal(await first, await second); assert.equal(opens, 1); assert.equal(renderers, 1);
		assert.equal((await acquirePhotoLibraryWorkflowSlotV2(slot)).develop.schemaVersion, 2);
	} finally { await retirePhotoLibraryWorkflowSlotV2(slot, async () => undefined); }
	await assert.rejects(loadPhotoLibraryDevelopProxyV2(slot), { name: 'AbortError' });
});

test('retirement fences immediately and joins a held selected-source factory and actual native close', async () => {
	const session = await nativeOwner(), entered = deferred<void>(), release = deferred<void>();
	const slot = selected(async () => session, async source => { entered.resolve(); await release.promise; return createPhotoDevelopRenderRuntimeV2({ source }); });
	const loading = loadPhotoLibraryDevelopProxyV2(slot), result = loading.then(() => null, error => ({ error: error as unknown }));
	try {
		await entered.promise;
		const closing = retirePhotoLibraryWorkflowSlotV2(slot, async () => undefined);
		assert.equal(retirePhotoLibraryWorkflowSlotV2(slot, async () => assert.fail('No second drain')), closing);
		assert.equal(slot.live, false); assert.equal(slot.lifetime.signal.aborted, true); await remainsPending(closing);
		await assert.rejects(session.readPage(), /closed/u);
		release.resolve(); await result; await closing;
	} finally { release.resolve(); await result; await retirePhotoLibraryWorkflowSlotV2(slot, async () => undefined); }
});

test('a replacement selected library waits for all predecessor cleanup and preserves its failure barrier', async () => {
	const first = await nativeOwner(), second = await nativeOwner(), release = deferred<void>(); let opens = 0;
	const old = selected(async () => first); await acquirePhotoLibraryWorkflowSlotV2(old);
	const failure = new Error('Presentation cleanup failed');
	const closing = retirePhotoLibraryWorkflowSlotV2(old, async () => { await release.promise; throw failure; }); void closing.catch(() => undefined);
	const next = { ...selected(async () => { opens++; return second; }), beforeDrain: closing };
	const opening = acquirePhotoLibraryWorkflowSlotV2(next); void opening.catch(() => undefined);
	try { await remainsPending(opening); assert.equal(opens, 0); release.resolve(); await assert.rejects(opening, error => error === failure); assert.equal(opens, 0); }
	finally { release.resolve(); await closing.catch(() => undefined); await retirePhotoLibraryWorkflowSlotV2(next, async () => undefined).catch(() => undefined); await second.close(); }
});

test('retirement owns an already admitted factory resolving late and closes its current owner once', async () => {
	const session = await nativeOwner(), release = deferred<PhotoLibrarySessionPortV2>();
	const slot = selected(() => release.promise), opening = acquirePhotoLibraryWorkflowSlotV2(slot);
	await Promise.resolve();
	const closing = retirePhotoLibraryWorkflowSlotV2(slot, async () => undefined);
	try { await remainsPending(closing); release.resolve(session); assert.equal(await opening, session); await closing; await assert.rejects(session.readPage(), /closed/u); }
	finally { release.resolve(session); await closing; }
});
