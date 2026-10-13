/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoFramescaperCollectionHandoffDialog, { type PhotoFramescaperCollectionHandoffDialogProps } from '../src/common/editor/ui/lightscaper/PhotoFramescaperCollectionHandoffDialog.tsx';
import type { PhotoFramescaperCollectionHandoffTargetCurrentV1 } from '../src/lightscaper/controller/photo-framescaper-collection-handoff-download-current-v1.ts';
import { PhotoExportDestinations } from '../src/lightscaper/controller/photo-export-destinations.ts';
import { repairSequenceCurrentFixture } from './helpers/lightscaper-repair-sequence-current-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { settle, waitFor } from './helpers/async-test-control.ts';

// This seam proves dialog dispatch, gesture and acknowledgment. The dedicated
// native archive tests own the generated archive's contents and Frame rendering.
for (const locale of ['en', 'de']) test(`Current ${locale} collection dialog dispatches its native child through Current delivery`, async () => {
	const f = await repairSequenceCurrentFixture(), destinations = new PhotoExportDestinations(), events: string[] = [];
	const child = f.session.collectionHandoffCurrent; assert.ok(child);
	const target: PhotoFramescaperCollectionHandoffTargetCurrentV1 = { schemaVersion: 2, capture: child, binding: f.manualBinding, checkCurrent: async () => undefined };
	const blob = new Blob([Uint8Array.of(1, 2, 3)]);
	const runtime: NonNullable<PhotoFramescaperCollectionHandoffDialogProps['saveRuntime']> = {
		maximumStreamingBytes: 536870912,
		prepareSave() { assert.equal(this, runtime); events.push('picker'); return { mode: 'blob', fileName: 'Sequence.fscape', target: { browserDownload: true } }; },
		async saveFile(request) { assert.equal(this, runtime); assert.equal(request.blob, blob); events.push('delivery'); return { method: 'download', fileName: 'Sequence.fscape', size: blob.size }; },
	};
	const props: PhotoFramescaperCollectionHandoffDialogProps = {
		locale, isCurrent: () => true, saveRuntime: runtime, registerDestination: cancel => destinations.register(cancel), onClose() {},
		capture: { readCatalogPage: async () => ({ rootRevision: f.root.revision, parent: null, selected: null, cursor: null, rows: [{ kind: 'collection', id: f.manualBinding.collectionId, name: 'Manual selected', collectionKind: 'manual' }] }),
			readSavedPage: async () => ({ items: [], cursor: null }), prepare: async () => ({ target, fileName: 'Sequence.fscape' }) },
		buildArchive: async () => assert.fail('Current target entered the permanent legacy producer.'),
		async buildArchiveCurrent(request) {
			assert.equal(this.buildArchiveCurrent, props.buildArchiveCurrent); events.push('archive'); assert.deepEqual(request.binding, f.manualBinding);
			await request.capture.withCapture(request.binding, view => { assert.equal(view.schemaVersion, 2); assert.equal(view.photos.length, f.selectedPhotos.length); }, { signal: request.signal });
			return { blob, fileName: 'Sequence.fscape', projectId: 'project', sequenceId: 'sequence', photoCount: f.selectedPhotos.length };
		},
	};
	const mounted = await mountPhotoImportUi(() => <PhotoFramescaperCollectionHandoffDialog {...props} />);
	const event = async (selector: string, handler: string, value: unknown = {}) => { await act(async () => { reactProps(mounted.dom.one(selector))[handler]?.(value); await settle(); }); };
	try {
		await event('[data-photo-collection-handoff-scope]', 'onChange', { currentTarget: { value: 'catalog' } });
		await waitFor(() => mounted.dom.container.querySelector(`[data-definition-choose="${f.manualBinding.collectionId}"]`) !== null, 'native collection choice');
		await event(`[data-definition-choose="${f.manualBinding.collectionId}"]`, 'onClick');
		await waitFor(() => mounted.dom.one('[data-photo-collection-handoff-download]').disabled === false, 'Current target readiness');
		await act(async () => { reactProps(mounted.dom.one('[data-photo-collection-handoff-download]')).onClick?.({}); assert.deepEqual(events, ['picker']); await settle(); });
		await waitFor(async () => { await act(async () => { await settle(); }); return mounted.dom.container.querySelector('[data-photo-collection-handoff-receipt]') !== null; }, 'Current native delivery acknowledgment');
		assert.deepEqual(events, ['picker', 'archive', 'delivery']); assert.equal(mounted.dom.one('[data-photo-collection-handoff-receipt]').getAttribute('data-photo-collection-handoff-receipt'), 'download-started');
	} finally { await mounted.dispose(); await destinations.retireAndJoin(); await f.close(); }
});
