/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { flushSync } from 'react-dom';
import PhotoImportDialogV2, { type PhotoImportDialogPropsV2 } from '../src/common/editor/ui/lightscaper/PhotoImportDialogV2.tsx';
import { PhotoLibraryDefinitionReader } from '../src/common/editor/controller/shared/photo-library-definition-reader.ts';
import type { PhotoLibraryImportGestureReceiptV1 } from '../src/common/editor/photo-library-import-settings-port-v1.ts';
import type { PhotoLibraryImportGestureOptionsV2 } from '../src/common/editor/ui/lightscaper/photo-library-workflow-import-v2.ts';
import type { PhotoLibraryDevelopPresetSnapshotV2 } from '../src/common/editor/photo-library-develop-presets-port-v2.ts';
import { deferred, settle } from './helpers/async-test-control.ts';
import { importDialogCopy } from './helpers/photo-import-dialog-fixture.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';

const source = new File(['exact original'], '東京 é original.JPG');
const ack: PhotoLibraryImportGestureReceiptV1 = { outcome: 'acknowledged', items: [{ index: 0, fileName: source.name,
	photoId: 'photo', status: 'imported', reusedOriginal: false, message: null, hasMetadataNotices: false }], completion: 'finished', notice: null };
const menu: PhotoLibraryDevelopPresetSnapshotV2 = { schemaVersion: 2, catalogId: 'catalog', revision: 7, presets: [
	{ id: 'full', name: 'Full LUT look', scope: 'full', authoredStateSha256: 'a'.repeat(64) },
	{ id: 'partial', name: 'Partial LUT look', scope: 'partial', authoredStateSha256: 'b'.repeat(64) },
] };
function props(): PhotoImportDialogPropsV2 {
	return { title: 'Import photos', filesLabel: 'Choose files', importLabel: 'Import', cancelLabel: 'Cancel', failureLabel: 'Import failed',
		busy: false, error: null, copy: importDialogCopy, definitionReader: new PhotoLibraryDefinitionReader(),
		readDefinitions: async () => ({ rootRevision: 0, rows: [], parent: null, selected: null, cursor: null }),
		readDefinition: async () => { throw new Error('Unexpected definition'); }, createId: () => 'preset',
		readPresets: async () => ({ revision: 0, presets: [] }), applyPreset: async () => { throw new Error('Unexpected preset write'); },
		onClose: () => undefined, onImport: async () => ({ outcome: 'failed' }) };
}
async function select(mounted: Awaited<ReturnType<typeof mountPhotoImportUi>>, files: readonly File[] = [source]) {
	Reflect.set(mounted.dom.one('input'), 'files', files); await mounted.event('input', 'onChange');
}
const submit = { preventDefault() {} }, options = '[data-photo-import-options]', choice = '[data-import-develop-choice]';

test('current dialog stays cold until options are opened and plain admission pins original callback receivers', async () => {
	const held = deferred<PhotoLibraryImportGestureReceiptV1>(), receivers: unknown[] = []; let reads = 0, writes = 0, closes = 0;
	const input = { ...props(), readDevelopPresets: async () => { reads++; return menu; },
		onImport: new Proxy(function(this: PhotoImportDialogPropsV2, files: readonly File[], request?: PhotoLibraryImportGestureOptionsV2) {
			receivers.push(this); writes++; assert.equal(files[0], source); assert.ok(Object.isFrozen(files));
			assert.deepEqual(Object.keys(request!), ['signal']); assert.ok(Object.isFrozen(request)); return held.promise;
		}, { get() { assert.fail('Callback metadata must not be read'); } }),
		onClose: function(this: PhotoImportDialogPropsV2) { receivers.push(this); closes++; } };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDialogV2 {...input} />);
	try {
		assert.equal(reads, 0); assert.equal(mounted.dom.container.querySelectorAll(choice).length, 0);
		await select(mounted); await mounted.event('form', 'onSubmit', submit); await mounted.event('form', 'onSubmit', submit);
		assert.equal(writes, 1); assert.equal(closes, 0); assert.equal(reads, 0);
		await act(async () => { held.resolve(ack); await settle(); }); assert.equal(closes, 1);
		assert.equal(receivers[0], receivers[1]); assert.equal((receivers[0] as PhotoImportDialogPropsV2).onImport, input.onImport);
	} finally { held.resolve(ack); await mounted.dispose(); }
});

for (const presetId of ['full', 'partial']) test(`${presetId}: schema2 choice and Unicode/blank import settings survive collapse and failed retry`, async () => {
	const requests: PhotoLibraryImportGestureOptionsV2[] = []; let revision = 7, closes = 0;
	const input = { ...props(), readDevelopPresets: async () => ({ ...menu, revision }), onClose: () => { closes++; },
		onImport: async (files: readonly File[], request?: PhotoLibraryImportGestureOptionsV2): Promise<PhotoLibraryImportGestureReceiptV1> => {
			assert.equal(files[0], source); requests.push(request!); return requests.length === 1 ? { outcome: 'failed' } : ack;
		} };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDialogV2 {...input} />);
	try {
		await select(mounted); await mounted.event(options, 'onToggle', { currentTarget: { open: true } });
		await mounted.event(choice, 'onChange', { currentTarget: { value: presetId } });
		await mounted.event('[data-import-rename]', 'onChange', { currentTarget: { checked: true } });
		await mounted.event('[data-import-template]', 'onChange', { currentTarget: { value: '{stem}-撮影.{extension}' } });
		await mounted.event('[data-import-override="creator"]', 'onChange', { currentTarget: { checked: true } });
		await mounted.event(options, 'onToggle', { currentTarget: { open: false } }); revision = 9;
		await mounted.event(options, 'onToggle', { currentTarget: { open: true } });
		await mounted.event('form', 'onSubmit', submit); assert.equal(closes, 0);
		assert.deepEqual(requests[0]?.developPreset, { schemaVersion: 2, catalogId: 'catalog', presetId, expectedRevision: 7 });
		assert.deepEqual(requests[0]?.settings?.metadata, { creator: '' }); assert.equal(requests[0]?.settings?.rename?.template, '{stem}-撮影.{extension}');
		assert.ok(Object.isFrozen(requests[0]?.developPreset)); assert.ok(Object.isFrozen(requests[0]?.settings?.metadata));
		await mounted.event('form', 'onSubmit', submit); assert.equal(closes, 1);
		assert.deepEqual(requests[1]?.developPreset, requests[0]?.developPreset); assert.equal(source.name, '東京 é original.JPG');
	} finally { await mounted.dispose(); }
});

test('collapsing a held current preset list keeps import locked until its native cancelled work joins', async () => {
	const held = deferred<PhotoLibraryDevelopPresetSnapshotV2>(); let reads = 0, writes = 0, signal: AbortSignal | undefined;
	const input = { ...props(), readDevelopPresets: (request?: Readonly<{ signal?: AbortSignal }>) => {
		reads++; signal = request?.signal; return reads === 1 ? held.promise : Promise.resolve(menu);
	}, onImport: async () => { writes++; return ack; } };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDialogV2 {...input} />);
	try {
		await select(mounted); await mounted.event(options, 'onToggle', { currentTarget: { open: true } }); assert.equal(reads, 1);
		const oldSignal = signal; await mounted.event(options, 'onToggle', { currentTarget: { open: false } }); assert.equal(oldSignal?.aborted, true);
		await mounted.event('form', 'onSubmit', submit); assert.equal(writes, 0);
		await mounted.event(options, 'onToggle', { currentTarget: { open: true } }); assert.equal(reads, 1);
		await act(async () => { held.resolve(menu); await settle(); }); assert.equal(reads, 2);
		await mounted.event('form', 'onSubmit', submit); assert.equal(writes, 1);
	} finally { held.resolve(menu); await mounted.dispose(); }
});

test('synchronous Cancel before deferred import starts revokes admission without reading callable metadata', async () => {
	let writes = 0, closes = 0;
	const input = { ...props(), onImport: async () => { writes++; return ack; }, onClose: () => { closes++; } };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDialogV2 {...input} />);
	try {
		await select(mounted);
		await act(async () => { reactProps(mounted.dom.one('form')).onSubmit?.(submit); reactProps(mounted.dom.one('[data-photo-import-cancel]')).onClick?.({}); await settle(); });
		assert.equal(writes, 0); assert.equal(closes, 1);
	} finally { await mounted.dispose(); }
});

test('replacement import callback waits for old cancellation and retained handlers cannot touch the replacement', async () => {
	const held = deferred<PhotoLibraryImportGestureReceiptV1>(); let oldWrites = 0, nextWrites = 0, closes = 0, signal: AbortSignal | undefined;
	let input = { ...props(), onImport: (_files: readonly File[], request?: PhotoLibraryImportGestureOptionsV2) => { oldWrites++; signal = request?.signal; return held.promise; },
		onClose: () => { closes++; } };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDialogV2 {...input} />);
	try {
		await select(mounted); const oldSubmit = reactProps(mounted.dom.one('form')).onSubmit, oldClose = reactProps(mounted.dom.one('[data-photo-import-cancel]')).onClick;
		await mounted.event('form', 'onSubmit', submit); assert.equal(oldWrites, 1);
		input = { ...input, onImport: async () => { nextWrites++; return ack; } }; await mounted.render(); assert.equal(signal?.aborted, true);
		await act(async () => { oldSubmit?.(submit); oldClose?.({}); }); assert.equal(closes, 0);
		await mounted.event('form', 'onSubmit', submit); assert.equal(nextWrites, 0);
		await act(async () => { held.resolve(ack); await settle(); }); assert.equal(closes, 0);
		await mounted.event('form', 'onSubmit', submit); assert.equal(nextWrites, 1); assert.equal(closes, 1);
	} finally { held.resolve(ack); await mounted.dispose(); }
});

test('own AbortSignal shadows cannot publish a late ACK after Cancel', async () => {
	const held = deferred<PhotoLibraryImportGestureReceiptV1>(); let closes = 0, signal: AbortSignal | undefined, shadowCalls = 0;
	const input = { ...props(), onClose: () => { closes++; }, onImport: (_files: readonly File[], request?: PhotoLibraryImportGestureOptionsV2) => {
		signal = request?.signal; Object.defineProperties(signal!, { aborted: { value: false }, throwIfAborted: { value() { shadowCalls++; } } }); return held.promise;
	} };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDialogV2 {...input} />);
	try {
		await select(mounted); await mounted.event('form', 'onSubmit', submit); await mounted.event('[data-photo-import-cancel]', 'onClick');
		assert.equal(Reflect.apply(Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!, signal, []), true);
		await act(async () => { held.resolve(ack); await settle(); }); assert.equal(closes, 1); assert.equal(shadowCalls, 0);
	} finally { held.resolve(ack); await mounted.dispose(); }
});

test('native cancellation fences receipt inspection before and after borrowed outcome access', async () => {
	for (const cancelBeforeCompletion of [true, false]) {
		const held = deferred<PhotoLibraryImportGestureReceiptV1>(); let closes = 0, outcomeReads = 0;
		const input = { ...props(), onClose: () => { closes++; }, onImport: () => held.promise };
		const mounted = await mountPhotoImportUi(() => <PhotoImportDialogV2 {...input} />);
		try {
			await select(mounted); await mounted.event('form', 'onSubmit', submit);
			const cancel = reactProps(mounted.dom.one('[data-photo-import-cancel]')).onClick;
			if (cancelBeforeCompletion) await mounted.event('[data-photo-import-cancel]', 'onClick');
			const receipt = Object.defineProperty({ ...ack }, 'outcome', { get() { outcomeReads++; cancel?.({}); return 'acknowledged'; } });
			await act(async () => { held.resolve(receipt); await settle(); });
			assert.equal(outcomeReads, cancelBeforeCompletion ? 0 : 1); assert.equal(closes, 1);
		} finally { held.resolve(ack); await mounted.dispose(); }
	}
});

test('Close is latched before native abort callbacks can synchronously reenter the dialog', async () => {
	const held = deferred<PhotoLibraryImportGestureReceiptV1>(); let closes = 0, reenter = () => undefined;
	const input = { ...props(), onClose: () => { closes++; }, onImport: (_files: readonly File[], request?: PhotoLibraryImportGestureOptionsV2) => {
		request?.signal?.addEventListener('abort', () => { reenter(); }); return held.promise;
	} };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDialogV2 {...input} />);
	try {
		await select(mounted); await mounted.event('form', 'onSubmit', submit);
		reenter = () => { reactProps(mounted.dom.one('[data-photo-import-cancel]')).onClick?.({}); return undefined; };
		await mounted.event('[data-photo-import-cancel]', 'onClick'); assert.equal(closes, 1);
		await act(async () => { held.resolve(ack); await settle(); }); assert.equal(closes, 1);
	} finally { held.resolve(ack); await mounted.dispose(); }
});

test('Cancel still dismisses after a synchronous harmless render with the same import generation', async () => {
	const held = deferred<PhotoLibraryImportGestureReceiptV1>(); let closes = 0, redraw = () => undefined;
	const input = { ...props(), onClose: () => { closes++; }, onImport: (_files: readonly File[], request?: PhotoLibraryImportGestureOptionsV2) => {
		request?.signal?.addEventListener('abort', () => { redraw(); }); return held.promise;
	} };
	function Harness() {
		const [revision, setRevision] = useState(0); redraw = () => { flushSync(() => { setRevision(1); }); return undefined; };
		return <PhotoImportDialogV2 {...input} title={`Title ${String(revision)}`} />;
	}
	const mounted = await mountPhotoImportUi(() => <Harness />);
	try {
		await select(mounted); await mounted.event('form', 'onSubmit', submit); await mounted.event('[data-photo-import-cancel]', 'onClick');
		assert.match(mounted.dom.container.textContent, /Title 1/u); assert.equal(closes, 1);
		await act(async () => { held.resolve(ack); await settle(); }); assert.equal(closes, 1);
	} finally { held.resolve(ack); await mounted.dispose(); }
});

test('foreign failure reflection cannot publish an old diagnostic after synchronously replacing the import generation', async () => {
	let replace = () => undefined, replacements = 0, closes = 0;
	const opaque = new Proxy({}, { getOwnPropertyDescriptor(_target, key) {
		if (key !== 'message') return undefined;
		replacements++; replace(); return { value: 'OLD OWNER DIAGNOSTIC', enumerable: true, configurable: true };
	} });
	const firstImport = async () => { throw opaque; }, nextImport = async () => ack, input = { ...props(), onClose: () => { closes++; } };
	function Harness() {
		const [generation, setGeneration] = useState(0); replace = () => { flushSync(() => { setGeneration(1); }); return undefined; };
		return <PhotoImportDialogV2 {...input} title={`Generation ${String(generation)}`} onImport={generation === 0 ? firstImport : nextImport} />;
	}
	const mounted = await mountPhotoImportUi(() => <Harness />);
	try {
		await select(mounted); await mounted.event('form', 'onSubmit', submit); assert.equal(replacements, 1);
		assert.match(mounted.dom.container.textContent, /Generation 1/u); assert.doesNotMatch(mounted.dom.container.textContent, /OLD OWNER DIAGNOSTIC/u);
		await mounted.event('form', 'onSubmit', submit); assert.equal(closes, 1);
	} finally { await mounted.dispose(); }
});

test('bounded File admission and opaque failure diagnostics retain selected originals for retry', async () => {
	let writes = 0; const opaque = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('Opaque error'); } });
	const input = { ...props(), onImport: async () => { writes++; throw opaque; } };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDialogV2 {...input} />);
	try {
		await select(mounted, Array.from({ length: 65 }, () => source)); await mounted.event('form', 'onSubmit', submit); assert.equal(writes, 0);
		await select(mounted); await mounted.event('form', 'onSubmit', submit); assert.equal(writes, 1);
		assert.match(mounted.dom.container.textContent, /Import failed/u); assert.equal((Reflect.get(mounted.dom.one('input'), 'files') as readonly File[])[0], source);
		await mounted.event('form', 'onSubmit', submit); assert.equal(writes, 2);
	} finally { await mounted.dispose(); }
});

test('unmount aborts the held gesture and its eventual acknowledgement cannot dismiss another owner', async () => {
	const held = deferred<PhotoLibraryImportGestureReceiptV1>(); let signal: AbortSignal | undefined, closes = 0;
	const input = { ...props(), onClose: () => { closes++; }, onImport: (_files: readonly File[], request?: PhotoLibraryImportGestureOptionsV2) => { signal = request?.signal; return held.promise; } };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDialogV2 {...input} />);
	await select(mounted); await mounted.event('form', 'onSubmit', submit); await mounted.dispose();
	assert.equal(signal?.aborted, true); held.resolve(ack); await settle(); assert.equal(closes, 0);
});
