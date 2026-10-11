/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import { inflateSync } from 'node:zlib';
import PhotoRasterBatchExportDialog, { type PhotoRasterBatchExportDialogProps } from '../src/common/editor/ui/lightscaper/PhotoRasterBatchExportDialog.tsx';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { PhotoExportDestinations } from '../src/lightscaper/controller/photo-export-destinations.ts';
import { openPhotoLibraryExportJournalSession } from '../src/lightscaper/controller/photo-library-export-journal-session.ts';
import { PhotoLibrarySessionLifetime } from '../src/lightscaper/controller/photo-library-session-lifetime.ts';
import { createPhotoMediaCubeLutResourcesV1 } from '../src/lightscaper/storage/photo-media-cube-lut-resources-v1.ts';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { createBrowserFileSaveService } from '../src/common/editor/browser-file-save-service.ts';
import { createPhotoExportSidecarV1, serializePhotoExportSidecarV1 } from '../src/lightscaper/catalog/photo-export-sidecar-v1.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { normalizePhotoRasterExportJournalV1 } from '../src/lightscaper/storage/photo-raster-export-journal-v1.ts';
import { preparePhotoRasterBatchGraphicV1, reselectPhotoRasterBatchGraphicV1 } from '../src/lightscaper/controller/photo-raster-export-batch-graphic-v1.ts';
import { usePhotoRasterBatchGraphic } from '../src/common/editor/ui/lightscaper/use-photo-raster-batch-graphic.ts';
import PhotoRasterExportPresets from '../src/common/editor/ui/lightscaper/PhotoRasterExportPresets.tsx';
import GraphicWatermarkFields from '../src/common/editor/ui/GraphicWatermarkFields.tsx';
import { imageExportGraphicCopy } from '../src/common/i18n/image-export-graphic-copy.ts';
import type { PhotoRasterExportPresetV1 } from '../src/common/editor/photo-library-export-presets-port-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, remainsPending, settle, waitFor } from './helpers/async-test-control.ts';

const GRAPHIC = new File([Uint8Array.of(1, 2, 3)], 'Mark.png', { type: 'image/png' });
const REQUEST = Object.freeze({ body: GRAPHIC, anchor: 'bottom-right' as const, widthFraction: 1, marginFraction: 0, opacity: 0.5 });
const KEY = 'photo-library:raster-export-journal:v1:catalog';
function fieldProps(element: Parameters<typeof reactProps>[0]): Readonly<Record<string, unknown>> { return reactProps(element); }

function fixture() {
	const base = photoArchiveFixture(), develop = defaultImageDevelopStateV2();
	const photo = normalizePhotoDocumentV2({ ...base.photo, schemaVersion: 2, id: 'photo', catalogId: 'catalog', revision: 3,
		activeVersionId: 'master', versions: [{ ...base.photo.versions[0]!, id: 'master', develop }] });
	const store = { memory: getMemoryDatabase(`batch-graphic-${crypto.randomUUID()}`), database: async () => null };
	const settings = new KeyValueRepository(store, 'settings'), lifetime = new PhotoLibrarySessionLifetime(), destinations = new PhotoExportDestinations();
	const resources = createPhotoMediaCubeLutResourcesV1(store, run => run(), () => lifetime.assertAccepting());
	const blobs: Blob[] = [], names: string[] = [];
	const service = createBrowserFileSaveService({ document: { createElement: () => ({ href: '', download: '', hidden: false, click() { names.push(this.download); } }) },
		urlApi: { createObjectURL(blob) { blobs.push(blob); return 'blob:graphic-test'; }, revokeObjectURL() {} }, setTimeout: callback => { callback(); return 1; } });
	const host = { ready: async () => 'catalog', settings, catalog: { loadPhoto: async () => photo }, loadOriginal: async () => base.original,
		verifyResources: resources.resources.verifyPhoto, operation: lifetime.operation.bind(lifetime) };
	const props: PhotoRasterBatchExportDialogProps = { locale: 'en', batchId: 'batch', selection: [{ photoId: 'photo', fileName: 'Photo.png' }],
		visible: true, onHide() {}, onSettled() {}, preparationFailed: false,
		execute: async (run, external) => { const signal = external ?? new AbortController().signal; await run({ signal, isCurrent: () => true,
			refresh: async () => undefined, acquire: async () => ({ schemaVersion: 2, read: async () => ({ schemaVersion: 2, catalogId: 'catalog',
				photoId: 'photo', revision: 3, versionId: 'master', activeVersionId: 'master', versions: [], develop,
				history: { cursor: 0, entries: [] }, snapshots: [] }), apply: async () => assert.fail('Export is read only') }) }); return 'completed'; },
		withOriginalFrame: async (_request, consume) => consume({ photoId: 'photo', revision: 3, frame: { descriptor: {
			schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: Uint8Array.of(0, 0, 0, 255) } }),
		loadRenderer: async () => createPhotoDevelopRenderRuntimeV2(), captureJournal: () => options => openPhotoLibraryExportJournalSession(host, options),
		captureSidecarReader: () => async request => serializePhotoExportSidecarV1(createPhotoExportSidecarV1(photo, request)),
		saveRuntime: { maximumStreamingBytes: 536870912, prepareSave: service.prepareSave, saveFile: service.saveFile }, registerDestination: join => destinations.register(join) };
	return { props, blobs, names, settings, photo, async close() { await destinations.retireAndJoin(); await lifetime.close(() => resources.close()); } };
}

async function mount(props: PhotoRasterBatchExportDialogProps) {
	const ui = await mountPhotoImportUi(() => <PhotoRasterBatchExportDialog {...props} />);
	await waitFor(async () => { await act(async () => { await settle(); }); const start = ui.dom.find('[data-photo-batch-export-start]'); return !!start && fieldProps(start).disabled === false; }, 'batch readiness');
	return ui;
}
function pixels(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), idat: Uint8Array[] = []; let offset = 8;
	while (offset < bytes.length) {
		const size = view.getUint32(offset), kind = Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString('ascii');
		if (kind === 'IDAT') idat.push(bytes.subarray(offset + 8, offset + 8 + size)); offset += size + 12;
	}
	return [...inflateSync(Buffer.concat(idat))];
}
async function chooseGraphic(ui: Awaited<ReturnType<typeof mount>>) {
	await ui.event('[data-image-export-graphic-enabled]', 'onChange', { currentTarget: { checked: true } });
	await ui.event('[data-image-export-graphic-width]', 'onChange', { currentTarget: { value: '100' } });
	await ui.event('[data-image-export-graphic-margin]', 'onChange', { currentTarget: { value: '0' } });
	await ui.event('[data-image-export-graphic-opacity]', 'onChange', { currentTarget: { value: '50' } });
	await ui.event('[data-image-export-graphic-file]', 'onChange', { currentTarget: { files: [GRAPHIC], value: 'Mark.png' } });
	await waitFor(async () => { await act(async () => { await settle(); }); return fieldProps(ui.dom.one('[data-photo-batch-export-start]')).disabled === false; }, 'graphic hash');
}

test('batch graphic is an opt-in setting inside the existing dialog', async () => {
	const f = fixture(), ui = await mount(f.props);
	try {
		const enabled = ui.dom.one('[data-image-export-graphic-enabled]');
		assert.equal(fieldProps(enabled).checked, false); assert.equal(ui.dom.find('[data-image-export-graphic-file]'), null);
		assert.equal(f.names.length, 0);
	} finally { await ui.dispose(); await f.close(); }
});

test('prepared batch graphics reach the real linear compositor and persist only scalar identity', async () => {
	const f = fixture(); let decodes = 0;
	const props: PhotoRasterBatchExportDialogProps = { ...f.props, withGraphicFrame: async (_request, consume) => { decodes++; return consume({ descriptor: { schemaVersion: 1, width: 1, height: 1,
		sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: Uint8Array.of(255, 255, 255, 255) }, { orientation: 1, runtimeVersion: 'injected-test' }); } };
	const ui = await mount(props), before = JSON.stringify(f.photo);
	try {
		await chooseGraphic(ui);
		await ui.event('[data-photo-batch-export-start]', 'onClick');
		await waitFor(async () => { await act(async () => { await settle(); }); return f.blobs.length === 1; }, 'graphic PNG');
		assert.deepEqual(pixels(new Uint8Array(await f.blobs[0]!.arrayBuffer())), [0, 188, 188, 188, 255]);
		const journal = normalizePhotoRasterExportJournalV1(await f.settings.get(KEY));
		assert.deepEqual(journal.graphicWatermark, (await preparePhotoRasterBatchGraphicV1(REQUEST)).intent);
		assert.equal(JSON.stringify(journal).includes('Mark.png'), false); assert.equal(decodes, 1); assert.equal(JSON.stringify(f.photo), before);
	} finally { await ui.dispose(); await f.close(); }
});

test('hash work is joined on retirement and cannot publish a late prepared selection', async () => {
	const destinations = new PhotoExportDestinations(), gate = deferred<void>(), entered = deferred<void>();
	let state: ReturnType<typeof usePhotoRasterBatchGraphic> | undefined;
	const owner = {}, register = destinations.register.bind(destinations);
	const ports = { prepare: async (...args: Parameters<typeof preparePhotoRasterBatchGraphicV1>) => { entered.resolve(); await gate.promise; return preparePhotoRasterBatchGraphicV1(...args); }, reselect: reselectPhotoRasterBatchGraphicV1 };
	function Harness() { state = usePhotoRasterBatchGraphic(owner, register, undefined, ports); return null; }
	const ui = await mountPhotoImportUi(() => <StrictMode><Harness /></StrictMode>);
	let closing: Promise<void> | undefined;
	try {
		await act(async () => { state!.onChange({ enabled: true, body: GRAPHIC, anchor: 'bottom-right', width: '100', margin: '0', opacity: '50' }); });
		await entered.promise; assert.equal(state!.pending, true); assert.equal(state!.prepared, null);
		closing = destinations.retireAndJoin(); assert.equal(await remainsPending(closing), true);
		await act(async () => { gate.resolve(); await closing; }); assert.equal(state!.prepared, null);
	} finally { gate.resolve(); await closing; await ui.dispose(); await destinations.retireAndJoin(); }
});

test('retirement retains an opaque hash primary without reflecting it', async () => {
	const destinations = new PhotoExportDestinations(), gate = deferred<void>(), entered = deferred<void>(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	let state: ReturnType<typeof usePhotoRasterBatchGraphic> | undefined;
	const owner = {}, register = destinations.register.bind(destinations);
	const ports = { prepare: async (): ReturnType<typeof preparePhotoRasterBatchGraphicV1> => { entered.resolve(); await gate.promise; throw opaque.proxy; }, reselect: reselectPhotoRasterBatchGraphicV1 };
	function Harness() { state = usePhotoRasterBatchGraphic(owner, register, undefined, ports); return null; }
	const ui = await mountPhotoImportUi(() => <Harness />); let closing: Promise<void> | undefined;
	try {
		await act(async () => { state!.onChange({ enabled: true, body: GRAPHIC, anchor: 'bottom-right', width: '100', margin: '0', opacity: '50' }); });
		await entered.promise; closing = destinations.retireAndJoin(); assert.equal(await remainsPending(closing), true); gate.resolve();
		let rejected = false; try { await closing; } catch (cause) { rejected = true; assert.equal(cause, opaque.proxy); } assert.equal(rejected, true);
	} finally { gate.resolve(); await closing?.catch(() => undefined); await ui.dispose(); await destinations.retireAndJoin().catch(() => undefined); }
});

test('retained raster work requires exact reselection and preserves saved placement', async () => {
	const f = fixture(), prepared = await preparePhotoRasterBatchGraphicV1(REQUEST); let ui = await mount(f.props);
	try {
		await ui.event('[data-photo-batch-export-start]', 'onClick');
		await waitFor(async () => { await act(async () => { await settle(); }); return f.blobs.length === 1; }, 'initial receipt');
		await ui.dispose();
		const old = normalizePhotoRasterExportJournalV1(await f.settings.get(KEY));
		await f.settings.put(KEY, normalizePhotoRasterExportJournalV1({ ...old, revision: old.revision + 1, graphicWatermark: prepared.intent,
			members: old.members.map(member => ({ ...member, state: 'pending', delivery: null })) }));
		ui = await mountPhotoImportUi(() => <PhotoRasterBatchExportDialog {...f.props} />);
		await waitFor(async () => { await act(async () => { await settle(); }); return ui.dom.find('[data-photo-batch-graphic-reselect]') !== null; }, 'retained graphic');
		assert.equal(fieldProps(ui.dom.one('[data-photo-batch-export-start]')).disabled, true); assert.equal(ui.dom.find('[data-image-export-graphic-enabled]'), null);
		const placement = ui.dom.one('[data-photo-batch-graphic-placement]'), words = imageExportGraphicCopy('en');
		assert.deepEqual(placement.querySelectorAll('dt').map(node => node.textContent), [words.anchor, words.width, words.margin, words.opacity]);
		assert.deepEqual(placement.querySelectorAll('dd').map(node => node.textContent), [words['bottom-right'], '100%', '0%', '50%']);
		await ui.event('[data-photo-batch-graphic-reselect]', 'onChange', { currentTarget: { files: [new File([Uint8Array.of(9)], 'Mark.png')], value: 'Mark.png' } });
		await waitFor(async () => { await act(async () => { await settle(); }); return ui.dom.find('[data-photo-batch-graphic-invalid]') !== null; }, 'wrong-file refusal');
		assert.equal(fieldProps(ui.dom.one('[data-photo-batch-export-start]')).disabled, true); assert.equal(f.blobs.length, 1);
		await ui.event('[data-photo-batch-graphic-reselect]', 'onChange', { currentTarget: { files: [GRAPHIC], value: 'Mark.png' } });
		await waitFor(async () => { await act(async () => { await settle(); }); return fieldProps(ui.dom.one('[data-photo-batch-export-start]')).disabled === false; }, 'matching file');
		assert.deepEqual(normalizePhotoRasterExportJournalV1(await f.settings.get(KEY)).graphicWatermark, prepared.intent);
	} finally { await ui.dispose(); await f.close(); }
});

test('JSON-only recovery retains image ACK and performs no original or graphic decoding', async () => {
	const f = fixture();
	const props: PhotoRasterBatchExportDialogProps = { ...f.props, withGraphicFrame: async (_request, consume) => consume({ descriptor: {
		schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: Uint8Array.of(255, 255, 255, 255) }, { orientation: 1, runtimeVersion: 'test' }) };
	let ui = await mount(props);
	try {
		await ui.event('[data-photo-batch-export-sidecar]', 'onChange', { target: { checked: true } }); await chooseGraphic(ui);
		await ui.event('[data-photo-batch-export-start]', 'onClick');
		await waitFor(async () => { await act(async () => { await settle(); }); return f.blobs.length === 2; }, 'paired delivery');
		await ui.dispose();
		const before = normalizePhotoRasterExportJournalV1(await f.settings.get(KEY)); assert.ok(before.graphicWatermark);
		await f.settings.put(KEY, normalizePhotoRasterExportJournalV1({ ...before, revision: before.revision + 1,
			members: before.members.map(member => ({ ...member, sidecar: { state: 'pending', delivery: null } })) }));
		const retry: PhotoRasterBatchExportDialogProps = { ...props, withOriginalFrame: async () => assert.fail('JSON retry cannot read original pixels'),
			loadRenderer: async () => assert.fail('JSON retry cannot render'), withGraphicFrame: async () => assert.fail('JSON retry cannot decode the graphic') };
		ui = await mount(retry); assert.equal(ui.dom.find('[data-photo-batch-graphic-reselect]'), null);
		await ui.event('[data-photo-batch-export-start]', 'onClick');
		await waitFor(async () => { await act(async () => { await settle(); }); return f.blobs.length === 3; }, 'JSON-only retry');
		assert.equal(f.blobs[2]!.type, 'application/json'); assert.deepEqual(f.names, ['01-Photo.png', '01-Photo.png.lightscaper.json', '01-Photo.png.lightscaper.json']);
		const after = normalizePhotoRasterExportJournalV1(await f.settings.get(KEY));
		assert.deepEqual(after.members[0]!.delivery, before.members[0]!.delivery); assert.deepEqual(after.graphicWatermark, before.graphicWatermark);
	} finally { await ui.dispose(); await f.close(); }
});

test('applying a scalar export preset clears the ephemeral graphic selection', async () => {
	const f = fixture(), preset: PhotoRasterExportPresetV1 = { schemaVersion: 1, id: 'preset', name: 'Plain', format: 'png', filenameTemplate: '{name}', sidecarEnabled: false,
		output: { sizing: { kind: 'original' }, quality: 'bilinear', metadataScope: 'strip' } };
	const props: PhotoRasterBatchExportDialogProps = { ...f.props, capturePresets: () => async () => ({ catalogId: 'catalog',
		list: async () => ({ schemaVersion: 1, catalogId: 'catalog', revision: 1, presets: [{ id: preset.id, name: preset.name }] }),
		read: async () => ({ preset }), write: async () => assert.fail('Apply cannot save a preset') }) };
	const ui = await mount(props);
	try {
		await chooseGraphic(ui); assert.equal(fieldProps(ui.dom.one('[data-image-export-graphic-enabled]')).checked, true);
		await ui.event('[data-photo-export-preset-select]', 'onChange', { currentTarget: { value: 'preset' } });
		await ui.event('[data-photo-export-preset-apply]', 'onClick');
		await waitFor(async () => { await act(async () => { await settle(); }); return fieldProps(ui.dom.one('[data-image-export-graphic-enabled]')).checked === false; }, 'preset file reset');
		assert.equal(ui.dom.find('[data-image-export-graphic-name]'), null); assert.equal(f.blobs.length, 0);
	} finally { await ui.dispose(); await f.close(); }
});

test('replacing the dialog generation joins the old hash before preparing the next file', async () => {
	const destinations = new PhotoExportDestinations(), gate = deferred<void>(), entered = deferred<void>();
	let state: ReturnType<typeof usePhotoRasterBatchGraphic> | undefined, owner: object = {}, calls = 0, active = 0, peak = 0;
	const register = destinations.register.bind(destinations), nextFile = new File([Uint8Array.of(7)], 'Next.png');
	const ports = { prepare: async (...args: Parameters<typeof preparePhotoRasterBatchGraphicV1>) => {
		calls++; active++; peak = Math.max(peak, active);
		try { if (calls === 1) { entered.resolve(); await gate.promise; } return await preparePhotoRasterBatchGraphicV1(...args); }
		finally { active--; }
	}, reselect: reselectPhotoRasterBatchGraphicV1 };
	function Harness() { state = usePhotoRasterBatchGraphic(owner, register, undefined, ports); return null; }
	const ui = await mountPhotoImportUi(() => <Harness />);
	try {
		await act(async () => { state!.onChange({ enabled: true, body: GRAPHIC, anchor: 'bottom-right', width: '100', margin: '0', opacity: '50' }); }); await entered.promise;
		owner = {}; await ui.render();
		await act(async () => { state!.onChange({ enabled: true, body: nextFile, anchor: 'top-left', width: '25', margin: '2', opacity: '100' }); await settle(); });
		assert.equal(calls, 1); assert.equal(state!.prepared, null); gate.resolve();
		await waitFor(async () => { await act(async () => { await settle(); }); return state?.prepared !== null; }, 'new generation hash');
		assert.equal(calls, 2); assert.equal(peak, 1); assert.equal(state!.prepared!.intent.anchor, 'top-left');
		assert.deepEqual([...new Uint8Array(await state!.prepared!.request.body.arrayBuffer())], [7]);
	} finally { gate.resolve(); await ui.dispose(); await destinations.retireAndJoin(); }
});

test('a preset resolving during a hash clears the file and joins the cancelled native read', async () => {
	const destinations = new PhotoExportDestinations(), presetGate = deferred<void>(), hashGate = deferred<void>(), reading = deferred<void>(), hashing = deferred<void>();
	let state: ReturnType<typeof usePhotoRasterBatchGraphic> | undefined, applied = false;
	const owner = {}, register = destinations.register.bind(destinations);
	const preset: PhotoRasterExportPresetV1 = { schemaVersion: 1, id: 'preset', name: 'Plain', format: 'png', filenameTemplate: '{name}', sidecarEnabled: false,
		output: { sizing: { kind: 'original' }, quality: 'bilinear', metadataScope: 'strip' } };
	const capture = () => async () => ({ catalogId: 'catalog',
		list: async () => ({ schemaVersion: 1 as const, catalogId: 'catalog', revision: 1, presets: [{ id: preset.id, name: preset.name }] }),
		read: async () => { reading.resolve(); await presetGate.promise; return { preset }; }, write: async () => assert.fail('Apply cannot publish a preset') });
	const ports = { prepare: async (...args: Parameters<typeof preparePhotoRasterBatchGraphicV1>) => { hashing.resolve(); await hashGate.promise; return preparePhotoRasterBatchGraphicV1(...args); }, reselect: reselectPhotoRasterBatchGraphicV1 };
	function Harness() {
		state = usePhotoRasterBatchGraphic(owner, register, undefined, ports);
		return <><PhotoRasterExportPresets locale="en" batch disabled={state.pending} capture={capture} registerDestination={register}
			captureCurrent={() => preset} onApply={async () => { await state!.reset(); applied = true; }} />
			<GraphicWatermarkFields value={state.value} onChange={state.onChange} disabled={state.pending} locale="en" /></>;
	}
	const ui = await mountPhotoImportUi(() => <Harness />);
	try {
		await waitFor(async () => { await act(async () => { await settle(); }); return fieldProps(ui.dom.one('[data-photo-export-preset-select]')).disabled === false; }, 'preset readiness');
		await ui.event('[data-photo-export-preset-select]', 'onChange', { currentTarget: { value: 'preset' } });
		await ui.event('[data-photo-export-preset-apply]', 'onClick'); await reading.promise;
		await ui.event('[data-image-export-graphic-enabled]', 'onChange', { currentTarget: { checked: true } });
		await ui.event('[data-image-export-graphic-file]', 'onChange', { currentTarget: { files: [GRAPHIC], value: 'Mark.png' } }); await hashing.promise;
		await act(async () => { presetGate.resolve(); await settle(); });
		assert.equal(state!.value.enabled, false); assert.equal(state!.value.body, null); assert.equal(state!.prepared, null);
		assert.equal(state!.pending, true); assert.equal(applied, false); assert.equal(fieldProps(ui.dom.one('[data-image-export-graphic-fields]')).disabled, true);
		await act(async () => { hashGate.resolve(); await settle(); });
		await waitFor(async () => { await act(async () => { await settle(); }); return applied && !state!.pending; }, 'cancelled hash join');
		assert.equal(state!.value.enabled, false); assert.equal(state!.prepared, null); assert.equal(state!.failed, false);
		assert.equal(ui.dom.find('[data-image-export-graphic-name]'), null);
	} finally { presetGate.resolve(); hashGate.resolve(); await ui.dispose(); await destinations.retireAndJoin(); }
});
