/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import type { PhotoLibraryImportGestureOptionsV2 } from '../src/common/editor/photo-library-develop-import-port-v1.ts';
import { deferred } from './helpers/async-test-control.ts';
import { createImportTestPort, mountImportWorkflow } from './helpers/photo-import-workflow-fixture.tsx';

const file = new File(['source'], 'source.png');
const item = { index: 0, fileName: file.name, photoId: 'photo', status: 'imported' as const, reusedOriginal: false, message: null, hasMetadataNotices: false };
const choice = () => ({ schemaVersion: 1 as const, catalogId: 'catalog', presetId: 'preset', expectedRevision: 3 });
const menu = { schemaVersion: 1 as const, catalogId: 'catalog', revision: 3, presets: [] };

test('Develop import workflow detaches the scalar choice before lazy acquisition and uses the optional capability', async () => {
	const ready = deferred<ReturnType<typeof createImportTestPort>>(); let developed = 0, legacy = 0;
	const port = { ...createImportTestPort(), developImport: { listPresets: async () => menu,
		importFiles: async (_files: readonly File[], request: { developPreset: ReturnType<typeof choice>; onAcknowledged?: (value: typeof item) => void }) => {
			developed++; assert.deepEqual(request.developPreset, choice()); assert.equal(Object.isFrozen(request.developPreset), true);
			request.onAcknowledged?.(item); return [item];
		} } };
	port.importFiles = async () => { legacy++; return [item]; };
	const mounted = await mountImportWorkflow(() => ready.promise), selected = choice(); let pending: Promise<unknown> | undefined;
	try {
		await act(async () => { pending = mounted.current.importFiles([file], { developPreset: selected } as PhotoLibraryImportGestureOptionsV2); });
		selected.presetId = 'changed'; selected.expectedRevision = 4;
		await act(async () => { ready.resolve(port); assert.deepEqual(await pending, { outcome: 'acknowledged', items: [item], completion: 'finished', notice: null }); });
		assert.equal(developed, 1); assert.equal(legacy, 0);
	} finally { ready.resolve(port); await pending; await mounted.dispose(); }
});

test('missing Develop import capability refuses the requested preset without publishing an ordinary import', async () => {
	const port = createImportTestPort(); let legacy = 0;
	port.importFiles = async () => { legacy++; return [item]; };
	const mounted = await mountImportWorkflow(async () => port);
	try {
		await act(async () => { assert.deepEqual(await mounted.current.importFiles([file], { developPreset: choice() } as PhotoLibraryImportGestureOptionsV2), { outcome: 'failed' }); });
		assert.equal(legacy, 0); assert.deepEqual(mounted.current.receipts, []);
	} finally { await mounted.dispose(); }
});

test('accessor preset choices refuse before lazy acquisition without invoking caller code', async () => {
	let touched = 0, opened = 0;
	const selected = Object.defineProperty(choice(), 'presetId', { enumerable: true, get() { touched++; return 'preset'; } });
	const mounted = await mountImportWorkflow(async () => { opened++; return createImportTestPort(); });
	try {
		await act(async () => { assert.deepEqual(await mounted.current.importFiles([file], { developPreset: selected } as PhotoLibraryImportGestureOptionsV2), { outcome: 'failed' }); });
		assert.equal(touched, 0); assert.equal(opened, 0);
	} finally { await mounted.dispose(); }
});
