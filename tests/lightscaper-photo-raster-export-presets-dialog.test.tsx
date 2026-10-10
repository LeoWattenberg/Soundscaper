/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, type ComponentProps } from 'react';
import PhotoRasterExportSurface from '../src/common/editor/ui/lightscaper/PhotoRasterExportSurface.tsx';
import PhotoPngExportDialog from '../src/common/editor/ui/lightscaper/PhotoPngExportDialog.tsx';
import PhotoRasterExportPresets from '../src/common/editor/ui/lightscaper/PhotoRasterExportPresets.tsx';
import PhotoRasterBatchExportDialog from '../src/common/editor/ui/lightscaper/PhotoRasterBatchExportDialog.tsx';
import { PhotoLibrarySessionV2 } from '../src/lightscaper/controller/photo-library-session-v2.ts';
import type { PhotoLibrarySessionPortsV2 } from '../src/lightscaper/controller/photo-library-session-ports-v2.ts';
import { PhotoExportDestinations } from '../src/lightscaper/controller/photo-export-destinations.ts';
import { PhotoRasterExport } from '../src/lightscaper/controller/photo-raster-export.ts';
import { capturePhotoRasterExportBatchV1 } from '../src/lightscaper/controller/photo-raster-export-batch-v1.ts';
import { createPhotoRasterExportJournalV1, photoRasterExportJournalKeyV1 } from '../src/lightscaper/storage/photo-raster-export-journal-v1.ts';
import { canonicalJsonSha256 } from '../src/common/canonical-json-sha256.ts';
import type { PhotoRasterExportPresetV1 } from '../src/common/editor/photo-library-export-presets-port-v1.ts';
import { currentDevelopFixture } from './helpers/lightscaper-current-develop-session-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, remainsPending, settle, waitFor } from './helpers/async-test-control.ts';

const RECIPE: PhotoRasterExportPresetV1 = { schemaVersion: 1, id: 'print', name: 'Print', format: 'png', filenameTemplate: 'Chosen {index:3}-{name}', sidecarEnabled: false,
	output: { sizing: { kind: 'percentage', percentage: 50 }, quality: 'nearest', metadataScope: 'capture', sharpen: { amount: 37, threshold: 9 } } };
type Mounted = Awaited<ReturnType<typeof mountPhotoImportUi>>;
async function fixture() {
	const f = await currentDevelopFixture(1), destinations = new PhotoExportDestinations(); let bodies = 0, native = 0;
	const ports: PhotoLibrarySessionPortsV2 = { catalog: f.repository, stacks: f.repository, smartCollections: f.repository,
		// This owning React fixture injects the writer lease; its fake document
		// replaces navigator and cannot lend the real browser LockManager.
		exclusive: async (_catalogId, run, signal) => run(signal),
		initialize: async () => { const root = await f.repository.loadCatalog('catalog-1'); assert.ok(root); return root; },
		closeResources: async () => undefined, journal: f.settings, settings: f.settings, exportPresetSettings: f.settings, exportJournalSettings: f.settings,
		media: { writeAsset: async () => assert.fail('Preset cannot write originals'), custody: {
			findDigestPage: async () => ({ matches: [], afterAssetId: null }), stage: async () => undefined, promote: async () => undefined,
			releaseStaged: async () => undefined, readPage: async () => ({ roots: [], afterKey: null }),
		} } };
	let session = new PhotoLibrarySessionV2(ports); await session.readPage();
	const props: ComponentProps<typeof PhotoRasterExportSurface> = {
		entry: { key: 'entry', generation: {}, visible: true, settled: false, mode: 'single', format: 'png', photoId: 'photo-1', fileName: 'Current.png' },
		locale: 'en', preparationFailed: false, workingLabel: 'Preparing', onClose() {}, onHide() {}, onSettled() {},
		execute: async (action, signal) => { const captured = session, current = signal ?? new AbortController().signal;
			await action({ signal: current, isCurrent: () => captured === session, refresh: async () => undefined, acquire: async () => captured.develop }); return 'completed'; },
		withOriginalFrame: async () => { bodies++; return assert.fail('Preset settings cannot acquire originals'); },
		loadRenderer: async () => { bodies++; return assert.fail('Preset settings cannot acquire a renderer'); },
		saveRuntime: { maximumStreamingBytes: 536870912, prepareSave: async () => { native++; return assert.fail('Preset settings cannot acquire native destinations'); },
			saveFile: async () => { native++; return assert.fail('Preset settings cannot initiate delivery'); } },
		capturePresets: () => { const captured = session; assert.ok(captured.exportPresets); return captured.exportPresets.open.bind(captured.exportPresets); },
		captureJournal: () => { const captured = session; assert.ok(captured.exportJournal); return captured.exportJournal.open.bind(captured.exportJournal); },
		captureSidecarReader: () => { const captured = session; return captured.readExportSidecar.bind(captured); },
		registerDestination: join => destinations.register(join),
	};
	return { ...f, props, ports, get session() { return session; }, destinations, bodies: () => bodies, native: () => native,
		async reopen() { await session.close(); session = new PhotoLibrarySessionV2(ports); },
		async close() { await destinations.retireAndJoin(); await session.close(); await f.close(); } };
}
async function flush() { await act(async () => { await settle(); }); }
async function ready(m: Mounted, format: 'png' | 'jpeg' = 'png') {
	try { await waitFor(async () => { await flush(); return m.dom.find(`[data-photo-${format}-export-save]`)?.disabled === false &&
		Object.is(reactProps(m.dom.one('[data-photo-export-preset-select]')).disabled, false); }, 'actual export and selected preset methods ready'); }
	catch (cause) { throw new Error(`Export preparation: ${m.dom.container.textContent}`, { cause }); }
}
async function choose(m: Mounted, id = 'print') { await m.event('[data-photo-export-preset-select]', 'onChange', { currentTarget: { value: id } }); }
function recipeDisplayed(m: Mounted) {
	assert.equal(reactProps(m.dom.one('[data-photo-raster-export-sizing]')).value, 'percentage');
	assert.equal(reactProps(m.dom.one('[data-photo-raster-export-percentage]')).value, '50');
	assert.equal(reactProps(m.dom.one('[data-photo-raster-export-resample]')).value, 'nearest');
	assert.equal(reactProps(m.dom.one('[data-photo-raster-export-metadata]')).value, 'capture');
	assert.equal(reactProps(m.dom.one('[data-photo-raster-export-sharpen]')).checked, true);
	assert.equal(reactProps(m.dom.one('[data-photo-raster-export-sharpen-amount]')).value, '37');
	assert.equal(reactProps(m.dom.one('[data-photo-raster-export-sharpen-threshold]')).value, '9');
	assert.equal(reactProps(m.dom.one('[data-photo-raster-export-filename-template]')).value, RECIPE.filenameTemplate);
}

test('actual dialog saves current scalars, reopens its selected Session, applies and deletes without bodies or delivery', async () => {
	const f = await fixture(); let m = await mountPhotoImportUi(() => <PhotoRasterExportSurface {...f.props} />);
	try {
		await ready(m);
		for (const [field, value] of [['sizing', 'percentage'], ['percentage', '50'], ['resample', 'nearest'], ['metadata', 'capture'],
			['sharpen-amount', '37'], ['sharpen-threshold', '9'], ['filename-template', RECIPE.filenameTemplate]]) {
			if (field === 'sharpen-amount') await m.event('[data-photo-raster-export-sharpen]', 'onChange', { target: { checked: true } });
			await m.event(`[data-photo-raster-export-${field}]`, 'onChange', { target: { value } });
		}
		await m.event('[data-photo-export-preset-name]', 'onChange', { currentTarget: { value: 'Print' } }); await m.event('[data-photo-export-preset-save]', 'onClick');
		await waitFor(async () => { await flush(); return m.dom.find('[data-photo-export-preset-message]')?.textContent.includes('saved') === true; }, 'actual CAS save acknowledgment');
		const first = await f.session.exportPresets!.open(), listed = await first.list({ schemaVersion: 1 }), id = listed.presets[0]!.id;
		assert.deepEqual((await first.read({ schemaVersion: 1, presetId: id, expectedRevision: listed.revision })).preset, { ...RECIPE, id });
		await m.dispose(); await f.reopen(); m = await mountPhotoImportUi(() => <PhotoRasterExportSurface {...f.props} />); await ready(m);
		assert.equal(reactProps(m.dom.one('[data-photo-raster-export-sizing]')).value, 'original'); // Reload never silently applies a preset.
		await choose(m, id); await m.event('[data-photo-export-preset-apply]', 'onClick'); await ready(m); recipeDisplayed(m);
		await choose(m, id); await m.event('[data-photo-export-preset-delete]', 'onClick');
		await waitFor(async () => { await flush(); return (await (await f.session.exportPresets!.open()).list({ schemaVersion: 1 })).presets.length === 0; }, 'actual CAS deletion');
		await m.dispose(); await f.reopen(); m = await mountPhotoImportUi(() => <PhotoRasterExportSurface {...f.props} />); await ready(m);
		assert.equal(m.dom.one('[data-photo-export-preset-select]').querySelectorAll('option').length, 1); assert.equal(f.bodies(), 0); assert.equal(f.native(), 0);
	} finally { await m.dispose(); await f.close(); }
});

test('cross-format Apply joins the real fixed-format exporter before remount and requires fresh graphic selection', async () => {
	const f = await fixture(), port = await f.session.exportPresets!.open(); await port.write({ schemaVersion: 1, command: { type: 'save', expectedRevision: 0, preset: { ...RECIPE, format: 'jpeg' } } });
	const entered = deferred<void>(), release = deferred<void>(), original = PhotoRasterExport.prototype.cancelAndJoin; let armed = false;
	PhotoRasterExport.prototype.cancelAndJoin = async function () { await original.call(this); if (armed) { entered.resolve(); await release.promise; } };
	const m = await mountPhotoImportUi(() => <PhotoRasterExportSurface {...f.props} />);
	try {
		await ready(m); await m.event('[data-image-export-graphic-enabled]', 'onChange', { currentTarget: { checked: true } });
		await m.event('[data-image-export-graphic-file]', 'onChange', { currentTarget: { files: [new File(['local'], 'Private graphic.png')], value: 'private' } });
		assert.equal(m.dom.one('[data-image-export-graphic-name]').textContent, 'Private graphic.png');
		await choose(m); armed = true; await m.event('[data-photo-export-preset-apply]', 'onClick'); await entered.promise;
		assert.notEqual(m.dom.find('[data-photo-png-export-dialog]'), null); assert.equal(m.dom.find('[data-photo-jpeg-export-dialog]'), null);
		assert.equal(reactProps(m.dom.one('[data-photo-png-export-save]')).disabled, true);
		release.resolve(); await ready(m, 'jpeg'); recipeDisplayed(m);
		assert.equal(m.dom.find('[data-photo-png-export-dialog]'), null); assert.equal(reactProps(m.dom.one('[data-image-export-graphic-enabled]')).checked, false);
		assert.equal(m.dom.find('[data-image-export-graphic-name]'), null); assert.equal(f.bodies(), 0); assert.equal(f.native(), 0);
	} finally { armed = false; release.resolve(); PhotoRasterExport.prototype.cancelAndJoin = original; await m.dispose(); await f.close(); }
});

test('preset retirement joins the complete held Apply action after its selected read resolves', async () => {
	const f = await fixture(), port = await f.session.exportPresets!.open(), entered = deferred<void>(), release = deferred<void>(); let applied = 0;
	await port.write({ schemaVersion: 1, command: { type: 'save', expectedRevision: 0, preset: RECIPE } });
	const capture = () => f.session.exportPresets!.open.bind(f.session.exportPresets), register = (join: () => Promise<void>) => f.destinations.register(join);
	const m = await mountPhotoImportUi(() => <PhotoRasterExportPresets locale="en" disabled={false} capture={capture} registerDestination={register}
		captureCurrent={(id, name) => ({ ...RECIPE, id, name })} onApply={async () => { entered.resolve(); await release.promise; applied++; }} />);
	try {
		await waitFor(async () => { await flush(); return Object.is(reactProps(m.dom.one('[data-photo-export-preset-select]')).disabled, false); }, 'preset list ready');
		await choose(m); await m.event('[data-photo-export-preset-apply]', 'onClick'); await entered.promise;
		const retiring = f.destinations.retireAndJoin(); assert.equal(await remainsPending(retiring), true, 'Retirement must join the full held Apply action');
		await act(async () => { release.resolve(); await retiring; await settle(); }); assert.equal(applied, 1);
		await m.event('[data-photo-export-preset-apply]', 'onClick'); await flush(); assert.equal(applied, 1);
	} finally { release.resolve(); await m.dispose(); await f.close(); }
});

test('generation retirement during the real cross-format exporter join prevents the late surface transition', async () => {
	const f = await fixture(), port = await f.session.exportPresets!.open(), entered = deferred<void>(), release = deferred<void>(); let armed = false, transitions = 0;
	await port.write({ schemaVersion: 1, command: { type: 'save', expectedRevision: 0, preset: { ...RECIPE, format: 'jpeg' } } });
	const original = PhotoRasterExport.prototype.cancelAndJoin;
	PhotoRasterExport.prototype.cancelAndJoin = async function () { await original.call(this); if (armed) { entered.resolve(); await release.promise; } };
	const m = await mountPhotoImportUi(() => <PhotoPngExportDialog {...f.props} photoId="photo-1" fileName="Current.png" onApplyPreset={() => { transitions++; }} />);
	try {
		await ready(m); await choose(m); armed = true; await m.event('[data-photo-export-preset-apply]', 'onClick'); await entered.promise;
		const retiring = f.destinations.retireAndJoin(); assert.equal(await remainsPending(retiring), true);
		await act(async () => { release.resolve(); await retiring; await settle(); }); assert.equal(transitions, 0, 'A retired generation must not remount the export surface');
	} finally { armed = false; release.resolve(); PhotoRasterExport.prototype.cancelAndJoin = original; await m.dispose(); await f.close(); }
});

test('batch Apply captures the sidecar preference without reading bodies or acquiring destinations', async () => {
	const f = await fixture(), port = await f.session.exportPresets!.open();
	await port.write({ schemaVersion: 1, command: { type: 'save', expectedRevision: 0, preset: { ...RECIPE, sidecarEnabled: true } } });
	await port.write({ schemaVersion: 1, command: { type: 'save', expectedRevision: 1, preset: { ...RECIPE, id: 'supported', format: 'jpeg' } } });
	const props = { ...f.props, batchId: 'batch', selection: [{ photoId: 'photo-1', fileName: 'Current.png' }], visible: true };
	const m = await mountPhotoImportUi(() => <PhotoRasterBatchExportDialog {...props} />);
	try {
		await waitFor(async () => { await flush(); return m.dom.find('[data-photo-batch-export-start]')?.disabled === false; }, 'actual batch ready');
		await m.event('[data-photo-raster-export-filename-template]', 'onChange', { target: { value: 'Draft-{name}' } });
		await choose(m); await m.event('[data-photo-export-preset-apply]', 'onClick');
		await waitFor(async () => { await flush(); return m.dom.find('[data-photo-batch-export-sidecar]') !== null && Object.is(reactProps(m.dom.one('[data-photo-batch-export-sidecar]')).checked, true); }, 'applied companion preference');
		assert.equal(reactProps(m.dom.one('[data-photo-batch-export-format]')).value, 'png');
		assert.equal(reactProps(m.dom.one('[data-photo-raster-export-filename-template]')).value, RECIPE.filenameTemplate);
		await m.event('[data-photo-export-preset-name]', 'onChange', { currentTarget: { value: 'Paired batch' } }); await m.event('[data-photo-export-preset-save]', 'onClick');
		await waitFor(async () => { await flush(); return (await port.list({ schemaVersion: 1 })).presets.some(preset => preset.name === 'Paired batch'); }, 'real selected CAS retains companion preference');
		const paired = (await port.list({ schemaVersion: 1 })).presets.find(preset => preset.name === 'Paired batch')!;
		assert.equal((await port.read({ schemaVersion: 1, presetId: paired.id, expectedRevision: (await port.list({ schemaVersion: 1 })).revision })).preset.sidecarEnabled, true);
		await choose(m, 'supported'); await m.event('[data-photo-export-preset-apply]', 'onClick'); await flush(); recipeDisplayed(m);
		assert.equal(reactProps(m.dom.one('[data-photo-batch-export-format]')).value, 'jpeg');
		assert.equal(reactProps(m.dom.one('[data-photo-batch-export-sidecar]')).checked, false);
		assert.equal(reactProps(m.dom.one('[data-photo-raster-export-percentage]')).disabled, false); assert.equal(f.bodies(), 0); assert.equal(f.native(), 0);
	} finally { await m.dispose(); await f.close(); }
});

test('reopened image ACK with pending JSON restores its companion and permits discard/recovery without completed replacement', async () => {
	const f = await fixture(), photo = f.photos[0]!, version = photo.versions[0]!;
	const plan = capturePhotoRasterExportBatchV1({ schemaVersion: 1, batchId: 'paired-retained', format: 'png', filenameTemplate: 'Retained-{name}', sidecarEnabled: true,
		members: [{ photoId: photo.id, versionId: version.id, expectedRevision: photo.revision, sourceFileName: 'Current.png' }] });
	const sidecar = await f.session.readExportSidecar({ catalogId: photo.catalogId, photoId: photo.id, versionId: version.id, expectedRevision: photo.revision });
	const before = createPhotoRasterExportJournalV1(plan, { catalogId: photo.catalogId, filenameTemplate: 'Retained-{name}', bindings: [{ originalSha256: photo.original.contentSha256,
		recipeSha256: canonicalJsonSha256(version.develop), lutSha256: [], sidecarSha256: canonicalJsonSha256(JSON.parse(sidecar)) }] });
	const journal = { ...before, members: before.members.map(member => ({ ...member, state: 'committed', delivery: { status: 'download-started', method: 'download', fileName: member.fileName, size: 8 } })) };
	assert.equal(await f.settings.putIfAbsent(photoRasterExportJournalKeyV1(photo.catalogId), journal), true);
	const props = { ...f.props, batchId: 'new-explicit', selection: [{ photoId: photo.id, fileName: 'Current.png' }], visible: true };
	const m = await mountPhotoImportUi(() => <PhotoRasterBatchExportDialog {...props} />);
	try {
		await waitFor(async () => { await flush(); return m.dom.find('[data-photo-export-journal]') !== null && m.dom.find('[data-photo-batch-export-start]')?.disabled === false; }, 'current JSON-only recovery ready');
		assert.equal(reactProps(m.dom.one('[data-photo-batch-export-sidecar]')).checked, true);
		assert.equal(m.dom.find('[data-photo-batch-export-replace]'), null);
		assert.notEqual(m.dom.find('[data-photo-batch-sidecar-pending]'), null); assert.notEqual(m.dom.find('[data-photo-batch-export-discard]'), null);
		assert.equal(reactProps(m.dom.one('[data-photo-export-preset-fields]')).disabled, true);
		assert.equal(f.bodies(), 0); assert.equal(f.native(), 0); assert.deepEqual(await f.settings.get(photoRasterExportJournalKeyV1(photo.catalogId)), journal);
	} finally { await m.dispose(); await f.close(); }
});

for (const completed of [false, true]) test(`retained ${completed ? 'committed replacement' : 'pending recovery'} recipe ${completed ? 'can' : 'cannot'} be overwritten by Apply`, async () => {
	const f = await fixture(), photo = f.photos[0]!, version = photo.versions[0]!, port = await f.session.exportPresets!.open();
	await port.write({ schemaVersion: 1, command: { type: 'save', expectedRevision: 0, preset: RECIPE } });
	const plan = capturePhotoRasterExportBatchV1({ schemaVersion: 1, batchId: 'retained', format: 'png', filenameTemplate: 'Retained-{name}', members: [
		{ photoId: photo.id, versionId: version.id, expectedRevision: photo.revision, sourceFileName: 'Current.png' }] });
	const before = createPhotoRasterExportJournalV1(plan, { catalogId: 'catalog-1', filenameTemplate: 'Retained-{name}', bindings: [{ originalSha256: photo.original.contentSha256,
		recipeSha256: canonicalJsonSha256(version.develop), lutSha256: [] }] });
	const journal = completed ? { ...before, members: before.members.map(member => ({ ...member, state: 'committed', delivery: { status: 'download-started', method: 'download', fileName: member.fileName, size: 8 } })) } : before;
	assert.equal(await f.settings.putIfAbsent(photoRasterExportJournalKeyV1('catalog-1'), journal), true);
	const props = { ...f.props, batchId: 'new-explicit', selection: [{ photoId: photo.id, fileName: 'Current.png' }], visible: true };
	const m = await mountPhotoImportUi(() => <PhotoRasterBatchExportDialog {...props} />);
	try {
		await waitFor(async () => { await flush(); return m.dom.find('[data-photo-export-journal]') !== null; }, 'actual retained recovery');
		assert.equal(reactProps(m.dom.one('[data-photo-export-preset-fields]')).disabled, !completed);
		await choose(m); await m.event('[data-photo-export-preset-apply]', 'onClick'); await flush();
		if (completed) recipeDisplayed(m); else assert.equal(reactProps(m.dom.one('[data-photo-raster-export-filename-template]')).value, 'Retained-{name}');
		assert.deepEqual(await f.settings.get(photoRasterExportJournalKeyV1('catalog-1')), journal); assert.equal(f.native(), 0);
	} finally { await m.dispose(); await f.close(); }
});

test('preset retirement joins a held actual settings read and never applies after generation retirement', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(); let armed = false, applied = 0;
	const captured = f.ports.exportPresetSettings!;
	const session = new PhotoLibrarySessionV2({ ...f.ports, exportPresetSettings: { get: captured.get.bind(captured),
		putIfAbsent: captured.putIfAbsent.bind(captured), replaceIfCurrent: captured.replaceIfCurrent.bind(captured), async readEntry(key) {
			if (armed) { entered.resolve(); await release.promise; } return captured.readEntry!(key);
		} } });
	assert.ok(session.exportPresets); const port = await session.exportPresets.open(); await port.write({ schemaVersion: 1, command: { type: 'save', expectedRevision: 0, preset: RECIPE } });
	const capture = () => session.exportPresets!.open.bind(session.exportPresets), register = (join: () => Promise<void>) => f.destinations.register(join);
	const m = await mountPhotoImportUi(() => <PhotoRasterExportPresets locale="en" disabled={false} capture={capture} registerDestination={register}
		captureCurrent={(id, name) => ({ ...RECIPE, id, name })} onApply={() => { applied++; }} />);
	try {
		await waitFor(async () => { await flush(); return Object.is(reactProps(m.dom.one('[data-photo-export-preset-select]')).disabled, false); }, 'preset list ready');
		await choose(m); armed = true; await m.event('[data-photo-export-preset-apply]', 'onClick'); await entered.promise;
		const retiring = f.destinations.retireAndJoin(); assert.equal(await remainsPending(retiring), true);
		await act(async () => { release.resolve(); await retiring; await settle(); }); assert.equal(applied, 0);
	} finally { release.resolve(); await m.dispose(); await session.close(); await f.close(); }
});

for (const failure of ['open', 'read']) test(`${failure}: initial selected-settings refusal exposes a usable Reload action and recovers without opening delivery`, async () => {
	const f = await fixture(), captured = f.ports.exportPresetSettings!; let refused = false;
	const first = await f.session.exportPresets!.open(); await first.write({ schemaVersion: 1, command: { type: 'save', expectedRevision: 0, preset: RECIPE } });
	const session = new PhotoLibrarySessionV2({ ...f.ports, initialize: async signal => {
			if (failure === 'open' && !refused) { refused = true; throw Symbol('Initial open refusal'); } return f.ports.initialize(signal);
		}, exportPresetSettings: { get: captured.get.bind(captured),
		putIfAbsent: captured.putIfAbsent.bind(captured), replaceIfCurrent: captured.replaceIfCurrent.bind(captured), async readEntry(key) {
			if (failure === 'read' && !refused) { refused = true; throw Symbol('Initial settings read refusal'); } return captured.readEntry!(key);
		} } });
	const capture = () => session.exportPresets!.open.bind(session.exportPresets), register = (join: () => Promise<void>) => f.destinations.register(join);
	const m = await mountPhotoImportUi(() => <PhotoRasterExportPresets locale="en" disabled={false} capture={capture} registerDestination={register}
		captureCurrent={(id, name) => ({ ...RECIPE, id, name })} onApply={() => assert.fail('Reload cannot apply or deliver')} />);
	try {
		await waitFor(async () => { await flush(); return m.dom.find('[data-photo-export-preset-message]') !== null; }, 'original settings refusal');
		assert.match(m.dom.one('[data-photo-export-preset-message]').textContent, /Reload/u);
		assert.equal(reactProps(m.dom.one('[data-photo-export-preset-fields]')).disabled, false, 'The promised Reload must be keyboard-reachable');
		assert.equal(reactProps(m.dom.one('[data-photo-export-preset-save]')).disabled, true);
		await m.event('[data-photo-export-preset-reload]', 'onClick');
		await waitFor(async () => { await flush(); return m.dom.one('[data-photo-export-preset-select]').querySelectorAll('option').length === 2; }, 'Reload reads actual retained preset');
		assert.equal(m.dom.find('[data-photo-export-preset-message]'), null); assert.equal(f.native(), 0); assert.equal(f.bodies(), 0);
	} finally { await m.dispose(); await session.close(); await f.close(); }
});
