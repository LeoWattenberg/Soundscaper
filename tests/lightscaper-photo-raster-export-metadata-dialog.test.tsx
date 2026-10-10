/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoPngExportDialog, { type PhotoPngExportDialogProps } from '../src/common/editor/ui/lightscaper/PhotoPngExportDialog.tsx';
import { PhotoExportDestinations } from '../src/lightscaper/controller/photo-export-destinations.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { readImageMetadataV1 } from '../src/common/editor/imaging/image-metadata-reader-v1.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { createFileSystemPreparedSave } from '../src/common/editor/file-save-stream.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, settle, waitFor } from './helpers/async-test-control.ts';

function fixture() {
	const destinations = new PhotoExportDestinations(), names: string[] = [], outputs: Uint8Array[] = [];
	const runtime = createPhotoDevelopRenderRuntimeV2(), source = Uint8Array.of(9, 81, 173, 255); let metadataCalls = 0;
	const props: PhotoPngExportDialogProps = { locale: 'en', photoId: 'photo', fileName: 'original.jpg', preparationFailed: false,
		execute: async (action, signal) => { assert.ok(signal); await action({ signal, isCurrent: () => true, refresh: async () => undefined,
			acquire: async () => ({ schemaVersion: 2, read: async () => ({ schemaVersion: 2, catalogId: 'library', photoId: 'photo', revision: 3,
				activeVersionId: 'master', versionId: 'master', versions: [{ id: 'master', name: 'Master', kind: 'master' }],
				develop: defaultImageDevelopStateV2(), history: { cursor: 0, entries: [] }, snapshots: [] }), apply: async () => assert.fail('Export cannot edit') }) }); return 'completed'; },
		withOriginalFrame: async (_request, consume) => consume({ photoId: 'photo', revision: 3, frame: { descriptor: { schemaVersion: 1,
			width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: source } }),
		loadRenderer: async () => runtime, saveRuntime: { maximumStreamingBytes: 536870912, prepareSave(request) {
			assert.ok(typeof request.suggestedName === 'string'); names.push(request.suggestedName); return createFileSystemPreparedSave({ fileName: request.suggestedName, signal: request.signal,
				target: { createWritable: async () => ({ write: value => { assert.ok(value instanceof Uint8Array); outputs.push(value.slice()); }, close: () => undefined, abort: () => undefined }) } });
		}, saveFile: async () => assert.fail('Prepared native export cannot download') },
		readMetadata: async () => { metadataCalls++; return { catalogId: 'library', snapshot: { photoId: 'photo', revision: 3,
			metadata: photoArchiveFixture().photo.metadata, originalFileName: 'original.jpg', originalSha256: 'a'.repeat(64),
			extracted: { schemaVersion: 1, container: 'jpeg', iptc: null, issues: [], exif: { orientation: 8, cameraMake: 'Stored camera',
				cameraModel: null, lensModel: null, artist: null, copyright: null, description: null, exposureSeconds: 1 / 125,
				aperture: null, iso: null, focalLengthMm: null, captureTime: null } } } }; },
		registerDestination: destination => destinations.register(destination), onClose: () => undefined };
	return { props, destinations, names, outputs, source, get metadataCalls() { return metadataCalls; } };
}

test('the opted-in dialog defaults to Strip and exposes bounded Capture inclusion without changing PNG pixels', async () => {
	const f = fixture(), before = f.source.slice(), mounted = await mountPhotoImportUi(() => <PhotoPngExportDialog {...f.props} />);
	try {
		await act(async () => { await settle(); }); assert.equal(reactProps(mounted.dom.one('[data-photo-raster-export-metadata]')).value, 'strip');
		assert.match(mounted.dom.one('[data-photo-raster-export-metadata-help]').textContent, /capture|GPS|ASCII/u);
		await mounted.event('[data-photo-png-export-save]', 'onClick'); await act(async () => { await waitFor(() => f.outputs.length === 1, 'Strip PNG'); });
		assert.equal(f.metadataCalls, 0); assert.equal(readImageMetadataV1(f.outputs[0]!).exif, null);
		await mounted.event('[data-photo-raster-export-metadata]', 'onChange', { target: { value: 'capture' } });
		await act(async () => { reactProps(mounted.dom.one('[data-photo-png-export-save]')).onClick?.({}); assert.deepEqual(f.names, ['original.png', 'original.png']);
			await waitFor(() => f.outputs.length === 2, 'Capture PNG'); });
		assert.equal(f.metadataCalls, 1); assert.equal(readImageMetadataV1(f.outputs[1]!).exif?.cameraMake, 'Stored camera');
		assert.deepEqual(f.source, before);
	} finally { await mounted.dispose(); await f.destinations.retireAndJoin(); }
});

test('Capture scope is frozen in the native Save gesture and controls disable through a held metadata read', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>(), read = f.props.readMetadata!;
	const props = { ...f.props, readMetadata: async (...args: Parameters<typeof read>) => { entered.resolve(); await release.promise; return read(...args); } };
	const mounted = await mountPhotoImportUi(() => <PhotoPngExportDialog {...props} />);
	try {
		await act(async () => { await settle(); }); await mounted.event('[data-photo-raster-export-metadata]', 'onChange', { target: { value: 'capture' } });
		await mounted.event('[data-photo-png-export-save]', 'onClick'); await entered.promise;
		assert.deepEqual(f.names, ['original.png']); assert.equal(reactProps(mounted.dom.one('[data-photo-raster-export-metadata]')).disabled, true);
		release.resolve(); await act(async () => { await waitFor(() => f.outputs.length === 1, 'held Capture delivery'); });
		assert.equal(readImageMetadataV1(f.outputs[0]!).exif?.cameraMake, 'Stored camera');
	} finally { release.resolve(); await mounted.dispose(); await f.destinations.retireAndJoin(); }
});

test('unrepresentable stored capture facts refuse visibly and Strip remains recoverable in the same dialog', async () => {
	const f = fixture(), read = f.props.readMetadata!;
	const props = { ...f.props, readMetadata: async (...args: Parameters<typeof read>) => { const result = await read(...args);
		assert.ok(result.snapshot.extracted?.exif); return { ...result, snapshot: { ...result.snapshot, extracted: { ...result.snapshot.extracted,
			exif: { ...result.snapshot.extracted.exif, exposureSeconds: 1e-12 } } } }; } };
	const mounted = await mountPhotoImportUi(() => <PhotoPngExportDialog {...props} />);
	try {
		await act(async () => { await settle(); }); await mounted.event('[data-photo-raster-export-metadata]', 'onChange', { target: { value: 'capture' } });
		await mounted.event('[data-photo-png-export-save]', 'onClick');
		await act(async () => { await waitFor(() => mounted.dom.find('[data-photo-raster-export-metadata-error]') !== null, 'metadata refusal'); });
		assert.match(mounted.dom.one('[data-photo-raster-export-metadata-error]').textContent, /Capture|Strip/u); assert.deepEqual(f.outputs, []);
		assert.equal(reactProps(mounted.dom.one('[data-photo-png-export-save]')).disabled, false);
		await mounted.event('[data-photo-raster-export-metadata]', 'onChange', { target: { value: 'strip' } }); await mounted.event('[data-photo-png-export-save]', 'onClick');
		await act(async () => { await waitFor(() => f.outputs.length === 1, 'recovered Strip PNG'); }); assert.equal(readImageMetadataV1(f.outputs[0]!).exif, null);
	} finally { await mounted.dispose(); await f.destinations.retireAndJoin(); }
});
