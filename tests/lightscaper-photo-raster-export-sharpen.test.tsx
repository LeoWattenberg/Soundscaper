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
import { settle } from './helpers/async-test-control.ts';

function fixture() {
	const destinations = new PhotoExportDestinations(), outputs: Uint8Array[] = [], names: string[] = [];
	const props: PhotoPngExportDialogProps = { locale: 'en', photoId: 'photo', fileName: 'Export original.png', preparationFailed: false,
		execute: async (action, signal) => { assert.ok(signal); await action({ signal, isCurrent: () => true, refresh: async () => undefined,
			acquire: async () => ({ schemaVersion: 2, read: async () => ({ schemaVersion: 2, catalogId: 'library', photoId: 'photo', revision: 3,
				activeVersionId: 'master', versionId: 'master', versions: [{ id: 'master', name: 'Master', kind: 'master' }],
				develop: defaultImageDevelopStateV2(), history: { cursor: 0, entries: [] }, snapshots: [] }), apply: async () => assert.fail('Output cannot edit') }) }); return 'completed'; },
		withOriginalFrame: async (_request, consume) => consume({ photoId: 'photo', revision: 3, frame: { descriptor: { schemaVersion: 1,
			width: 4, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: Uint8Array.of(40, 40, 40, 255, 100, 100, 100, 255, 160, 160, 160, 255, 220, 220, 220, 255) } }),
		loadRenderer: async () => createPhotoDevelopRenderRuntimeV2(), saveRuntime: { maximumStreamingBytes: 536870912, prepareSave(request) {
			assert.ok(typeof request.suggestedName === 'string'); names.push(request.suggestedName);
			return Promise.resolve(createFileSystemPreparedSave({ fileName: request.suggestedName, signal: request.signal,
				target: { createWritable: async () => ({ write: value => { assert.ok(value instanceof Uint8Array); outputs.push(value.slice()); }, close: () => undefined, abort: () => undefined }) } }));
		}, saveFile: async () => assert.fail('Native export cannot download') }, registerDestination: callback => destinations.register(callback), onClose: () => undefined };
	return { props, destinations, outputs, names };
}
function rgba(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), idat: Uint8Array[] = []; let cursor = 8;
	while (cursor < bytes.length) { const size = view.getUint32(cursor), kind = Buffer.from(bytes.subarray(cursor + 4, cursor + 8)).toString('ascii');
		if (kind === 'IDAT') idat.push(bytes.subarray(cursor + 8, cursor + 8 + size)); cursor += size + 12; }
	const row = inflateSync(Buffer.concat(idat)); assert.equal(row[0], 0); return [...row.subarray(1)];
}

test('optional sharpening starts off and Save captures its parameters synchronously after output sizing', async () => {
	const f = fixture(), m = await mountPhotoImportUi(() => <PhotoPngExportDialog {...f.props} />);
	try { await act(async () => { await settle(); });
		assert.equal(reactProps(m.dom.one('[data-photo-raster-export-sharpen]')).checked, false); assert.equal(m.dom.find('[data-photo-raster-export-sharpen-amount]'), null);
		await m.event('[data-photo-raster-export-sizing]', 'onChange', { target: { value: 'percentage' } });
		await m.event('[data-photo-raster-export-percentage]', 'onChange', { target: { value: '50' } });
		await m.event('[data-photo-raster-export-resample]', 'onChange', { target: { value: 'nearest' } });
		await m.event('[data-photo-raster-export-sharpen]', 'onChange', { target: { checked: true } });
		await act(async () => { reactProps(m.dom.one('[data-photo-png-export-save]')).onClick?.({}); assert.deepEqual(f.names, ['Export original.png']); await settle(); });
		assert.deepEqual(rgba(f.outputs[0]!), [10, 10, 10, 255, 190, 190, 190, 255]);
	} finally { await m.dispose(); await f.destinations.retireAndJoin(); }
});

test('invalid sharpening parameters show a recoverable settings alert before the native picker', async () => {
	const f = fixture(), m = await mountPhotoImportUi(() => <PhotoPngExportDialog {...f.props} />);
	try { await act(async () => { await settle(); }); await m.event('[data-photo-raster-export-sharpen]', 'onChange', { target: { checked: true } });
		await m.event('[data-photo-raster-export-sharpen-amount]', 'onChange', { target: { value: '201' } }); await m.event('[data-photo-png-export-save]', 'onClick');
		assert.deepEqual(f.names, []); assert.match(m.dom.one('[role="alert"]').textContent, /settings/u);
		await m.event('[data-photo-raster-export-sharpen-amount]', 'onChange', { target: { value: '100' } });
		await m.event('[data-photo-raster-export-sharpen-threshold]', 'onChange', { target: { value: '1.5' } }); await m.event('[data-photo-png-export-save]', 'onClick'); assert.deepEqual(f.names, []);
		await m.event('[data-photo-raster-export-sharpen-threshold]', 'onChange', { target: { value: '0' } }); await m.event('[data-photo-png-export-save]', 'onClick');
		await act(async () => { await settle(); }); assert.deepEqual(f.names, ['Export original.png']); assert.deepEqual(rgba(f.outputs[0]!), [25, 25, 25, 255, 100, 100, 100, 255, 160, 160, 160, 255, 235, 235, 235, 255]);
	} finally { await m.dispose(); await f.destinations.retireAndJoin(); }
});
