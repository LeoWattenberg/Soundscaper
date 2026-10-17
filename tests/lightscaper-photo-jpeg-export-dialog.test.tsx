/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act, StrictMode } from 'react';
import PhotoJpegExportDialog, { type PhotoJpegExportDialogProps } from '../src/common/editor/ui/lightscaper/PhotoJpegExportDialog.tsx';
import { PhotoExportDestinations } from '../src/lightscaper/controller/photo-export-destinations.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { createFileSystemPreparedSave } from '../src/common/editor/file-save-stream.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, settle, waitFor } from './helpers/async-test-control.ts';

// Structural adapter output only; browser tests independently decode the native JPEG.
const JPEG = Uint8Array.of(255, 216, 255, 192, 0, 17, 8, 0, 1, 0, 1, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0,
	255, 218, 0, 12, 3, 1, 0, 2, 17, 3, 17, 0, 63, 0, 7, 255, 217);
function codec(context: TestContext, pixels: number[]) {
	const calls: ImageEncodeOptions[] = [], seen: number[][] = [], canvas: Canvas[] = [];
	let encode = () => Promise.resolve(new Blob([JPEG], { type: 'image/jpeg' }));
	class Data { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} }
	class Canvas {
		constructor(public width: number, public height: number) { canvas.push(this); }
		getContext() { return { putImageData: (image: Data) => { assert.deepEqual([image.width, image.height], [1, 1]); seen.push([...image.data]); assert.deepEqual([...image.data], pixels); } }; }
		convertToBlob(options: ImageEncodeOptions) { calls.push(options); return encode(); }
	}
	for (const [name, value] of Object.entries({ ImageData: Data, OffscreenCanvas: Canvas })) {
		const original = Object.getOwnPropertyDescriptor(globalThis, name); Object.defineProperty(globalThis, name, { configurable: true, value });
		context.after(() => { if (original) Object.defineProperty(globalThis, name, original); else Reflect.deleteProperty(globalThis, name); });
	}
	return { calls, seen, canvas, hold: (work: () => Promise<Blob>) => { encode = work; } };
}
function fixture(alpha = 255) {
	const events: string[] = [], outputs: Uint8Array[] = [], destinations = new PhotoExportDestinations();
	const props: PhotoJpegExportDialogProps = { locale: 'en', photoId: 'photo', fileName: 'Export original.png', preparationFailed: false,
		execute: async (action, signal) => { assert.ok(signal); await action({ signal, isCurrent: () => true, refresh: async () => undefined,
			acquire: async () => ({ schemaVersion: 2, read: async () => ({ schemaVersion: 2, catalogId: 'library', photoId: 'photo', revision: 3,
				activeVersionId: 'master', versionId: 'master', versions: [{ id: 'master', name: 'Master', kind: 'master' }],
				develop: defaultImageDevelopStateV2(), history: { cursor: 0, entries: [] }, snapshots: [] }), apply: async () => assert.fail('Export cannot edit') }) }); return 'completed'; },
		withOriginalFrame: async (_request, consume) => { const result = await consume({ photoId: 'photo', revision: 3,
			frame: { descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: Uint8Array.of(137, 0, 0, alpha) } });
			events.push('original-settled'); return result; }, loadRenderer: async () => createPhotoDevelopRenderRuntimeV2(),
		saveRuntime: { maximumStreamingBytes: 536870912, prepareSave(request) {
			events.push('picker'); assert.equal(request.mimeType, 'image/jpeg'); assert.equal(request.suggestedName, 'Export original.jpg');
			assert.deepEqual(request.types, [{ description: 'JPEG image', accept: { 'image/jpeg': ['.jpg'] } }]);
			return createFileSystemPreparedSave({ fileName: request.suggestedName!, signal: request.signal, target: { createWritable: async () => ({
				write: value => { assert.ok(value instanceof Uint8Array); outputs.push(value.slice()); events.push('write'); }, close: () => { events.push('commit'); }, abort() {} }) } });
		}, saveFile: async () => assert.fail('Native destination cannot download') }, registerDestination: value => destinations.register(value), onClose: () => { events.push('closed'); } };
	return { props, events, outputs, destinations };
}

test('JPEG dialog focuses Save, states opaque/90% limits and calls the native codec with exactly quality 0.9 after the original gesture', async context => {
	const f = fixture(), native = codec(context, [137, 0, 0, 255]), m = await mountPhotoImportUi(() => <StrictMode><PhotoJpegExportDialog {...f.props} /></StrictMode>);
	try {
		await act(async () => { await settle(); }); assert.equal(m.dom.container.ownerDocument.activeElement, m.dom.one('[data-photo-jpeg-export-save]'));
		assert.match(m.dom.one('[data-photo-jpeg-export-dialog]').textContent, /90%.*opaque.*PNG.*metadata/iu); assert.equal(f.events.length, 0);
		await act(async () => { reactProps(m.dom.one('[data-photo-jpeg-export-save]')).onClick?.({}); assert.deepEqual(f.events, ['picker']); await settle(); });
		await waitFor(() => f.outputs.length === 1, 'actual JPEG write'); await act(async () => { await settle(); });
		assert.deepEqual(native.calls, [{ type: 'image/jpeg', quality: 0.9 }]); assert.deepEqual(f.outputs, [JPEG]);
		assert.ok(f.events.indexOf('write') > f.events.indexOf('original-settled')); assert.equal(m.dom.one('[data-photo-jpeg-export-receipt]').getAttribute('data-photo-jpeg-export-status'), 'saved');
	} finally { await m.dispose(); await f.destinations.retireAndJoin(); }
});

test('JPEG Close joins an independently held native encode before retiring its borrowed original and dialog', async context => {
	const f = fixture(), native = codec(context, [137, 0, 0, 255]), held = deferred<Blob>(); native.hold(() => held.promise);
	const m = await mountPhotoImportUi(() => <PhotoJpegExportDialog {...f.props} />);
	try {
		await act(async () => { await settle(); }); await m.event('[data-photo-jpeg-export-save]', 'onClick');
		await waitFor(() => native.calls.length === 1, 'native JPEG encode'); await m.event('[data-photo-jpeg-export-close]', 'onClick');
		assert.equal(f.events.includes('closed'), false); assert.equal(native.canvas[0]!.width, 1); assert.equal(f.events.includes('original-settled'), false);
		await act(async () => { held.resolve(new Blob([JPEG], { type: 'image/jpeg' })); await settle(); });
		await waitFor(() => f.events.includes('closed'), 'joined JPEG Close'); assert.equal(f.outputs.length, 0); assert.equal(native.canvas[0]!.width, 0);
	} finally { held.resolve(new Blob([JPEG], { type: 'image/jpeg' })); await m.dispose(); await f.destinations.retireAndJoin(); }
});

test('transparent JPEG refuses with a useful dialog failure before native encode or destination publication', async context => {
	const f = fixture(127), native = codec(context, [137, 0, 0, 127]), m = await mountPhotoImportUi(() => <PhotoJpegExportDialog {...f.props} />);
	try {
		await act(async () => { await settle(); }); await m.event('[data-photo-jpeg-export-save]', 'onClick'); await act(async () => { await settle(); });
		assert.ok(m.dom.one('[role="alert"]')); assert.equal(native.calls.length, 0); assert.equal(f.outputs.length, 0); assert.equal(f.events.includes('commit'), false);
	} finally { await m.dispose(); await f.destinations.retireAndJoin(); }
});
