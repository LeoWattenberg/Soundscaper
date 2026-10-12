/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { BlobReader, BlobWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { lightscaperRestoreCopy } from '../../src/common/i18n/lightscaper-restore-copy.ts';
import { importPhotoCatalogArchiveV7 } from '../../src/lightscaper/archive/catalog-archive-import-v7.ts';
import { normalizePhotoCatalogArchiveV7 } from '../../src/lightscaper/archive/catalog-archive-contract-v7.ts';
import { readScapeArchiveEnvelope } from '../../src/common/editor/scape-archive-envelope.ts';
import { withScapeArchiveReader } from '../../src/common/editor/scape-archive-reader.ts';
import { expect, test, compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { repairSettingsUiFixtureV1, active, named, keyboard, uncheck } from './helpers/lightscaper-repair-settings-ui-fixture.js';

const PROGRAM = '/__repair_portable_native.js';
const CLONE = [90, 90, 90, 255, 90, 90, 90, 255];
const HEAL_BRUSH = [255, 255, 255, 255, 137, 137, 137, 255];
const CUBE = Buffer.from(`LUT_3D_SIZE 2\n${Array.from({ length: 8 }, () => '0.25 0.25 0.25\n').join('')}`);

for (const locale of ['en', 'de']) for (const presetOnly of [false, true]) test(`${locale}: archive7 restores complete repair history and ${presetOnly ? 'preset-only' : 'Photo and preset'} brush/LUT custody through two native reopen cycles`, async ({ page, browserName }) => {
	shape(browserName); test.setTimeout(180000);
	const f = await fixture(page, locale, presetOnly);
	const before = await f.custody(), location = await f.location(), source = await f.backup();
	const transported = await decode(source.buffer);
	expect(transported.document.schemaVersion).toBe(7);
	expect(documentsById(transported.photos)).toEqual(documentsById(before.photos.map(row => row.photo)));
	expect(transported.presets).toEqual(before.row);
	expect(transported.brushes).toEqual(before.bodies);
	expect(transported.luts).toEqual(before.luts);
	for (const row of before.photos) expect(transported.originals.get(row.photo.id)).toEqual({ sha256: row.original.sha256, byteLength: row.original.byteLength });
	expect(await f.custody()).toEqual(before);
	await f.restore(source); await page.reload(); await expect(f.app).toBeVisible();
	const restoredLocation = await f.location();
	expect(restoredLocation.location.namespaceToken).toMatch(/^[a-f0-9]{32}$/u);
	expect(restoredLocation.location.namespaceToken).not.toBe(location.location.namespaceToken);
	for (let cycle = 0; cycle < 2; cycle++) {
		await f.showLibrary(); const restored = await f.custody();
		expect(restored.photos.map(row => row.photo)).toEqual(before.photos.map(row => row.photo));
		expect(restored.row).toEqual(before.row); expect(restored.bodies).toEqual(before.bodies); expect(restored.luts).toEqual(before.luts);
		for (const [index, row] of restored.photos.entries()) expect({ sha256: row.original.sha256, byteLength: row.original.byteLength })
			.toEqual({ sha256: before.photos[index].original.sha256, byteLength: before.photos[index].original.byteLength });
		expect(await f.location()).toEqual(restoredLocation);
		await page.reload(); await expect(f.app).toBeVisible();
	}
	await f.showLibrary(); await f.select(1); await f.openDevelop();
	const dialog = await f.settingsDialog('presets'), preset = before.row.presets[0];
	await named(dialog, 'combobox', f.settings.choosePreset).selectOption(preset.identity.id);
	await keyboard(page, named(dialog, 'button', f.settings.applyPreset));
	await expect.poll(async () => (await f.photos()).photos[1].photo.revision).toBe(before.photos[1].photo.revision + 1);
	await f.closeSettings(dialog); await f.painted(HEAL_BRUSH); await f.closeDevelop();
	const applied = await f.custody();
	expect(active(applied.photos[1].photo).develop).toEqual(preset.settings.develop);
	expect(applied.photos[0].photo).toEqual(before.photos[0].photo); expect(applied.row).toEqual(before.row);
	expect(applied.bodies).toEqual(before.bodies); expect(applied.luts).toEqual(before.luts);
	await f.png(HEAL_BRUSH); expect(await f.custody()).toEqual(applied); expect(f.errors).toEqual([]);
});

for (const locale of ['en', 'de']) test(`${locale}: late cancellation joins a real positive native archive7 pointer acknowledgment and retains the restored repaired library`, async ({ page, browserName }) => {
	shape(browserName); test.setTimeout(180000);
	const f = await fixture(page, locale, true), before = await f.custody(), location = await f.location(), source = await f.backup();
	await page.evaluate(async pathname => {
		globalThis.__repairPortablePublication = (await import(new URL(pathname, location.href).href)).holdRepairPortablePublicationNativeV1();
	}, PROGRAM);
	try {
		const dialog = await f.beginRestore(source);
		await expect.poll(() => page.evaluate(() => globalThis.__repairPortablePublication.status())).toEqual({ attempts: 1, acknowledged: true, held: true });
		await keyboard(page, named(dialog, 'button', f.restoreCopy.cancel));
		await expect(named(dialog, 'button', f.restoreCopy.cancel)).toBeDisabled(); await expect(dialog.locator('[data-photo-restore-receipt]')).toHaveCount(0);
		await page.evaluate(() => globalThis.__repairPortablePublication.release());
		await expect(dialog.locator('[data-photo-restore-receipt]')).toBeVisible(); await expect(dialog.getByRole('alert')).toHaveCount(0);
		await keyboard(page, named(dialog, 'button', f.restoreCopy.close).last());
	} finally { await page.evaluate(() => globalThis.__repairPortablePublication.restore()); }
	await page.reload(); await expect(f.app).toBeVisible(); await f.showLibrary(); const restored = await f.custody();
	expect(restored.photos.map(row => row.photo)).toEqual(before.photos.map(row => row.photo)); expect(restored.row).toEqual(before.row);
	expect(restored.bodies).toEqual(before.bodies); expect(restored.luts).toEqual(before.luts);
	expect((await f.location()).location.namespaceToken).not.toBe(location.location.namespaceToken); expect(f.errors).toEqual([]);
});

for (const locale of ['en', 'de']) test(`${locale}: corrupted retained preset bytes refuse native archive7 publication and keep the previous library`, async ({ page, browserName }) => {
	shape(browserName); test.setTimeout(180000);
	const f = await fixture(page, locale, true), before = await f.custody(), location = await f.location(), source = await f.backup();
	const corrupt = await corruptPreset(source), dialog = await f.beginRestore(corrupt);
	await expect(dialog.getByRole('alert')).toBeVisible(); await expect(dialog.locator('[data-photo-restore-receipt]')).toHaveCount(0);
	await keyboard(page, named(dialog, 'button', f.restoreCopy.close).last()); await expect(dialog).toHaveCount(0);
	expect(await f.location()).toEqual(location); expect(await f.custody()).toEqual(before);
	await page.reload(); await expect(f.app).toBeVisible(); await f.showLibrary();
	expect(await f.location()).toEqual(location); expect(await f.custody()).toEqual(before); expect(f.errors).toEqual([]);
});

async function fixture(page, locale, presetOnly) {
	const f = await repairSettingsUiFixtureV1(page, locale), copy = bundledLightscaperEditorCopyForLocale(locale), restoreCopy = lightscaperRestoreCopy(locale);
	const program = await compileNativeImageHandoffScript('repair-portable-native.js', fileURLToPath(new URL('./helpers/lightscaper-repair-portable-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]); await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	const read = method => page.evaluate(async ({ pathname, method, ids }) => {
		const owner = await import(new URL(pathname, location.href).href);
		return method === 'readRepairPresetsCustodyNativeV1' ? owner[method](ids, () => globalThis.__assertNativeOpfsWorkerExecution()) : owner[method]();
	}, { pathname: PROGRAM, method, ids: f.ids });
	const custody = () => read('readRepairPresetsCustodyNativeV1');
	const closeSettings = async dialog => { await keyboard(page, named(dialog, 'button', f.settings.close).last()); await expect(dialog).toHaveCount(0); };
	await f.openDevelop(); await f.repair('clone'); await f.geometry(); await f.painted(CLONE); await f.save(); await f.painted(CLONE);
	await f.repair('heal'); await f.brush();
	await named(f.develop(), 'combobox', f.words.choose).selectOption('cube-lut-profile-v1'); await keyboard(page, named(f.develop(), 'button', f.words.add));
	await f.develop().getByLabel(f.words.shared.videoEffectCubeLutImport, { exact: true }).setInputFiles({ name: 'Portable retained.cube', mimeType: 'text/plain', buffer: CUBE });
	await f.painted([137, 137, 137, 255, 137, 137, 137, 255]);
	await uncheck(page, f.develop().locator('[data-photo-develop-effect="cube-lut-profile-v1"] input[type="checkbox"]')); await f.painted(HEAL_BRUSH);
	if (!presetOnly) {
		await f.save(); await f.painted(HEAL_BRUSH);
		await named(f.develop(), 'textbox', f.words.snapshotName).fill('Retained repair snapshot');
		const revision = (await f.photos()).photos[0].photo.revision;
		await keyboard(page, named(f.develop(), 'button', f.words.saveSnapshot));
		await expect.poll(async () => (await f.photos()).photos[0].photo.revision).toBe(revision + 1); await f.painted(HEAL_BRUSH);
	}
	const dialog = await f.settingsDialog('presets'); await named(dialog, 'textbox', f.settings.presetName).fill('Portable repair');
	await keyboard(page, named(dialog, 'button', f.settings.savePreset));
	await expect.poll(async () => (await read('readRepairPresetRowNativeV1'))?.revision).toBe(1);
	await closeSettings(dialog); await f.painted(HEAL_BRUSH); await f.closeDevelop();
	const before = await custody(); expect(before.row.schemaVersion).toBe(3); expect(before.bodies).toHaveLength(1); expect(before.luts).toHaveLength(1);
	expect(before.bodies[0].bytes.slice(-2)).toEqual([255, 0]); expect(before.luts[0].bytes).toEqual([...CUBE]);
	if (presetOnly) expect((await f.observe()).bodies).toEqual([]);
	else { expect(active(before.photos[0].photo).workspace.snapshots).toHaveLength(1); expect((await f.observe()).bodies).toHaveLength(1); }
	return { ...f, copy, restoreCopy, custody, closeSettings, showLibrary,
		location: () => read('readRepairPortableLocationNativeV1'), backup, restore, beginRestore };
	async function showLibrary() {
		await f.showLibrary(); const library = f.app.locator('[data-photo-library]');
		await expect(library).toHaveAttribute('aria-busy', 'false'); await expect(library.locator('[data-photo-count]')).toHaveAttribute('data-photo-count', '2');
	}
	async function action(label) {
		await keyboard(page, f.app.getByRole('navigation').getByText(copy.photoFileMenu, { exact: true })); await keyboard(page, named(f.app, 'button', label));
	}
	async function backup() {
		await action(copy.photoBackupTitle); const dialog = named(page, 'dialog', copy.photoBackupTitle), pending = page.waitForEvent('download');
		await keyboard(page, named(dialog, 'button', copy.photoBackupSave)); const download = await pending;
		const source = { name: download.suggestedFilename(), mimeType: 'application/vnd.soundscaper.scape+zip', buffer: await readFile(await download.path()) };
		await expect(dialog.locator('[data-photo-backup-receipt]')).toContainText(copy.photoBackupDownloadStarted.replace('{name}', source.name));
		await keyboard(page, named(dialog, 'button', copy.photoBackupClose).last()); await expect(dialog).toHaveCount(0); return source;
	}
	async function beginRestore(source) {
		await action(restoreCopy.title); const dialog = named(page, 'dialog', restoreCopy.title);
		await dialog.getByLabel(restoreCopy.file, { exact: true }).setInputFiles(source); await keyboard(page, named(dialog, 'button', restoreCopy.restore)); return dialog;
	}
	async function restore(source) {
		const dialog = await beginRestore(source); await expect(dialog.locator('[data-photo-restore-receipt]')).toBeVisible(); await expect(dialog.getByRole('alert')).toHaveCount(0);
		await keyboard(page, named(dialog, 'button', restoreCopy.close).last()); await expect(dialog).toHaveCount(0);
	}
}

async function decode(bytes) {
	const blob = new Blob([bytes]);
	const document = await withScapeArchiveReader(blob, undefined, async entries => normalizePhotoCatalogArchiveV7(JSON.parse((await readScapeArchiveEnvelope(entries)).projectText)));
	const result = { document, photos: [], originals: new Map(), presets: null, brushes: [], luts: [] };
	await importPhotoCatalogArchiveV7(blob, async () => ({
		async writePhoto(photo, chunks) { const parts = []; for await (const chunk of chunks) parts.push(Buffer.from(chunk)); const body = Buffer.concat(parts);
			expect(createHash('sha256').update(body).digest('hex')).toBe(photo.original.contentSha256); result.photos.push(photo);
			result.originals.set(photo.id, { sha256: photo.original.contentSha256, byteLength: body.byteLength }); },
		async writeStack() {}, async writeSavedCollection() {},
		async writeDevelopPresets(row) { expect(result.presets).toBeNull(); result.presets = row; },
		async writeLut(reference, body) { expect(createHash('sha256').update(body).digest('hex')).toBe(reference.sha256); result.luts.push({ reference, bytes: [...body] }); },
		async writeMaskRaster(reference, body) { expect(createHash('sha256').update(body).digest('hex')).toBe(reference.sha256); result.brushes.push({ reference, bytes: [...body] }); },
		async publish() {}, async rollback() { throw Error('The valid repair archive rolled back.'); },
	}));
	return result;
}
async function corruptPreset(source) {
	const reader = new ZipReader(new BlobReader(new Blob([source.buffer])), { useWebWorkers: false });
	const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false }); let changed = false;
	try {
		for (const entry of await reader.getEntries()) {
			if (entry.directory) continue;
			const bytes = await entry.getData(new Uint8ArrayWriter());
			if (entry.filename === 'assets/develop-presets-v3.bin') { expect(bytes.length).toBeGreaterThan(16); bytes[bytes.length - 4] ^= 1; changed = true; }
			await writer.add(entry.filename, new Uint8ArrayReader(bytes));
		}
		expect(changed).toBe(true); const blob = await writer.close();
		return { ...source, buffer: Buffer.from(await blob.arrayBuffer()) };
	} finally { await reader.close(); }
}
function shape(browserName) { test.skip(browserName === 'webkit', 'Native WebKit storage qualification remains deferred.');
	expect(test.info().config.workers).toBe(1); expect(test.info().retry).toBe(0); expect(test.info().project.retries).toBe(0); }
function documentsById(photos) { return [...photos].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0); }
