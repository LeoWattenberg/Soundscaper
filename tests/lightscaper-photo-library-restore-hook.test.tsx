/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useMemo, useState } from 'react';
import { usePhotoLibraryRestore } from '../src/common/editor/ui/lightscaper/use-photo-library-restore.ts';
import { usePhotoLibraryWorkflow } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow.ts';
import type { PhotoLibraryRestoreRuntimeV1, PhotoLibraryRestoreReceiptV1 } from '../src/common/editor/photo-library-restore-port-v1.ts';
import { createImportTestPort } from './helpers/photo-import-workflow-fixture.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

const ack = (): PhotoLibraryRestoreReceiptV1 => ({ catalogId: 'catalog', catalogName: 'Same library', photoCount: 0,
	stackCount: 0, savedCollectionCount: 0, originalCount: 0, originalByteLength: 0, notices: [] });
async function mount(factory: () => Promise<ReturnType<typeof createImportTestPort>>, loadRuntime: () => Promise<PhotoLibraryRestoreRuntimeV1>) {
	let value: { library: ReturnType<typeof usePhotoLibraryWorkflow>; restore: ReturnType<typeof usePhotoLibraryRestore>; epoch: number } | undefined;
	function Harness() {
		const [epoch, setEpoch] = useState(0), effective = useMemo(() => () => { void epoch; return factory(); }, [epoch]);
		const library = usePhotoLibraryWorkflow(effective);
		const restore = usePhotoLibraryRestore({ loadRuntime, retireAndJoin: library.retireAndJoin, onSettled: () => { setEpoch(value => value + 1); } });
		value = { library, restore, epoch }; return null;
	}
	const mounted = await mountPhotoImportUi(() => <Harness />);
	return { ...mounted, get current() { assert.ok(value); return value; } };
}

test('held old factory and native close both drain before restore runtime can load; same-stack new demand is fenced', async () => {
	const old = deferred<ReturnType<typeof createImportTestPort>>(), draining = deferred<void>(); let loaded = 0, closes = 0, opens = 0;
	const port = createImportTestPort(); port.close = async () => { closes++; await draining.promise; };
	const mounted = await mount(() => { opens++; return old.promise; }, async () => { loaded++; return { restoreArchive: async () => ack(), close: async () => undefined }; });
	let reading: Promise<void> | undefined, restoring: Promise<PhotoLibraryRestoreReceiptV1 | null> | undefined;
	try {
		await act(async () => { reading = mounted.current.library.readPage(); await settle(); });
		await act(async () => { restoring = mounted.current.restore.restore(new Blob(['backup'])); await mounted.current.library.readPage(); await settle(); });
		assert.equal(opens, 1); assert.equal(loaded, 0); assert.equal(await remainsPending(restoring!), true);
		await act(async () => { old.resolve(port); await reading; await settle(); });
		assert.equal(closes, 1); assert.equal(loaded, 0);
		await act(async () => { draining.resolve(); await restoring; await settle(); });
		assert.equal(loaded, 1); assert.equal(mounted.current.epoch, 1); assert.deepEqual(mounted.current.restore.receipt, ack());
	} finally { old.resolve(port); draining.resolve(); await reading; await restoring; await mounted.dispose(); }
});

test('late durable ACK survives Cancel and rotates the same-ID factory epoch while the receipt outlives Session reset', async () => {
	const held = deferred<PhotoLibraryRestoreReceiptV1>(), entered = deferred<void>(); let signal: AbortSignal | undefined, opens = 0;
	const port = createImportTestPort();
	const mounted = await mount(async () => { opens++; return port; }, async () => ({ restoreArchive: async (_blob, options) => { signal = options?.signal; entered.resolve(); return held.promise; }, close: async () => undefined }));
	let restoring: Promise<PhotoLibraryRestoreReceiptV1 | null> | undefined, cancelled: Promise<void> | undefined;
	try {
		await act(async () => { await mounted.current.library.readPage(); restoring = mounted.current.restore.restore(new Blob(['backup'])); await entered.promise; });
		await act(async () => { cancelled = mounted.current.restore.cancel(); await settle(); });
		assert.equal(signal?.aborted, true); assert.equal(await remainsPending(cancelled!), true); assert.equal(mounted.current.restore.busy, true);
		await act(async () => { held.resolve(ack()); assert.deepEqual(await restoring, ack()); await cancelled; await settle(); });
		assert.equal(mounted.current.epoch, 1); assert.equal(mounted.current.library.page, null); assert.deepEqual(mounted.current.restore.receipt, ack());
		await act(async () => { await mounted.current.library.readPage(); }); assert.equal(opens, 2); assert.deepEqual(mounted.current.restore.receipt, ack());
	} finally { held.resolve(ack()); await restoring; await cancelled; await mounted.dispose(); }
});

test('unmount cancels and joins a late runtime factory, closing its owner without backend restore', async () => {
	const loading = deferred<PhotoLibraryRestoreRuntimeV1>(), entered = deferred<void>(); let closed = 0, restores = 0;
	const mounted = await mount(async () => createImportTestPort(), () => { entered.resolve(); return loading.promise; });
	let work: Promise<PhotoLibraryRestoreReceiptV1 | null> | undefined;
	await act(async () => { work = mounted.current.restore.restore(new Blob(['backup'])); await entered.promise; });
	await mounted.dispose();
	loading.resolve({ restoreArchive: async () => { restores++; return ack(); }, close: async () => { closed++; } });
	await work; await settle(); assert.equal(restores, 0); assert.equal(closed, 1);
});
