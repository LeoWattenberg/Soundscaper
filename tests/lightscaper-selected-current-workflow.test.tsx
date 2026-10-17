/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React, { act, StrictMode } from 'react';
import { usePhotoLibraryWorkflowCurrentV1 } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow-current-v1.ts';
import { acquirePhotoLibraryWorkflowSlotCurrentV1, loadPhotoLibraryDevelopProxyCurrentV1, retirePhotoLibraryWorkflowSlotCurrentV1,
	type PhotoLibraryWorkflowSlotCurrentV1 } from '../src/common/editor/controller/shared/photo-library-workflow-slot-current-v1.ts';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { createPhotoDevelopRenderRuntimeV3 } from '../src/lightscaper/photo-develop-render-runtime-v3.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import type { CreatePhotoLibrarySessionCurrentV1 } from '../src/common/editor/photo-library-session-port-current-v1.ts';
import type { CreatePhotoLibraryDevelopProxyRuntimeV3 } from '../src/common/editor/photo-library-develop-proxy-port-v3.ts';
import { seedCurrentAppPhoto, currentAppLocks } from './helpers/lightscaper-current-app-fixture.tsx';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const TIME = '2026-10-11T00:00:00.000Z';
async function fixture() {
	const native = mediaRestoreFixture(), locks = currentAppLocks(), seeded = await seedCurrentAppPhoto(native.factory, locks);
	return { ...seeded, open: () => createPhotoLibrarySessionCurrentV1(seeded.options) };
}
function slot(factory: CreatePhotoLibrarySessionCurrentV1, renderer: CreatePhotoLibraryDevelopProxyRuntimeV3): PhotoLibraryWorkflowSlotCurrentV1 {
	return { live: true, factory, proxyFactory: renderer, proxyPending: null, closeOwner: null, backupLoader: undefined,
		lifetime: new AbortController(), beforeDrain: null, pending: null, active: null, query: null, savedCollectionId: null,
		stackCollapsed: false, page: null, batchRenamePlanner: null, backupRuntime: null, backupLoading: null, retirement: null };
}
function outcome<Value>(work: Promise<Value>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }

test('Current selected hook stays cold in StrictMode and publishes actual native repair ACK through one cached Session', async () => {
	const f = await fixture(); let opens = 0, renders = 0, view: ReturnType<typeof usePhotoLibraryWorkflowCurrentV1> | null = null;
	const factory = async () => { opens++; return f.open(); }, renderer: CreatePhotoLibraryDevelopProxyRuntimeV3 = async (source, maskSource) => {
		renders++; return createPhotoDevelopRenderRuntimeV3({ source, ...(maskSource ? { maskSource } : {}) });
	};
	function Harness() { view = usePhotoLibraryWorkflowCurrentV1(factory, undefined, renderer); return null; }
	const mounted = await mountPhotoImportUi(() => <StrictMode><Harness /></StrictMode>);
	const current = () => { assert.ok(view); return view; };
	try {
		assert.equal(opens, 0); assert.equal(renders, 0);
		await act(async () => { await current().readPage(); }); assert.equal(current().page?.rows[0]?.id, f.photo.id); assert.equal(opens, 1);
		await act(async () => { await current().executeDevelop(async context => {
			const owner = await context.acquire(), original = await owner.read({ schemaVersion: 3, photoId: f.photo.id }, { signal: context.signal });
			const develop = replaceImageDevelopRepairSpotsV1(original.develop, { schemaVersion: 1, spots: [{ id: 'clone', mode: 'clone', enabled: false,
				target: { x: 0.75, y: 0.5 }, source: { x: 0.25, y: 0.5 }, radius: 0.2, feather: 0, opacity: 1 }] });
			const ack = await owner.apply({ schemaVersion: 3, photoId: f.photo.id, expectedRevision: original.revision,
				command: { type: 'record-develop', versionId: original.versionId, develop, label: 'Repair', createdAt: TIME } }, { signal: context.signal });
			assert.equal(ack.schemaVersion, 3); assert.deepEqual(ack.snapshot.develop, develop);
		}); });
		const first = await current().loadDevelopProxyRuntime(); assert.equal(await current().loadDevelopProxyRuntime(), first);
		assert.equal(opens, 1); assert.equal(renders, 1);
		let refused = false;
		await current().executeLegacyDevelop(async context => { const owner = await context.acquire();
			try { await owner.read({ schemaVersion: 2, photoId: f.photo.id }, { signal: context.signal }); }
			catch (error) { refused = true; throw error; }
		});
		assert.equal(refused, true);
	} finally { await mounted.dispose(); }
	const reopened = await f.open(); try { const saved = await reopened.develop.read({ schemaVersion: 3, photoId: f.photo.id });
		assert.equal(saved.develop.processVersion, 3); if (saved.develop.processVersion === 3) assert.equal(saved.develop.repairs.spots[0]?.id, 'clone');
	} finally { await reopened.close(); }
});

test('Current slot captures the selected real source and caches the actual repair renderer without a second Session', async () => {
	const f = await fixture(); let opens = 0, renderers = 0;
	const current = slot(async () => { opens++; return f.open(); }, async (source, maskSource) => {
		renderers++; assert.equal(typeof source.withBytes, 'function'); assert.ok(maskSource);
		return createPhotoDevelopRenderRuntimeV3({ source, maskSource });
	});
	try {
		const owner = await acquirePhotoLibraryWorkflowSlotCurrentV1(current);
		const runtime = await loadPhotoLibraryDevelopProxyCurrentV1(current);
		assert.equal(await acquirePhotoLibraryWorkflowSlotCurrentV1(current), owner); assert.equal(await loadPhotoLibraryDevelopProxyCurrentV1(current), runtime);
		assert.equal(opens, 1); assert.equal(renderers, 1);
		const recipe = replaceImageDevelopRepairSpotsV1(f.photo.versions[0]!.develop, { schemaVersion: 1, spots: [{ id: 'clone', mode: 'clone', enabled: true,
			target: { x: 0.75, y: 0.5 }, source: { x: 0.25, y: 0.5 }, radius: 0.5, feather: 0, opacity: 1 }] });
		await runtime.withFullResolution({ frame: { descriptor: { schemaVersion: 1, width: 2, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' },
			pixels: Uint8Array.of(64, 64, 64, 255, 255, 255, 255, 255) }, develop: recipe, signal: new AbortController().signal }, view => {
			assert.deepEqual([...view.frame.pixels], [64, 64, 64, 255, 64, 64, 64, 255]);
		});
	} finally { await retirePhotoLibraryWorkflowSlotCurrentV1(current, async () => undefined); }
});

test('Current slot retirement caches its join before abort and waits for a genuine late factory owner', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(); let closes = 0;
	const current = slot(async () => { const session = await f.open(), close = session.close;
		Object.defineProperty(session, 'close', { value: function () { closes++; return Reflect.apply(close, session, []); } });
		entered.resolve(); await release.promise; return session;
	}, async (source, maskSource) => createPhotoDevelopRenderRuntimeV3({ source, ...(maskSource ? { maskSource } : {}) }));
	const acquired = outcome(acquirePhotoLibraryWorkflowSlotCurrentV1(current)); let closing: Promise<void> | undefined;
	try {
		const reached = await Promise.race([entered.promise.then(() => true), acquired.then(() => false)]); assert.equal(reached, true);
		closing = retirePhotoLibraryWorkflowSlotCurrentV1(current, async () => undefined);
		assert.equal(retirePhotoLibraryWorkflowSlotCurrentV1(current, async () => { throw Error('Duplicate cleanup'); }), closing);
		assert.equal(await remainsPending(closing), true); assert.equal(current.live, false); assert.equal(closes, 0);
		release.resolve(); await acquired; await closing; assert.equal(closes, 1);
		await assert.rejects(loadPhotoLibraryDevelopProxyCurrentV1(current), { name: 'AbortError' });
	} finally { release.resolve(); await acquired; await closing; if (current.live) await retirePhotoLibraryWorkflowSlotCurrentV1(current, async () => undefined); }
});

test('Current hook replacement fences a retained Develop callback and joins the preceding actual Session', async () => {
	const f = await fixture(); let view: ReturnType<typeof usePhotoLibraryWorkflowCurrentV1> | null = null, opens = 0;
	const factory = async () => { opens++; return f.open(); };
	let renderer: CreatePhotoLibraryDevelopProxyRuntimeV3 = async (source, maskSource) => createPhotoDevelopRenderRuntimeV3({ source, ...(maskSource ? { maskSource } : {}) });
	function Harness() { view = usePhotoLibraryWorkflowCurrentV1(factory, undefined, renderer); return null; }
	const mounted = await mountPhotoImportUi(() => <Harness />), current = () => { assert.ok(view); return view; };
	try {
		await act(async () => { await current().readPage(); }); const stale = current().executeDevelop;
		renderer = async (source, maskSource) => createPhotoDevelopRenderRuntimeV3({ source, ...(maskSource ? { maskSource } : {}) });
		await mounted.render(); let invoked = 0;
		await act(async () => { await stale(async () => { invoked++; }); await current().readPage(); await settle(); });
		assert.equal(invoked, 0); assert.equal(opens, 2); assert.equal(current().page?.rows[0]?.id, f.photo.id);
	} finally { await mounted.dispose(); }
});
