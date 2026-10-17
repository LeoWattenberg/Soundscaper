/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoPngExportDialog, { type PhotoPngExportDialogProps } from '../src/common/editor/ui/lightscaper/PhotoPngExportDialog.tsx';
import PhotoJpegExportDialog from '../src/common/editor/ui/lightscaper/PhotoJpegExportDialog.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { mountedExportDialog } from './helpers/audio-editor-export-dialog-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { settle } from './helpers/async-test-control.ts';
import { inflateSync } from 'node:zlib';
import { createFileSystemPreparedSave } from '../src/common/editor/file-save-stream.ts';
import { captureImageExportGraphicRequest, imageExportGraphicPlacement } from '../src/common/editor/image-export-graphic-request.ts';

function photoProps(): PhotoPngExportDialogProps {
	return { locale: 'en', photoId: 'photo', fileName: 'Original.png', preparationFailed: false,
		execute: async (action, signal) => { assert.ok(signal); await action({ signal, isCurrent: () => true, refresh: async () => undefined,
			acquire: async () => ({ schemaVersion: 2, read: async () => ({ schemaVersion: 2, catalogId: 'catalog', photoId: 'photo', revision: 3,
				activeVersionId: 'master', versionId: 'master', versions: [{ id: 'master', name: 'Master', kind: 'master' }],
				develop: defaultImageDevelopStateV2(), history: { cursor: 0, entries: [] }, snapshots: [] }), apply: async () => assert.fail('Export cannot edit') }) }); return 'completed'; },
		withOriginalFrame: async (_request, consume) => consume({ photoId: 'photo', revision: 3, frame: { descriptor: { schemaVersion: 1,
			width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: Uint8Array.of(40, 40, 40, 255) } }),
		loadRenderer: async () => createPhotoDevelopRenderRuntimeV2(), saveRuntime: { maximumStreamingBytes: 536870912,
			prepareSave: () => ({ mode: 'cancelled', cancelled: true, fileName: 'Original.png' }), saveFile: async () => assert.fail('cancelled picker cannot save') },
		registerDestination: () => () => undefined, onClose: () => undefined };
}

for (const [format, Dialog] of [['png', PhotoPngExportDialog], ['jpeg', PhotoJpegExportDialog]] as const) {
	test(`real ${format} File-export dialog offers an initially disabled optional graphic selection`, async () => {
		const mounted = await mountPhotoImportUi(() => <Dialog {...photoProps()} />);
		try {
			await act(async () => { await settle(); });
			assert.equal(reactProps(mounted.dom.one('[data-image-export-graphic-enabled]')).checked, false);
			assert.equal(mounted.dom.find('[data-image-export-graphic-file]'), null);
			await mounted.event('[data-image-export-graphic-enabled]', 'onChange', { currentTarget: { checked: true } });
			assert.ok(mounted.dom.one('[data-image-export-graphic-file]'));
			assert.equal(reactProps(mounted.dom.one('[data-image-export-graphic-anchor]')).value, 'bottom-right');
		} finally { await mounted.dispose(); }
	});
}

test('real Frame File-export dialog offers graphic controls only for the opted-in video delivery', async () => {
	const mounted = await mountedExportDialog({ productId: 'framescaper', video: true });
	try {
		assert.equal(mounted.dom.find('[data-image-export-graphic-enabled]'), null);
		await mounted.chooseFormat(ENGLISH_COPY.videoExportMp4);
		assert.equal(reactProps(mounted.dom.one('[data-image-export-graphic-enabled]')).checked, false);
		await mounted.startExport();
		assert.equal(Object.hasOwn(mounted.requests[0]!, 'graphicWatermark'), false);
	} finally { await mounted.unmount(); }
});

test('graphic capture freezes closed gesture settings and uses the same file ceiling as the real reader', () => {
	const body = new File([Uint8Array.of(1)], 'mark.png'), input = { body, anchor: 'bottom-right', widthFraction: 0.25, marginFraction: 0.02, opacity: 1 };
	const captured = captureImageExportGraphicRequest(input); input.opacity = 0; assert.equal(captured.opacity, 1); assert.ok(Object.isFrozen(captured));
	assert.equal(captured.body, body); assert.deepEqual(imageExportGraphicPlacement(captured, 100, 50), { anchor: 'bottom-right', widthFraction: 0.25, marginPixels: 1, opacity: 1 });
	assert.throws(() => captureImageExportGraphicRequest({ ...input, body: new Blob([new Uint8Array(64 * 1024 * 1024 + 1)]) }), /byte limit/u);
	assert.throws(() => captureImageExportGraphicRequest({ ...input, preset: 'persisted' }), /field/u);
	assert.throws(() => captureImageExportGraphicRequest({ ...input, marginFraction: 0.5 }), /margin/u);
});

test('Photo Save captures a rearmed file and refuses invalid placement before the native picker, then recovers', async () => {
	const body = new File([Uint8Array.of(1)], 'mark.png'), picker = { files: [body], value: 'mark.png' }, prepared: string[] = [];
	const props = photoProps();
	const mounted = await mountPhotoImportUi(() => <PhotoPngExportDialog {...props} saveRuntime={{ maximumStreamingBytes: 536870912,
		prepareSave: request => { assert.ok(typeof request.suggestedName === 'string'); prepared.push(request.suggestedName); return { mode: 'cancelled', cancelled: true, fileName: request.suggestedName }; }, saveFile: async () => assert.fail('Dismissed picker cannot publish') }} />);
	try {
		await act(async () => { await settle(); });
		await mounted.event('[data-image-export-graphic-enabled]', 'onChange', { currentTarget: { checked: true } });
		await mounted.event('[data-image-export-graphic-file]', 'onChange', { currentTarget: picker }); assert.equal(picker.value, '');
		await mounted.event('[data-image-export-graphic-opacity]', 'onChange', { currentTarget: { value: '101' } });
		await mounted.event('[data-photo-png-export-save]', 'onClick'); assert.deepEqual(prepared, []); assert.match(mounted.dom.one('[role="alert"]').textContent, /settings/u);
		await mounted.event('[data-image-export-graphic-opacity]', 'onChange', { currentTarget: { value: '50' } });
		await act(async () => { reactProps(mounted.dom.one('[data-photo-png-export-save]')).onClick?.({}); assert.deepEqual(prepared, ['Original.png']); await settle(); });
		assert.equal(mounted.dom.one('[data-photo-png-export-status]').getAttribute('data-photo-png-export-status'), 'cancelled');
	} finally { await mounted.dispose(); }
});

test('a replaced Photo library owner clears the prior ephemeral graphic even when the selected photo id is unchanged', async () => {
	let props = photoProps();
	const mounted = await mountPhotoImportUi(() => <PhotoPngExportDialog {...props} />);
	try {
		await act(async () => { await settle(); });
		await mounted.event('[data-image-export-graphic-enabled]', 'onChange', { currentTarget: { checked: true } });
		await mounted.event('[data-image-export-graphic-file]', 'onChange', { currentTarget: { files: [new File([Uint8Array.of(1)], 'prior.png')], value: 'prior.png' } });
		props = photoProps(); await mounted.render();
		assert.equal(reactProps(mounted.dom.one('[data-image-export-graphic-enabled]')).checked, false);
		assert.equal(mounted.dom.find('[data-image-export-graphic-file]'), null);
		await act(async () => { await settle(); });
		await mounted.event('[data-image-export-graphic-enabled]', 'onChange', { currentTarget: { checked: true } });
		await mounted.event('[data-photo-png-export-save]', 'onClick');
		assert.match(mounted.dom.one('[role="alert"]').textContent, /settings/u);
	} finally { await mounted.dispose(); }
});

test('Frame Save captures the ephemeral graphic separately from delivery preset scalars and clears it for a replaced owner', async () => {
	const mounted = await mountedExportDialog({ productId: 'framescaper', video: true }), body = new File([Uint8Array.of(1)], 'mark.png'), picker = { files: [body], value: 'mark.png' };
	try {
		await mounted.chooseFormat(ENGLISH_COPY.videoExportMp4);
		await act(async () => { reactProps(mounted.dom.one('[data-image-export-graphic-enabled]')).onChange({ currentTarget: { checked: true } }); });
		await act(async () => { reactProps(mounted.dom.one('[data-image-export-graphic-file]')).onChange({ currentTarget: picker }); });
		assert.equal(picker.value, ''); await mounted.startExport();
		const graphic = mounted.requests[0]!.graphicWatermark as { body: Blob; widthFraction: number };
		assert.equal(graphic.body, body); assert.equal(graphic.widthFraction, 0.25); assert.ok(Object.isFrozen(graphic));
		assert.equal(Object.hasOwn(mounted.requests[0]!, 'body'), false);
		await mounted.publish({ fileName: 'done.mp4', url: 'blob:done' });
		assert.equal(reactProps(mounted.dom.one('[data-image-export-graphic-enabled]')).checked, false);
	} finally { await mounted.unmount(); }
});

test('the real PNG dialog sends its captured file through scoped compositing and the original synchronous native save gesture', async () => {
	const body = new File([Uint8Array.of(1)], 'mark.png'), picked: string[] = [], saved: Uint8Array[] = [], pixels = Uint8Array.of(255, 0, 0, 255);
	const props = photoProps();
	const mounted = await mountPhotoImportUi(() => <PhotoPngExportDialog {...props} withGraphicFrame={async (value, consume) => {
		assert.equal((value as { body: Blob }).body, body); try { return await consume({ descriptor: { schemaVersion: 1, width: 1, height: 1,
			sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels }, { orientation: 1, runtimeVersion: 'fixture' }); } finally { pixels.fill(0); }
	}} saveRuntime={{ maximumStreamingBytes: 536870912, prepareSave: request => {
		assert.ok(typeof request.suggestedName === 'string'); picked.push(request.suggestedName); return createFileSystemPreparedSave({ fileName: request.suggestedName, signal: request.signal,
			target: { createWritable: async () => ({ write: value => { assert.ok(value instanceof Uint8Array); saved.push(value.slice()); }, close: () => undefined, abort: () => undefined }) } });
	}, saveFile: async () => assert.fail('Native export cannot download') }} />);
	try {
		await act(async () => { await settle(); });
		await mounted.event('[data-image-export-graphic-enabled]', 'onChange', { currentTarget: { checked: true } });
		await mounted.event('[data-image-export-graphic-file]', 'onChange', { currentTarget: { files: [body], value: 'mark.png' } });
		await act(async () => { reactProps(mounted.dom.one('[data-photo-png-export-save]')).onClick?.({}); assert.deepEqual(picked, ['Original.png']); await settle(); });
		assert.equal(saved.length, 1); const bytes = saved[0]!, data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), idat: Uint8Array[] = [];
		for (let cursor = 8; cursor < bytes.length;) { const count = data.getUint32(cursor); if (Buffer.from(bytes.subarray(cursor + 4, cursor + 8)).toString('ascii') === 'IDAT') idat.push(bytes.subarray(cursor + 8, cursor + 8 + count)); cursor += count + 12; }
		assert.deepEqual([...inflateSync(Buffer.concat(idat))], [0, 255, 0, 0, 255]); assert.ok(pixels.every(value => value === 0));
	} finally { await mounted.dispose(); }
});
