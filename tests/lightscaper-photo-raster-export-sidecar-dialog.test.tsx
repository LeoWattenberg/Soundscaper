/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoPngExportDialog, { type PhotoPngExportDialogProps } from '../src/common/editor/ui/lightscaper/PhotoPngExportDialog.tsx';
import { PhotoExportDestinations } from '../src/lightscaper/controller/photo-export-destinations.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { createPhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../src/lightscaper/catalog/photo-export-sidecar-v1.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, settle, waitFor } from './helpers/async-test-control.ts';

function fixture() {
	const destinations = new PhotoExportDestinations(), saves: string[] = [], codecSource = Uint8Array.of(29, 101, 197, 255);
	const photo = normalizePhotoDocumentV2({ ...photoArchiveFixture().photo, schemaVersion: 2,
		versions: [{ ...photoArchiveFixture().photo.versions[0]!, develop: defaultImageDevelopStateV2() }] });
	let captures = 0, reads = 0, failed = false, renders = 0, pickers = 0;
	const props: PhotoPngExportDialogProps = { locale: 'en', photoId: photo.id, fileName: 'Original.jpg', preparationFailed: false,
		execute: async (action, signal) => { assert.ok(signal); await action({ signal, isCurrent: () => true, refresh: async () => undefined,
			acquire: async () => ({ schemaVersion: 2, read: async () => ({ schemaVersion: 2, catalogId: photo.catalogId, photoId: photo.id, revision: photo.revision,
				activeVersionId: photo.activeVersionId, versionId: photo.activeVersionId, versions: photo.versions.map(({ id, name, kind }) => ({ id, name, kind })),
				develop: photo.versions[0]!.develop, history: { cursor: 0, entries: [] }, snapshots: [] }), apply: async () => assert.fail('No edits') }) }); return 'completed'; },
		withOriginalFrame: async (_request, consume) => { renders++; return consume({ photoId: photo.id, revision: photo.revision,
			frame: { descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: codecSource } }); },
		loadRenderer: async () => createPhotoDevelopRenderRuntimeV2(),
		captureSidecarReader: () => { captures++; return async binding => { reads++; return serializePhotoExportSidecarV1(createPhotoExportSidecarV1(photo, binding)); }; },
		saveRuntime: { maximumStreamingBytes: 536870912,
			prepareSave: () => { pickers++; return { mode: 'blob', target: { browserDownload: true }, fileName: 'Picked.png' }; },
			saveFile: async request => { assert.ok(request.blob); assert.equal(typeof request.suggestedName, 'string'); const name = request.suggestedName as string; if (request.mimeType === 'application/json' && failed) throw Symbol('Sidecar failed');
				saves.push(name); return { method: 'download', fileName: name, size: request.blob.size }; } },
		registerDestination: cancel => destinations.register(cancel), onClose: () => undefined };
	return { props, destinations, saves, setFailed: (value: boolean) => { failed = value; }, get captures() { return captures; }, get reads() { return reads; }, get renders() { return renders; }, get pickers() { return pickers; } };
}

test('single raster dialog offers default-off JSON; Save captures reader before picker and preserves actual naming', async () => {
	const f = fixture(), mounted = await mountPhotoImportUi(() => <PhotoPngExportDialog {...f.props} />);
	try { await act(async () => { await settle(); });
		assert.equal(reactProps(mounted.dom.one('[data-photo-raster-export-sidecar]')).checked, false);
		await mounted.event('[data-photo-png-export-save]', 'onClick'); await act(async () => { await waitFor(() => f.saves.length === 1, 'default raster'); });
		assert.equal(f.captures, 0); assert.equal(f.reads, 0);
		await mounted.event('[data-photo-raster-export-sidecar]', 'onChange', { target: { checked: true } });
		await act(async () => { reactProps(mounted.dom.one('[data-photo-png-export-save]')).onClick?.({});
			assert.equal(f.captures, 1); assert.equal(f.pickers, 2); await waitFor(() => f.saves.length === 3, 'sidecar'); });
		assert.deepEqual(f.saves, ['Picked.png', 'Picked.png', 'Picked.png.lightscaper.json']); assert.equal(f.reads, 2);
	} finally { await mounted.dispose(); await f.destinations.retireAndJoin(); }
});

test('partial JSON outcome keeps image receipt and exposes sidecar-only retry without duplicate raster', async () => {
	const f = fixture(); f.setFailed(true); const mounted = await mountPhotoImportUi(() => <PhotoPngExportDialog {...f.props} />);
	try { await act(async () => { await settle(); }); await mounted.event('[data-photo-raster-export-sidecar]', 'onChange', { target: { checked: true } });
		await mounted.event('[data-photo-png-export-save]', 'onClick');
		await act(async () => { await waitFor(() => mounted.dom.find('[data-photo-raster-export-sidecar-partial]') !== null, 'partial sidecar'); });
		assert.equal(reactProps(mounted.dom.one('[data-photo-png-export-receipt]'))['data-photo-png-export-status'], 'download-started');
		assert.match(mounted.dom.one('[data-photo-raster-export-sidecar-partial]').textContent, /image|raster|already/iu);
		f.setFailed(false); await mounted.event('[data-photo-raster-export-sidecar-retry]', 'onClick');
		await act(async () => { await waitFor(() => f.saves.length === 2, 'retry'); });
		assert.deepEqual(f.saves, ['Picked.png', 'Picked.png.lightscaper.json']); assert.equal(f.renders, 1); assert.equal(f.pickers, 1); assert.equal(f.captures, 1);
	} finally { await mounted.dispose(); await f.destinations.retireAndJoin(); }
});

test('Close joins a held JSON download before the destination generation retires', async () => {
	const f = fixture(), entered = deferred<void>(), release = deferred<void>(), nativeSave = f.props.saveRuntime!.saveFile; let closed = false;
	const props: PhotoPngExportDialogProps = { ...f.props, onClose: () => { closed = true; }, saveRuntime: { ...f.props.saveRuntime!,
		saveFile: async request => { if (request.mimeType === 'application/json') { entered.resolve(); await release.promise; request.signal!.throwIfAborted(); }
			return nativeSave(request); } } };
	const mounted = await mountPhotoImportUi(() => <PhotoPngExportDialog {...props} />);
	try { await act(async () => { await settle(); }); await mounted.event('[data-photo-raster-export-sidecar]', 'onChange', { target: { checked: true } });
		await mounted.event('[data-photo-png-export-save]', 'onClick'); await entered.promise;
		await mounted.event('[data-photo-png-export-close]', 'onClick'); assert.equal(closed, false); assert.deepEqual(f.saves, ['Picked.png']);
		release.resolve(); await act(async () => { await waitFor(() => closed, 'joined close'); });
	} finally { release.resolve(); await mounted.dispose(); await f.destinations.retireAndJoin(); }
});
