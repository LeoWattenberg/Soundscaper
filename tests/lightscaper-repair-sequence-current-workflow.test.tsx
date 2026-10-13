/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import { usePhotoLibraryWorkflowCurrentV1 } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow-current-v1.ts';
import { createPhotoDevelopRenderRuntimeV3 } from '../src/lightscaper/photo-develop-render-runtime-v3.ts';
import { repairSequenceCurrentFixture, sequenceOutcome } from './helpers/lightscaper-repair-sequence-current-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

type Workflow = ReturnType<typeof usePhotoLibraryWorkflowCurrentV1>;
async function fixture() {
	const native = await repairSequenceCurrentFixture(), factory = async () => native.session;
	const renderer = async () => createPhotoDevelopRenderRuntimeV3({ source: native.session.cubeLuts.source, maskSource: native.session.maskRasterSource });
	let value: Workflow | undefined;
	function Harness() { value = usePhotoLibraryWorkflowCurrentV1(factory, undefined, renderer); return null; }
	const mounted = await mountPhotoImportUi(() => <StrictMode><Harness /></StrictMode>), current = () => { assert.ok(value); return value; };
	await act(async () => { await current().readPage(); });
	return { ...native, current, async dispose() { try { await mounted.dispose(); } finally { await native.close(); } } };
}
for (const scope of ['catalog', 'saved-query'] as const) test(`Current menu ${scope} sequence preparation chooses the named child and returns an explicit Current target`, async () => {
	const f = await fixture();
	Object.defineProperty(f.session, 'collectionHandoff', { configurable: true, get() { assert.fail('Current menu captured the permanent legacy child.'); } });
	try {
		const binding = scope === 'catalog' ? f.manualBinding : f.savedBinding;
		const prepared = await f.current().captureCollectionHandoff().prepare({ scope, collectionId: binding.collectionId }, new AbortController().signal);
		assert.equal(Object.getOwnPropertyDescriptor(prepared.target, 'schemaVersion')?.value, 2);
		assert.deepEqual(prepared.target.binding, binding); assert.equal(prepared.fileName, `${scope === 'catalog' ? f.root.collections.find(item => item.id === binding.collectionId)!.name : f.definition.name}.fscape`);
	} finally { await f.dispose(); }
});
test('Current sequence menu retirement joins its entered full native capture and revokes the prepared generation', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>();
	let work: ReturnType<typeof sequenceOutcome<unknown>> | undefined, unregister: (() => void) | undefined;
	try {
		const prepared = await f.current().captureCollectionHandoff().prepare({ scope: 'catalog', collectionId: f.manualBinding.collectionId }, new AbortController().signal);
		work = sequenceOutcome(prepared.target.capture.withCapture(prepared.target.binding, async view => { assert.equal(view.schemaVersion, 2); entered.resolve(); await release.promise; }));
		const joined = work; unregister = f.current().registerExportDestination(async () => { await joined; });
		assert.equal(await Promise.race([entered.promise.then(() => true), work.then(() => false)]), true);
		const closing = f.current().retireAndJoin(); assert.equal(await remainsPending(closing), true); release.resolve();
		assert.equal((await work).ok, false); await closing; await assert.rejects(prepared.target.checkCurrent(new AbortController().signal), { name: 'AbortError' });
	} finally { release.resolve(); await work; unregister?.(); await f.dispose(); }
});
