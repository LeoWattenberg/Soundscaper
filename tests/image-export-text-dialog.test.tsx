/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoPngExportDialog, { type PhotoPngExportDialogProps } from '../src/common/editor/ui/lightscaper/PhotoPngExportDialog.tsx';
import PhotoJpegExportDialog from '../src/common/editor/ui/lightscaper/PhotoJpegExportDialog.tsx';
import PhotoRasterBatchExportDialog from '../src/common/editor/ui/lightscaper/PhotoRasterBatchExportDialog.tsx';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, remainsPending, settle, waitFor } from './helpers/async-test-control.ts';
import { inflateSync } from 'node:zlib';
import { createFileSystemPreparedSave } from '../src/common/editor/file-save-stream.ts';
import { PhotoExportDestinations } from '../src/lightscaper/controller/photo-export-destinations.ts';
import { PhotoLibrarySessionV2 } from '../src/lightscaper/controller/photo-library-session-v2.ts';
import type { PhotoLibrarySessionPortsV2 } from '../src/lightscaper/controller/photo-library-session-ports-v2.ts';
import { currentDevelopFixture } from './helpers/lightscaper-current-develop-session-fixture.ts';

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
	test(`real ${format} File-export dialog offers an initially disabled optional text selection`, async () => {
		const mounted = await mountPhotoImportUi(() => <Dialog {...photoProps()} />);
		try {
			await act(async () => { await settle(); });
			assert.equal(reactProps(mounted.dom.one('[data-image-export-text-enabled]')).checked, false);
			assert.equal(mounted.dom.find('[data-image-export-text-value]'), null);
			await mounted.event('[data-image-export-text-enabled]', 'onChange', { currentTarget: { checked: true } });
			assert.ok(mounted.dom.one('[data-image-export-text-value]'));
			assert.equal(reactProps(mounted.dom.one('[data-image-export-text-anchor]')).value, 'bottom-right');
		} finally { await mounted.dispose(); }
	});
}


const TEXT = { schemaVersion: 1, text: 'Readable ©', font: 'inter-600-latin', color: '#ffffff', anchor: 'bottom-right', widthFraction: 1, marginFraction: 0, opacity: .5 } as const;

test('Photo Save captures valid glyph settings before the native picker; unsupported glyphs recover in the same dialog', async () => {
	const names: string[] = [], outputs: Uint8Array[] = [], seen: unknown[] = [], destinations = new PhotoExportDestinations();
	const props = photoProps(), entered = deferred<void>(), release = deferred<void>(), mask = Uint8Array.of(255,255,255,255);
	const m = await mountPhotoImportUi(() => <PhotoPngExportDialog {...props} registerDestination={callback => destinations.register(callback)}
		withTextFrame={async (value, consume) => { assert.ok(value !== null && typeof value === 'object' && 'text' in value); seen.push(value.text); entered.resolve(); await release.promise;
			try { return await consume({ descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: mask }); } finally { mask.fill(0); } }}
		saveRuntime={{ maximumStreamingBytes: 536870912, prepareSave(request) { assert.equal(typeof request.suggestedName, 'string'); const fileName = request.suggestedName as string; names.push(fileName); return createFileSystemPreparedSave({ fileName, signal: request.signal,
			target: { createWritable: async () => ({ write: value => { assert.ok(value instanceof Uint8Array); outputs.push(value.slice()); }, close: () => undefined, abort: () => undefined }) } }); },
			saveFile: async () => assert.fail('Prepared native save cannot download') }} />);
	try {
		await act(async () => { await settle(); });
		await m.event('[data-image-export-text-enabled]', 'onChange', { currentTarget: { checked: true } });
		await m.event('[data-image-export-text-value]', 'onChange', { currentTarget: { value: '漢' } });
		await m.event('[data-photo-png-export-save]', 'onClick'); assert.deepEqual(names, []); assert.match(m.dom.one('[role="alert"]').textContent, /settings/u);
		for (const [key, value] of [['value','Readable ©'], ['width','100'], ['margin','0'], ['opacity','50']]) await m.event(`[data-image-export-text-${key}]`, 'onChange', { currentTarget: { value } });
		await act(async () => { reactProps(m.dom.one('[data-photo-png-export-save]')).onClick?.({}); assert.deepEqual(names, ['Original.png']); await settle(); });
		await entered.promise; assert.deepEqual(seen, [TEXT]);
		await m.event('[data-image-export-text-value]', 'onChange', { currentTarget: { value: 'Changed after picker' } });
		release.resolve(); await act(async () => { await settle(); }); assert.deepEqual(seen, [TEXT]); assert.ok(mask.every(value => value === 0));
		const bytes = outputs[0]!; const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), idat: Uint8Array[] = []; let cursor = 8;
		while (cursor < bytes.length) { const size = view.getUint32(cursor), kind = Buffer.from(bytes.subarray(cursor + 4, cursor + 8)).toString('ascii');
			if (kind === 'IDAT') idat.push(bytes.subarray(cursor + 8, cursor + 8 + size)); cursor += size + 12; }
		// IEC sRGB: encode((decode(40 / 255) + 1) / 2) × 255 = 189.287…
		assert.deepEqual([...inflateSync(Buffer.concat(idat))], [0,189,189,189,255]);
	} finally { release.resolve(); await m.dispose(); await destinations.retireAndJoin(); }
});

test('closing Photo export joins a held glyph read before retirement and never starts a download', async () => {
	const destinations = new PhotoExportDestinations(), entered = deferred<void>(), release = deferred<void>(); let closed = 0, writes = 0;
	const props = photoProps(), m = await mountPhotoImportUi(() => <PhotoPngExportDialog {...props} onClose={() => { closed++; }} registerDestination={callback => destinations.register(callback)}
		withTextFrame={async (value, consume) => { entered.resolve(); await release.promise; assert.ok(value !== null && typeof value === 'object' && 'signal' in value); assert.ok(value.signal instanceof AbortSignal); value.signal.throwIfAborted(); return consume(null); }}
		saveRuntime={{ maximumStreamingBytes: 536870912, prepareSave: () => ({ mode: 'blob', fileName: 'Original.png', target: { browserDownload: true } }),
			saveFile: async () => { writes++; return { method: 'download', fileName: 'Original.png', size: 1 }; } }} />);
	try {
		await act(async () => { await settle(); }); await m.event('[data-image-export-text-enabled]', 'onChange', { currentTarget: { checked: true } });
		await m.event('[data-image-export-text-value]', 'onChange', { currentTarget: { value: 'Readable' } }); await m.event('[data-photo-png-export-save]', 'onClick'); await entered.promise;
		await m.event('[data-photo-png-export-close]', 'onClick'); const retirement = destinations.retireAndJoin(); assert.equal(await remainsPending(retirement), true); assert.equal(closed, 0); assert.equal(writes, 0);
		release.resolve(); await act(async () => { await retirement; await settle(); }); assert.equal(writes, 0);
	} finally { release.resolve(); await m.dispose(); await destinations.retireAndJoin(); }
});

for (const mode of ['single', 'batch'] as const) test(`${mode}: selected Photo Session stores and reapplies text scalars after reopen without font, original or destination I/O`, async () => {
	const f = await currentDevelopFixture(1), destinations = new PhotoExportDestinations();
	const ports: PhotoLibrarySessionPortsV2 = { catalog: f.repository, stacks: f.repository, smartCollections: f.repository,
		exclusive: async (_id, run, signal) => run(signal), initialize: async () => { const root = await f.repository.loadCatalog('catalog-1'); assert.ok(root); return root; },
		closeResources: async () => undefined, journal: f.settings, settings: f.settings, exportPresetSettings: f.settings, exportJournalSettings: f.settings,
		media: { writeAsset: async () => assert.fail('Presets cannot write originals'), custody: { findDigestPage: async () => ({ matches: [], afterAssetId: null }),
			stage: async () => undefined, promote: async () => undefined, releaseStaged: async () => undefined, readPage: async () => ({ roots: [], afterKey: null }) } } };
	let session = new PhotoLibrarySessionV2(ports); await session.readPage();
	const props: PhotoPngExportDialogProps = { ...photoProps(), photoId: 'photo-1', execute: async (action, signal) => {
		assert.ok(signal); const captured = session; await action({ signal, isCurrent: () => captured === session, refresh: async () => undefined, acquire: async () => captured.develop }); return 'completed'; },
		capturePresets: () => { assert.ok(session.exportPresets); return session.exportPresets.open.bind(session.exportPresets); },
		withOriginalFrame: async () => assert.fail('Presets cannot acquire originals'), loadRenderer: async () => assert.fail('Presets cannot acquire a renderer'),
		registerDestination: join => destinations.register(join), saveRuntime: { maximumStreamingBytes: 536870912,
			prepareSave: () => assert.fail('Presets cannot prepare delivery'), saveFile: async () => assert.fail('Presets cannot deliver') } };
	const render = () => mode === 'single' ? <PhotoPngExportDialog {...props} /> : <PhotoRasterBatchExportDialog {...props} selection={[{ photoId: 'photo-1', fileName: 'Original.png' }]} batchId="text-batch" visible onHide={() => undefined} onSettled={() => undefined}
		captureSidecarReader={() => session.readExportSidecar.bind(session)} captureJournal={() => { assert.ok(session.exportJournal); return session.exportJournal.open.bind(session.exportJournal); }} />;
	let m = await mountPhotoImportUi(render);
	const ready = async () => waitFor(async () => { await act(async () => { await settle(); });
		return m.dom.find(mode === 'single' ? '[data-photo-png-export-save]' : '[data-photo-batch-export-start]')?.disabled === false && Object.is(reactProps(m.dom.one('[data-photo-export-preset-select]')).disabled, false); }, 'selected preset and export ready');
	try {
		await ready(); await m.event('[data-image-export-text-enabled]', 'onChange', { currentTarget: { checked: true } });
		for (const [key, value] of [['value', 'Readable ©'], ['width', '100'], ['margin', '0'], ['opacity', '50']]) await m.event(`[data-image-export-text-${key}]`, 'onChange', { currentTarget: { value } });
		await m.event('[data-photo-export-preset-name]', 'onChange', { currentTarget: { value: 'Readable' } }); await m.event('[data-photo-export-preset-save]', 'onClick');
		await waitFor(async () => { await act(async () => { await settle(); }); return m.dom.find('[data-photo-export-preset-message]')?.textContent.includes('saved') === true; }, 'actual text preset CAS acknowledgment');
		const port = await session.exportPresets!.open(), saved = await port.list({ schemaVersion: 1 });
		assert.equal(saved.presets.length, 1); const id = saved.presets[0]!.id;
		assert.deepEqual((await port.read({ schemaVersion: 1, presetId: id, expectedRevision: saved.revision })).preset.output.textWatermark, TEXT);
		await m.dispose(); await session.close(); session = new PhotoLibrarySessionV2(ports);
		m = await mountPhotoImportUi(render); await ready();
		assert.equal(reactProps(m.dom.one('[data-image-export-text-enabled]')).checked, false, 'Reopen cannot silently opt into a saved text watermark');
		await m.event('[data-photo-export-preset-select]', 'onChange', { currentTarget: { value: id } }); await m.event('[data-photo-export-preset-apply]', 'onClick');
		await waitFor(async () => { await act(async () => { await settle(); }); return m.dom.find('[data-image-export-text-value]') !== null; }, 'explicit Apply restores text');
		assert.equal(reactProps(m.dom.one('[data-image-export-text-value]')).value, 'Readable ©');
		assert.equal(reactProps(m.dom.one('[data-image-export-text-opacity]')).value, '50');
	} finally { await m.dispose(); await destinations.retireAndJoin(); await session.close(); await f.close(); }
});
