/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { inflateSync } from 'node:zlib';
import PhotoPngExportDialog, { type PhotoPngExportDialogProps } from '../src/common/editor/ui/lightscaper/PhotoPngExportDialog.tsx';
import { PhotoExportDestinations } from '../src/lightscaper/controller/photo-export-destinations.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { createFileSystemPreparedSave } from '../src/common/editor/file-save-stream.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, settle, waitFor } from './helpers/async-test-control.ts';

function fixture() {
	const destinations = new PhotoExportDestinations(), names: string[] = [], outputs: Uint8Array[] = [];
	const runtime = createPhotoDevelopRenderRuntimeV2(), source = Uint8Array.of(0, 0, 0, 255, 200, 0, 0, 255, 0, 200, 0, 255, 200, 200, 0, 255);
	const props: PhotoPngExportDialogProps = { locale: 'en', photoId: 'photo', fileName: 'Export original.jpeg', preparationFailed: false,
		execute: async (action, signal) => { assert.ok(signal); await action({ signal, isCurrent: () => true, refresh: async () => undefined,
			acquire: async () => ({ schemaVersion: 2, read: async () => ({ schemaVersion: 2, catalogId: 'library', photoId: 'photo', revision: 3,
				activeVersionId: 'master', versionId: 'master', versions: [{ id: 'master', name: 'Master', kind: 'master' }],
				develop: defaultImageDevelopStateV2(), history: { cursor: 0, entries: [] }, snapshots: [] }), apply: async () => assert.fail('Export cannot edit') }) }); return 'completed'; },
		withOriginalFrame: async (_request, consume) => consume({ photoId: 'photo', revision: 3, frame: { descriptor: { schemaVersion: 1,
			width: 2, height: 2, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: source } }),
		loadRenderer: async () => runtime, saveRuntime: { maximumStreamingBytes: 536870912, prepareSave(request) {
			assert.ok(typeof request.suggestedName === 'string'); names.push(request.suggestedName); return Promise.resolve(createFileSystemPreparedSave({ fileName: request.suggestedName, signal: request.signal,
				target: { createWritable: async () => ({ write: value => { assert.ok(value instanceof Uint8Array); outputs.push(value.slice()); }, close: () => undefined, abort: () => undefined }) } }));
		}, saveFile: async () => assert.fail('Prepared native export cannot download') },
		registerDestination: destination => destinations.register(destination), onClose: () => undefined };
	return { props, destinations, names, outputs, source };
}
function decode(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), idat: Uint8Array[] = []; let cursor = 8;
	while (cursor < bytes.length) { const length = view.getUint32(cursor), kind = Buffer.from(bytes.subarray(cursor + 4, cursor + 8)).toString('ascii');
		if (kind === 'IDAT') idat.push(bytes.subarray(cursor + 8, cursor + 8 + length)); cursor += length + 12; }
	return { width: view.getUint32(16), height: view.getUint32(20), scanlines: [...inflateSync(Buffer.concat(idat))] };
}

test('the default output controls preserve the original filename and dimensions in the native Save gesture', async () => {
	const f = fixture(), m = await mountPhotoImportUi(() => <PhotoPngExportDialog {...f.props} />);
	try { await act(async () => { await settle(); });
		assert.equal(reactProps(m.dom.one('[data-photo-raster-export-sizing]')).value, 'original');
		assert.equal(reactProps(m.dom.one('[data-photo-raster-export-filename-template]')).value, '{name}');
		await act(async () => { reactProps(m.dom.one('[data-photo-png-export-save]')).onClick?.({}); assert.deepEqual(f.names, ['Export original.png']); await settle(); });
		assert.deepEqual([decode(f.outputs[0]!).width, decode(f.outputs[0]!).height], [2, 2]);
	} finally { await m.dispose(); await f.destinations.retireAndJoin(); }
});

test('a menu-opened export applies output-only sizing and a filename template before synchronously preparing its destination', async () => {
	const f = fixture(), before = f.source.slice(), m = await mountPhotoImportUi(() => <PhotoPngExportDialog {...f.props} />);
	try { await act(async () => { await settle(); });
		await m.event('[data-photo-raster-export-sizing]', 'onChange', { target: { value: 'percentage' } });
		await m.event('[data-photo-raster-export-percentage]', 'onChange', { target: { value: '50' } });
		await m.event('[data-photo-raster-export-resample]', 'onChange', { target: { value: 'bilinear' } });
		await m.event('[data-photo-raster-export-filename-template]', 'onChange', { target: { value: '{name}-{index:3}' } });
		await act(async () => { reactProps(m.dom.one('[data-photo-png-export-save]')).onClick?.({}); assert.deepEqual(f.names, ['Export original-001.png']); await settle(); });
		assert.deepEqual(decode(f.outputs[0]!), { width: 1, height: 1, scanlines: [0, 100, 100, 0, 255] }); assert.deepEqual(f.source, before);
	} finally { await m.dispose(); await f.destinations.retireAndJoin(); }
});

test('invalid filename settings refuse the picker with a useful alert and can be corrected without reopening', async () => {
	const f = fixture(), m = await mountPhotoImportUi(() => <PhotoPngExportDialog {...f.props} />);
	try { await act(async () => { await settle(); });
		await m.event('[data-photo-raster-export-filename-template]', 'onChange', { target: { value: '{clock}' } }); await m.event('[data-photo-png-export-save]', 'onClick');
		assert.deepEqual(f.names, []); assert.match(m.dom.one('[role="alert"]').textContent, /settings/u);
		await m.event('[data-photo-raster-export-filename-template]', 'onChange', { target: { value: '{name}' } }); await m.event('[data-photo-png-export-save]', 'onClick');
		await act(async () => { await settle(); }); assert.deepEqual(f.names, ['Export original.png']);
	} finally { await m.dispose(); await f.destinations.retireAndJoin(); }
});

test('settings cannot change a captured export while its actual native write is held', async () => {
	const f = fixture(), writing = deferred<void>(), release = deferred<void>(); assert.ok(f.props.saveRuntime);
	const props = { ...f.props, saveRuntime: { ...f.props.saveRuntime, prepareSave: (request: Parameters<NonNullable<PhotoPngExportDialogProps['saveRuntime']>['prepareSave']>[0]) =>
		{ assert.ok(typeof request.suggestedName === 'string'); return Promise.resolve(createFileSystemPreparedSave({ fileName: request.suggestedName, signal: request.signal,
			target: { createWritable: async () => ({ write: async () => { writing.resolve(); await release.promise; }, close: () => undefined, abort: () => undefined }) } })); } } };
	const m = await mountPhotoImportUi(() => <PhotoPngExportDialog {...props} />);
	try { await act(async () => { await settle(); }); await m.event('[data-photo-png-export-save]', 'onClick'); await writing.promise;
		await waitFor(() => Object.is(reactProps(m.dom.one('[data-photo-raster-export-sizing]')).disabled, true), 'output settings disabled');
		assert.equal(reactProps(m.dom.one('[data-photo-raster-export-filename-template]')).disabled, true);
	} finally { release.resolve(); await act(async () => { await settle(); }); await m.dispose(); await f.destinations.retireAndJoin(); }
});
