/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import PhotoPngExportDialog, { type PhotoPngExportDialogProps } from '../src/common/editor/ui/lightscaper/PhotoPngExportDialog.tsx';
import { PhotoExportDestinations } from '../src/lightscaper/controller/photo-export-destinations.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { createFileSystemPreparedSave } from '../src/common/editor/file-save-stream.ts';
import { inflateSync } from 'node:zlib';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, remainsPending, settle, waitFor } from './helpers/async-test-control.ts';

function fixture() {
	const destinations = new PhotoExportDestinations(), events: string[] = [], outputs: Uint8Array[] = [];
	const runtime = createPhotoDevelopRenderRuntimeV2();
	const props: PhotoPngExportDialogProps = {
		locale: 'en', photoId: 'photo-1', fileName: 'Export original.jpeg', preparationFailed: false,
		execute: async (action, signal) => {
			assert.ok(signal); signal.throwIfAborted();
			await action({ signal, acquire: async () => ({ schemaVersion: 2, read: async () => ({ schemaVersion: 2, catalogId: 'library', photoId: 'photo-1',
				revision: 3, activeVersionId: 'master', versionId: 'master', versions: [{ id: 'master', name: 'Master', kind: 'master' }],
				develop: defaultImageDevelopStateV2(), history: { cursor: 0, entries: [] }, snapshots: [] }), apply: async () => assert.fail('Export cannot edit') }),
				isCurrent: () => true, refresh: async () => undefined }); return 'completed';
		},
		withOriginalFrame: async (request, consume) => {
			events.push('original'); assert.equal(request.expectedRevision, 3);
			const result = await consume({ photoId: 'photo-1', revision: 3, frame: { descriptor: { schemaVersion: 1,
				width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: new Uint8Array([9, 31, 57, 255]) } });
			events.push('original-settled'); return result;
		},
		loadRenderer: async () => runtime,
		saveRuntime: { maximumStreamingBytes: 536870912, prepareSave(request) {
			assert.equal(this, props.saveRuntime); events.push('picker'); assert.equal(request.suggestedName, 'Export original.png');
			return Promise.resolve(createFileSystemPreparedSave({ fileName: request.suggestedName!, signal: request.signal,
				target: { createWritable: async () => ({ write: value => { assert.ok(value instanceof Uint8Array); outputs.push(value.slice()); events.push('write'); },
					close: () => { events.push('commit'); }, abort: () => { events.push('abort'); } }) } }));
		}, saveFile: async () => assert.fail('Native path must not download') },
		registerDestination: destination => destinations.register(destination), onClose: () => { events.push('dialog-close'); },
	};
	return { props, events, outputs, destinations };
}
async function mount(props: PhotoPngExportDialogProps, strict = false) {
	const mounted = await mountPhotoImportUi(() => strict ? <StrictMode><PhotoPngExportDialog {...props} /></StrictMode> : <PhotoPngExportDialog {...props} />);
	return mounted;
}

function rgba(bytes: Uint8Array): number[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), idat: Uint8Array[] = []; let offset = 8;
	assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
	while (offset < bytes.length) {
		const size = view.getUint32(offset), tag = Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString('ascii');
		if (tag === 'IDAT') idat.push(bytes.subarray(offset + 8, offset + 8 + size));
		assert.ok(['IHDR', 'sRGB', 'IDAT', 'IEND'].includes(tag), 'No original metadata chunks'); offset += size + 12;
	}
	const decoded = inflateSync(Buffer.concat(idat)); assert.equal(decoded[0], 0); return [...decoded.subarray(1)];
}

test('the lazy dialog prepares once, focuses Save and invokes the real PNG destination synchronously in its gesture', async () => {
	const f = fixture(), m = await mount(f.props);
	try {
		await act(async () => { await settle(); });
		assert.equal(m.dom.container.ownerDocument.activeElement, m.dom.one('[data-photo-png-export-save]'));
		assert.equal(f.events.length, 0);
		const save = reactProps(m.dom.one('[data-photo-png-export-save]')).onClick;
		await act(async () => { save?.({}); assert.deepEqual(f.events, ['picker']); save?.({}); await settle(); });
		assert.equal(f.events.filter(event => event === 'picker').length, 1);
		assert.equal(f.events.indexOf('write') > f.events.indexOf('original-settled'), true);
		assert.deepEqual(rgba(f.outputs[0]!), [9, 31, 57, 255]);
		assert.equal(m.dom.one('[data-photo-png-export-receipt]').getAttribute('data-photo-png-export-status'), 'saved');
		await m.event('[data-photo-png-export-save]', 'onClick'); await act(async () => { await settle(); });
		assert.equal(f.outputs.length, 2); assert.deepEqual(f.outputs[1], f.outputs[0]);
	} finally { await m.dispose(); await f.destinations.retireAndJoin(); }
});

test('Close joins a held actual native write and abort before removing the dialog', async () => {
	const f = fixture(), write = deferred<void>(), abort = deferred<void>();
	assert.ok(f.props.saveRuntime);
	const props: PhotoPngExportDialogProps = { ...f.props, saveRuntime: { ...f.props.saveRuntime, prepareSave: request => Promise.resolve(createFileSystemPreparedSave({
		fileName: 'held.png', signal: request.signal, target: { createWritable: async () => ({ write: async () => { f.events.push('held-write'); await write.promise; },
			close: () => assert.fail('Cancelled export cannot commit'), abort: async () => { f.events.push('held-abort'); await abort.promise; } }) } })) } };
	const m = await mount(props);
	try {
		await act(async () => { await settle(); }); await m.event('[data-photo-png-export-save]', 'onClick');
		await waitFor(() => f.events.includes('held-write'), 'native PNG write');
		await m.event('[data-photo-png-export-close]', 'onClick'); assert.equal(f.events.includes('dialog-close'), false);
		await act(async () => { write.resolve(); await settle(); }); assert.ok(f.events.includes('held-abort')); assert.equal(f.events.includes('dialog-close'), false);
		await act(async () => { abort.resolve(); await settle(); }); assert.equal(f.events.at(-1), 'dialog-close');
	} finally { write.resolve(); abort.resolve(); await m.dispose(); await f.destinations.retireAndJoin(); }
});

test('Save stays disabled through the real executor final settlement and never prepares after a refused action', async () => {
	const f = fixture(), settleAction = deferred<void>(), originalExecute = f.props.execute;
	const m = await mount({ ...f.props, execute: async (...args) => { const result = await originalExecute(...args); await settleAction.promise; return result; } });
	try {
		await act(async () => { await settle(); }); assert.equal(reactProps(m.dom.one('[data-photo-png-export-save]')).disabled, true);
		await m.event('[data-photo-png-export-save]', 'onClick'); assert.equal(f.events.length, 0);
		await act(async () => { settleAction.resolve(); await settle(); }); assert.equal(reactProps(m.dom.one('[data-photo-png-export-save]')).disabled, false);
	} finally { settleAction.resolve(); await m.dispose(); await f.destinations.retireAndJoin(); }
	const refused = await mount({ ...f.props, execute: async () => 'busy', registerDestination: () => () => undefined });
	try { await act(async () => { await settle(); }); assert.ok(refused.dom.one('[role="alert"]')); await refused.event('[data-photo-png-export-save]', 'onClick'); assert.equal(f.events.length, 0); }
	finally { await refused.dispose(); }
});

test('StrictMode joins the predecessor read before preparing the replacement dialog', async () => {
	const f = fixture(), m = await mount(f.props, true);
	try {
		await act(async () => { await settle(); }); assert.equal(reactProps(m.dom.one('[data-photo-png-export-save]')).disabled, false);
		await m.event('[data-photo-png-export-save]', 'onClick'); await act(async () => { await settle(); }); assert.equal(f.outputs.length, 1);
	} finally { await m.dispose(); await f.destinations.retireAndJoin(); }
});

test('library retirement joins a held selected-version read without enabling Save or retaining a destination', async () => {
	const f = fixture(), read = deferred<void>(), originalExecute = f.props.execute;
	const m = await mount({ ...f.props, execute: async (...args) => { await read.promise; return originalExecute(...args); } });
	const closing = f.destinations.retireAndJoin();
	try {
		assert.equal(await remainsPending(closing), true); assert.equal(f.events.length, 0);
		await act(async () => { read.resolve(); await closing; }); assert.equal(f.events.length, 0);
		await m.event('[data-photo-png-export-save]', 'onClick'); assert.equal(f.events.length, 0);
	} finally { read.resolve(); await closing; await m.dispose(); }
});
