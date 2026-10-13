/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import { detachPhotoLibraryImportGestureCurrentV1,
	executePhotoLibraryImportGestureCurrentV1 } from '../src/common/editor/ui/lightscaper/photo-library-workflow-import-current-v1.ts';
import type { PhotoLibraryDevelopPresetReadV3 } from '../src/common/editor/photo-library-develop-presets-port-v3.ts';
import type { PhotoLibraryImportItemV1 } from '../src/common/editor/photo-library-session-port-v1.ts';
import type { PhotoLibrarySessionPortCurrentV1 } from '../src/common/editor/photo-library-session-port-current-v1.ts';
import { usePhotoLibraryWorkflowCurrentV1 } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow-current-v1.ts';
import { createPhotoDevelopRenderRuntimeV3 } from '../src/lightscaper/photo-develop-render-runtime-v3.ts';
import { repairPresetsFixture, currentPreset } from './helpers/lightscaper-repair-presets-current-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { deferred } from './helpers/async-test-control.ts';

const file = new File(['immutable source'], '東京 é source.png');
const choice = (): PhotoLibraryDevelopPresetReadV3 => ({ schemaVersion: 3, catalogId: 'catalog', presetId: 'repair', expectedRevision: 7 });
const item: PhotoLibraryImportItemV1 = { index: 0, fileName: file.name, photoId: 'new-photo', status: 'imported', reusedOriginal: false, message: null, hasMetadataNotices: false };

test('Current import gesture detaches authored choice, source names and real File inventory before asynchronous acquisition', () => {
	const selected = { ...choice() }, files = [file], settings = { rename: { template: '{stem}-{sequence}.{extension}', sequenceStart: 3, sequencePadding: 2 }, metadata: { title: 'Authored' }, keywordIds: ['keyword'] };
	const draft = detachPhotoLibraryImportGestureCurrentV1(files, { developPreset: selected, settings });
	selected.presetId = 'changed'; selected.expectedRevision = 9; files.length = 0; settings.metadata.title = 'Changed'; settings.keywordIds.length = 0;
	assert.deepEqual(draft.developPreset, choice()); assert.ok(Object.isFrozen(draft.developPreset));
	assert.deepEqual(draft.selected, [file]); assert.ok(Object.isFrozen(draft.selected)); assert.equal(draft.selected[0], file);
	assert.equal(draft.settings?.metadata.title, 'Authored'); assert.deepEqual(draft.settings?.keywordIds, ['keyword']); assert.equal(file.name, '東京 é source.png');
});

test('Current import gesture invokes the pinned Current child receiver and scopes late ACK observation to the joined request', async () => {
	const draft = detachPhotoLibraryImportGestureCurrentV1([file], { developPreset: choice() }), held = deferred<readonly PhotoLibraryImportItemV1[]>();
	let published = 0, calls = 0, callback: ((value: unknown) => void) | undefined;
	const current = { schemaVersion: 3, importFiles: function(this: unknown, files: readonly File[], request: { schemaVersion: number; developPreset: unknown; onAcknowledged: (value: unknown) => void }) {
		assert.equal(this, current); assert.equal(files, draft.selected); assert.equal(request.schemaVersion, 3); assert.deepEqual(request.developPreset, choice());
		calls++; callback = request.onAcknowledged; request.onAcknowledged(item); return held.promise;
	} };
	const owner = { developImportCurrent: current, importFiles: () => assert.fail('A selected preset must use the Current child.') };
	Object.defineProperty(owner, 'developImport', { get() { assert.fail('The inherited permanent V2 child must not be inspected.'); } });
	const work = executePhotoLibraryImportGestureCurrentV1(owner as unknown as Parameters<typeof executePhotoLibraryImportGestureCurrentV1>[0], draft,
		new AbortController().signal, () => { published++; });
	try {
		assert.equal(calls, 1); assert.equal(published, 1);
		current.importFiles = () => assert.fail('A pending import must retain its captured method.');
		held.resolve([item]); await work; assert.deepEqual(draft.collector.snapshot(), [item]);
		callback?.({ ...item, photoId: 'late' }); assert.equal(published, 1); assert.deepEqual(draft.collector.snapshot(), [item]);
	} finally { held.resolve([item]); await work; }
});

test('plain Current import still invokes the permanent ordinary import owner and never looks up either preset child', async () => {
	const draft = detachPhotoLibraryImportGestureCurrentV1([file]), owner = { importFiles: function(this: unknown) { assert.equal(this, owner); return Promise.resolve([item]); } };
	for (const key of ['developImport', 'developImportCurrent']) Object.defineProperty(owner, key, { get() { assert.fail('No selected preset means no preset capability lookup.'); } });
	await executePhotoLibraryImportGestureCurrentV1(owner as unknown as Parameters<typeof executePhotoLibraryImportGestureCurrentV1>[0], draft, new AbortController().signal, () => undefined);
	assert.deepEqual(draft.collector.snapshot(), [item]);
});

test('Current import identity rejects accessors, future and permanent versions before selected-library acquisition', () => {
	let touched = 0; const accessor = Object.defineProperty(choice(), 'presetId', { enumerable: true, get() { touched++; return 'repair'; } });
	for (const value of [accessor, { ...choice(), schemaVersion: 2 }, { ...choice(), schemaVersion: 4 }, { ...choice(), expectedRevision: -0 }]) {
		assert.throws(() => detachPhotoLibraryImportGestureCurrentV1([file], { developPreset: value }));
	}
	assert.equal(touched, 0);
});

test('Current import preserves the exact native opaque pre-abort reason before File or choice observation', () => {
	const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); const controller = new AbortController(); controller.abort(proxy);
	const options = { signal: controller.signal }; Object.defineProperty(options, 'developPreset', { enumerable: true, get() { assert.fail('Pre-abort must precede metadata.'); } });
	try { detachPhotoLibraryImportGestureCurrentV1([file], options); assert.fail('The aborted gesture must refuse.'); }
	catch (reason) { assert.equal(Object.is(reason, proxy), true); }
});

test('actual Current workflow acquires once and reads its named native preset menu without inspecting the permanent V2 child', async () => {
	const f = await repairPresetsFixture(), ready = deferred<PhotoLibrarySessionPortCurrentV1>(), cap = f.session.develop.presetsCurrent; assert.ok(cap);
	const preset = currentPreset(await f.selectedPacket()), saved = await cap.write({ schemaVersion: 3, catalogId: f.root.id,
		command: { type: 'save', expectedRevision: 0, preset } });
	let reads = 0, value: ReturnType<typeof usePhotoLibraryWorkflowCurrentV1> | undefined;
	const factory = () => { reads++; return ready.promise; }, renderer = async () => createPhotoDevelopRenderRuntimeV3();
	function Harness() { value = usePhotoLibraryWorkflowCurrentV1(factory, undefined, renderer); return null; }
	const mounted = await mountPhotoImportUi(() => <StrictMode><Harness /></StrictMode>);
	Object.defineProperty(f.session, 'developImport', { configurable: true, get() { assert.fail('The Current hook must not acquire the permanent V2 preset child.'); } });
	let work: Promise<unknown> | undefined;
	try {
		assert.ok(value); await act(async () => { work = value!.readImportDevelopPresets(); }); assert.equal(reads, 1);
		await act(async () => { ready.resolve(f.session); assert.deepEqual(await work, saved.snapshot); }); assert.equal(reads, 1);
		assert.equal((await f.row() as { schemaVersion: number }).schemaVersion, 3); assert.equal(saved.snapshot.presets[0]!.id, preset.identity.id);
	} finally { ready.resolve(f.session); await work?.catch(() => undefined); await mounted.dispose(); await f.close(); }
});
