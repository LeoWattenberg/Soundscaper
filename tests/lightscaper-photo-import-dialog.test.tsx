/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoImportDialog from '../src/common/editor/ui/lightscaper/PhotoImportDialog.tsx';
import type { PhotoLibraryImportGestureReceiptV1, PhotoLibraryImportRequestOptionsV1 } from '../src/common/editor/photo-library-import-settings-port-v1.ts';
import { deferred, settle } from './helpers/async-test-control.ts';
import { importDialogProps } from './helpers/photo-import-dialog-fixture.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';

const source = new File(['exact original'], '東京 é original.JPG');
const ack = { outcome: 'acknowledged' as const, items: [{ index: 0, fileName: source.name, photoId: 'photo', status: 'imported' as const,
	reusedOriginal: false, message: null, hasMetadataNotices: false }], completion: 'finished' as const, notice: null };
async function select(mounted: Awaited<ReturnType<typeof mountPhotoImportUi>>, files = [source]) {
	Reflect.set(mounted.dom.one('input'), 'files', files); await mounted.event('input', 'onChange');
}

test('default plain submission omits settings and closes only after the acknowledged asynchronous outcome', async () => {
	const held = deferred<PhotoLibraryImportGestureReceiptV1>(), props = { ...importDialogProps() }; let closes = 0, reads = 0, calls = 0;
	props.onClose = () => { closes++; }; props.readPresets = async () => { reads++; return { revision: 0, presets: [] }; };
	props.onImport = (files, options) => { calls++; assert.equal(files[0], source); assert.equal(Object.hasOwn(options ?? {}, 'settings'), false); return held.promise; };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDialog {...props} />);
	try {
		await select(mounted); await mounted.event('form', 'onSubmit', { preventDefault() {} });
		assert.equal(calls, 1); assert.equal(closes, 0); assert.equal(reads, 0);
		await mounted.event('form', 'onSubmit', { preventDefault() {} }); assert.equal(calls, 1);
		await act(async () => { held.resolve(ack); await settle(); }); assert.equal(closes, 1);
	} finally { held.resolve(ack); await mounted.dispose(); }
});

test('pre-ack failure keeps the exact selected Files and authored Unicode/blank draft for retry', async () => {
	const props = { ...importDialogProps() }; let closes = 0, calls = 0, options: PhotoLibraryImportRequestOptionsV1 | undefined;
	props.onClose = () => { closes++; }; props.onImport = async (_files, next) => { calls++; options = next; return calls === 1 ? { outcome: 'failed' } : ack; };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDialog {...props} />);
	try {
		await select(mounted); await mounted.event('[data-photo-import-options]', 'onToggle', { currentTarget: { open: true } });
		await mounted.event('[data-import-rename]', 'onChange', { currentTarget: { checked: true } });
		await mounted.event('[data-import-template]', 'onChange', { currentTarget: { value: '{stem}-撮影.{extension}' } });
		await mounted.event('[data-import-override="creator"]', 'onChange', { currentTarget: { checked: true } });
		await mounted.event('form', 'onSubmit', { preventDefault() {} }); assert.equal(closes, 0); assert.equal(calls, 1);
		assert.deepEqual(options?.settings?.metadata, { creator: '' }); assert.equal(options?.settings?.rename?.template, '{stem}-撮影.{extension}');
		const selected: unknown = Reflect.get(mounted.dom.one('input'), 'files'); assert.ok(Array.isArray(selected)); assert.equal(selected[0], source);
		await mounted.event('form', 'onSubmit', { preventDefault() {} }); assert.equal(closes, 1); assert.equal(source.name, '東京 é original.JPG');
	} finally { await mounted.dispose(); }
});

test('explicit Cancel aborts the active gesture and late acknowledged completion cannot close a replacement dialog', async () => {
	const held = deferred<PhotoLibraryImportGestureReceiptV1>(), props = { ...importDialogProps() }; let closes = 0, signal: AbortSignal | undefined;
	props.onClose = () => { closes++; }; props.onImport = (_files, options) => { signal = options?.signal; return held.promise; };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDialog {...props} />);
	try {
		await select(mounted); await mounted.event('form', 'onSubmit', { preventDefault() {} });
		await mounted.event('[data-photo-import-cancel]', 'onClick'); assert.equal(signal?.aborted, true); assert.equal(closes, 1);
		await mounted.render(() => <PhotoImportDialog key="replacement" {...props} />);
		await act(async () => { held.resolve({ ...ack, completion: 'cancelled', notice: 'refresh-failed' }); await settle(); });
		assert.equal(closes, 1);
	} finally { held.resolve(ack); await mounted.dispose(); }
});

test('acknowledged interrupted outcomes close for receipt review while a pre-ack cancellation retains the draft', async () => {
	const props = { ...importDialogProps() }; let closes = 0, calls = 0;
	props.onClose = () => { closes++; }; props.onImport = async () => ++calls === 1 ? { outcome: 'cancelled' } : { ...ack, completion: 'cancelled', notice: 'refresh-failed' };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDialog {...props} />);
	try { await select(mounted); await mounted.event('form', 'onSubmit', { preventDefault() {} }); assert.equal(closes, 0);
		await mounted.event('form', 'onSubmit', { preventDefault() {} }); assert.equal(closes, 1);
	} finally { await mounted.dispose(); }
});

test('collapsing options after a failed preset save retains its name and allocated retry ID', async () => {
	const props = { ...importDialogProps() }, commands: string[] = []; let allocations = 0;
	props.createId = () => `preset${String(++allocations)}`;
	props.applyPreset = async command => { commands.push(command.id); if (commands.length === 1) throw new Error('Conflict'); return { revision: 1, presets: [] }; };
	const mounted = await mountPhotoImportUi(() => <PhotoImportDialog {...props} />);
	try {
		await mounted.event('[data-photo-import-options]', 'onToggle', { currentTarget: { open: true } });
		await mounted.event('[data-import-preset-name]', 'onChange', { currentTarget: { value: '撮影 preset' } });
		await mounted.event('[data-import-preset-save]', 'onClick'); assert.deepEqual(commands, ['preset1']);
		await mounted.event('[data-photo-import-options]', 'onToggle', { currentTarget: { open: false } });
		await mounted.event('[data-photo-import-options]', 'onToggle', { currentTarget: { open: true } });
		assert.equal(Reflect.get(mounted.dom.one('[data-import-preset-name]'), 'value'), '撮影 preset');
		await mounted.event('[data-import-preset-save]', 'onClick'); assert.deepEqual(commands, ['preset1', 'preset1']); assert.equal(allocations, 1);
	} finally { await mounted.dispose(); }
});
