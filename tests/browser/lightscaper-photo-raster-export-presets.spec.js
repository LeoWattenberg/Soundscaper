/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { build } from 'esbuild';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoExportPresetsCopy } from '../../src/common/i18n/lightscaper-photo-export-presets-copy.ts';
import { photoPngExportCopy } from '../../src/common/i18n/lightscaper-photo-png-export-copy.ts';
import { photoJpegExportCopy } from '../../src/common/i18n/lightscaper-photo-jpeg-export-copy.ts';
import { photoPngExportMenuLabel } from '../../src/common/i18n/lightscaper-photo-png-export-menu-copy.ts';
import { photoJpegExportMenuLabel } from '../../src/common/i18n/lightscaper-photo-jpeg-export-menu-copy.ts';
import { photoBatchExportCopy } from '../../src/common/i18n/lightscaper-photo-batch-export-copy.ts';
import { imageExportGraphicCopy } from '../../src/common/i18n/image-export-graphic-copy.ts';
import { photoBatchExportMenuCopy } from '../../src/common/i18n/lightscaper-photo-batch-export-menu-copy.ts';
import { pngChunk } from '../helpers/image-metadata-fixtures.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { assertNativeOpfsWorkerExecution, installNativeOpfsWorkerCompanion } from './helpers/native-opfs-worker-companion.ts';

// The native worker companion serves executable test-only code. Cold product
// cases retain ordinary collection; functional native cases follow its owner.
const observedTest = test.extend({ browserCoverage: false });
const COLOR = [64, 128, 192, 255];
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
	pngChunk('IHDR', Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0])), pngChunk('sRGB', Buffer.from([0])),
	pngChunk('IDAT', deflateSync(Buffer.from([0, ...COLOR, ...COLOR, 0, ...COLOR, ...COLOR]))), pngChunk('IEND', Buffer.alloc(0))]);

for (const locale of ['en', 'de']) {
	test(`${locale}: reusable photo export presets remain cold behind existing File dialogs`, async ({ page }) => {
		const requested = []; page.on('request', request => { if (request.resourceType() === 'script') requested.push(request.url()); });
		const f = await open(page, locale); await menu(page, f.app, f.copy.photoFileMenu);
		await expect(f.app.locator('[data-photo-png-export-menu]')).toBeDisabled(); await expect(page.locator('[data-photo-export-presets]')).toHaveCount(0);
		expect(requested.filter(url => /(?:PhotoRasterExportPresets|lightscaper-photo-export-presets-copy|photo-library-export-presets-session|photo-raster-export-presets-v1)/u.test(url))).toEqual([]);
	});
	observedTest(`${locale}: saved scalar preset reloads, changes the fixed-format dialog, exports and deletes without retained graphic bytes`, async ({ page, browserName }) => {
		observedTest.skip(browserName === 'webkit', 'The roadmap defers native WebKit Blob/OPFS catalog workflows.'); observedTest.setTimeout(90_000);
		const f = await imported(page, locale, ['Preset original.png']), downloads = []; page.on('download', download => { downloads.push(download); });
		let dialog = await openSingle(page, f, 'png'); await presetFields(page, dialog, locale);
		await output(page, dialog, locale); await toggle(page, raster(dialog, locale, 'sidecar'), true);
		await dialog.getByLabel(f.words.name, { exact: true }).fill('Print'); await keyboard(page, named(dialog, 'button', f.words.save));
		await expect(dialog.locator('[data-photo-export-preset-message]')).toHaveText(f.words.saved);
		const id = await named(dialog, 'combobox', f.words.choose).inputValue(); expect(id).not.toBe('');
		await assertNativeOpfsWorkerExecution(page); await keyboard(page, closeButton(dialog, locale));
		await page.reload(); await selectLibrary(page, f);
		dialog = await openSingle(page, f, 'jpeg'); await presetFields(page, dialog, locale);
		await expect(raster(dialog, locale, 'outputSize')).toHaveValue('original'); expect(downloads).toHaveLength(0);
		await choose(page, named(dialog, 'combobox', f.words.choose), id);
		await toggle(page, dialog.getByLabel(imageExportGraphicCopy(locale).enabled, { exact: true }), true);
		await dialog.getByLabel(imageExportGraphicCopy(locale).file, { exact: true }).setInputFiles({ name: 'Private graphic.png', mimeType: 'image/png', buffer: PNG });
		await expect(dialog.locator('[data-image-export-graphic-name]')).toHaveText('Private graphic.png');
		await keyboard(page, named(dialog, 'button', f.words.apply));
		dialog = named(page, 'dialog', photoPngExportCopy(locale).title); await expect(dialog).toBeVisible(); await expect(page.locator('[data-photo-jpeg-export-dialog]')).toHaveCount(0);
		await assertOutput(dialog, locale); await expect(raster(dialog, locale, 'sidecar')).toBeChecked();
		await expect(dialog.getByLabel(imageExportGraphicCopy(locale).enabled, { exact: true })).not.toBeChecked(); await expect(dialog.locator('[data-image-export-graphic-name]')).toHaveCount(0);
		await keyboard(page, named(dialog, 'button', photoPngExportCopy(locale).save));
		await expect(dialog.locator('[data-photo-png-export-receipt]')).toHaveAttribute('data-photo-png-export-status', 'download-started'); await expect.poll(() => downloads.length).toBe(2);
		expect(downloads.map(value => value.suggestedFilename())).toEqual(['Chosen-001-Preset original.png', 'Chosen-001-Preset original.png.lightscaper.json']);
		const rasterBytes = await readFile(await downloads[0].path()); assertPng(rasterBytes);
		const sidecar = JSON.parse(await readFile(await downloads[1].path(), 'utf8'));
		expect(sidecar.original.contentSha256).toBe(createHash('sha256').update(PNG).digest('hex')); expect(sidecar.binding.photoId).toBe(f.ids[0]);
		await presetFields(page, dialog, locale); await choose(page, named(dialog, 'combobox', f.words.choose), id);
		await keyboard(page, named(dialog, 'button', f.words.remove)); await expect(dialog.locator('[data-photo-export-preset-message]')).toHaveText(f.words.removed);
		await assertNativeOpfsWorkerExecution(page); await keyboard(page, closeButton(dialog, locale)); await page.reload(); await selectLibrary(page, f);
		dialog = await openSingle(page, f, 'png'); await presetFields(page, dialog, locale); await expect(named(dialog, 'combobox', f.words.choose).locator('option')).toHaveCount(1);
		await expect(raster(dialog, locale, 'outputSize')).toHaveValue('original'); expect(downloads).toHaveLength(2); expect(f.errors).toEqual([]);
		await assertNativeOpfsWorkerExecution(page);
	});
	observedTest(`${locale}: batch presets restore paired preferences, persist JPEG output and protect completed recovery`, async ({ page, browserName }) => {
		observedTest.skip(browserName === 'webkit', 'The roadmap defers native WebKit Blob/OPFS catalog workflows.'); observedTest.setTimeout(90_000);
		const f = await imported(page, locale, ['First.png', 'Second.png']), downloads = []; page.on('download', download => { downloads.push(download); });
		let dialog = await openSingle(page, f, 'png'); await presetFields(page, dialog, locale); await toggle(page, raster(dialog, locale, 'sidecar'), true);
		await dialog.getByLabel(f.words.name, { exact: true }).fill('With sidecar'); await keyboard(page, named(dialog, 'button', f.words.save));
		await expect(dialog.locator('[data-photo-export-preset-message]')).toHaveText(f.words.saved); const sidecarId = await named(dialog, 'combobox', f.words.choose).inputValue();
		await keyboard(page, closeButton(dialog, locale));
		await menu(page, f.app, f.copy.photoFileMenu); await menu(page, f.app, f.copy.photoPhotoMenu); await keyboard(page, named(f.app, 'button', f.copy.photoSelectAll));
		await menu(page, f.app, f.copy.photoFileMenu); await keyboard(page, named(f.app, 'button', photoBatchExportMenuCopy(locale).downloadSelected));
		dialog = named(page, 'dialog', photoBatchExportCopy(locale).title); await expect(named(dialog, 'button', photoBatchExportCopy(locale).start)).toBeEnabled(); await presetFields(page, dialog, locale);
		await raster(dialog, locale, 'filenameTemplate').fill('Draft-{name}'); await choose(page, named(dialog, 'combobox', f.words.choose), sidecarId);
		await keyboard(page, named(dialog, 'button', f.words.apply)); await expect(raster(dialog, locale, 'sidecar')).toBeChecked();
		await expect(raster(dialog, locale, 'filenameTemplate')).toHaveValue('{name}'); await expect(named(dialog, 'combobox', photoBatchExportCopy(locale).format)).toHaveValue('png'); expect(downloads).toHaveLength(0);
		await toggle(page, raster(dialog, locale, 'sidecar'), false);
		await choose(page, named(dialog, 'combobox', f.words.choose), ''); await choose(page, named(dialog, 'combobox', photoBatchExportCopy(locale).format), 'jpeg'); await output(page, dialog, locale);
		await dialog.getByLabel(f.words.name, { exact: true }).fill('Batch JPEG'); await keyboard(page, named(dialog, 'button', f.words.save));
		await expect(dialog.locator('[data-photo-export-preset-message]')).toHaveText(f.words.saved); const batchId = await named(dialog, 'combobox', f.words.choose).inputValue();
		await assertNativeOpfsWorkerExecution(page); await page.reload(); await selectLibrary(page, f, true);
		await menu(page, f.app, f.copy.photoFileMenu); await keyboard(page, named(f.app, 'button', photoBatchExportMenuCopy(locale).queue));
		dialog = named(page, 'dialog', photoBatchExportCopy(locale).title); await expect(named(dialog, 'button', photoBatchExportCopy(locale).start)).toBeEnabled(); await presetFields(page, dialog, locale);
		await expect(named(dialog, 'combobox', photoBatchExportCopy(locale).format)).toHaveValue('png'); expect(downloads).toHaveLength(0);
		await choose(page, named(dialog, 'combobox', f.words.choose), batchId); await keyboard(page, named(dialog, 'button', f.words.apply));
		await assertOutput(dialog, locale); await expect(named(dialog, 'combobox', photoBatchExportCopy(locale).format)).toHaveValue('jpeg');
		await keyboard(page, named(dialog, 'button', photoBatchExportCopy(locale).start)); await expect(dialog.locator('[data-photo-batch-export-receipt]')).toHaveAttribute('data-phase', 'settled');
		await expect.poll(() => downloads.length).toBe(2);
		const names = await f.app.locator('[data-photo-library] [data-photo-id]').evaluateAll(cards => cards.map(card => card.querySelector('strong').textContent));
		// Page order is the captured batch order. Download dimensions independently
		// attest that applying the retained scalar settings reaches the real codec.
		for (const [index, download] of downloads.entries()) {
			const source = names[index]; expect(source).toBeTruthy();
			expect(download.suggestedFilename()).toBe(`Chosen-${String(index + 1).padStart(3, '0')}-${source.replace(/\.png$/u, '')}.jpg`);
			const bytes = await readFile(await download.path()); const size = await page.evaluate(async value => {
				const image = await createImageBitmap(new Blob([new Uint8Array(value)], { type: 'image/jpeg' }));
				try { const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
					return { dimensions: [image.width, image.height], pixels: [...context.getImageData(0, 0, image.width, image.height).data] }; } finally { image.close(); }
			}, [...bytes]); expect(size.dimensions).toEqual([1, 1]); expect(size.pixels[3]).toBe(255);
			for (let channel = 0; channel < 3; channel++) expect(Math.abs(size.pixels[channel] - COLOR[channel])).toBeLessThanOrEqual(3);
		}
		await keyboard(page, named(dialog, 'button', photoBatchExportCopy(locale).hide)); await assertNativeOpfsWorkerExecution(page); await page.reload(); await selectLibrary(page, f, true);
		await menu(page, f.app, f.copy.photoFileMenu); await menu(page, f.app, f.copy.photoPhotoMenu); await keyboard(page, named(f.app, 'button', f.copy.photoClearSelection));
		await menu(page, f.app, f.copy.photoFileMenu); await keyboard(page, named(f.app, 'button', photoBatchExportMenuCopy(locale).queue));
		dialog = named(page, 'dialog', photoBatchExportCopy(locale).title); await expect(dialog.locator('[data-journal-state="already-committed"]')).toHaveCount(2);
		await presetFields(page, dialog, locale); await expect(dialog.locator('[data-photo-export-preset-fields]')).toHaveAttribute('disabled', '');
		for (const [role, name] of [['combobox', f.words.choose], ['textbox', f.words.name], ['button', f.words.save], ['button', f.words.apply], ['button', f.words.remove], ['button', f.words.reload]]) await expect(named(dialog, role, name)).toBeDisabled();
		await assertOutput(dialog, locale); expect(downloads).toHaveLength(2); expect(f.errors).toEqual([]); await assertNativeOpfsWorkerExecution(page);
	});
}

async function open(page, locale) {
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`); const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
	return { app, copy: bundledLightscaperEditorCopyForLocale(locale), words: photoExportPresetsCopy(locale), locale };
}
async function imported(page, locale, names) {
	await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
	await installNativeOpfsWorkerCompanion(page); const errors = []; page.on('pageerror', error => { errors.push(error.message); });
	const f = await open(page, locale); await menu(page, f.app, f.copy.photoFileMenu); await keyboard(page, named(f.app, 'button', f.copy.photoImportPhotos));
	const importer = named(page, 'dialog', f.copy.photoImportPhotos); await importer.getByLabel(f.copy.photoChooseFiles, { exact: true }).setInputFiles(names.map(name => ({ name, mimeType: 'image/png', buffer: PNG })));
	await keyboard(page, named(importer, 'button', f.copy.photoImportAction)); await expect(importer).toHaveCount(0);
	const cards = f.app.locator('[data-photo-library] [data-photo-id]'); await expect(cards).toHaveCount(names.length);
	await expect(f.app.locator('[data-photo-library]')).toHaveAttribute('aria-busy', 'false'); await keyboard(page, photoCard(f.app, await cards.first().locator('strong').textContent()));
	const ids = await cards.evaluateAll(values => values.map(value => value.getAttribute('data-photo-id')));
	const originals = await observe(page, ids); expect(originals.photos.map(value => value.bytes)).toEqual(names.map(() => [...PNG]));
	return { ...f, ids, errors };
}
async function observe(page, ids) {
	const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('../helpers/', import.meta.url)), contents: `export { readResidentPhotoLibraryCurrent } from './lightscaper-current-app-fixture.tsx';` },
		bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.woff2': 'dataurl' } });
	await page.route('**/__preset_export_observer.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
	const result = await page.evaluate(async photoIds => (await import(new URL('/__preset_export_observer.js', location.href).href))
		.readResidentPhotoLibraryCurrent(photoIds, indexedDB, () => globalThis.__assertNativeOpfsWorkerExecution()), ids);
	await assertNativeOpfsWorkerExecution(page); return result;
}
async function selectLibrary(page, f, all = false) {
	await expect(f.app).toBeVisible(); await menu(page, f.app, f.copy.photoViewMenu); await keyboard(page, named(f.app, 'button', f.copy.photoShowLibrary));
	await expect(f.app.locator('[data-photo-library]')).toHaveAttribute('aria-busy', 'false');
	if (all) { await menu(page, f.app, f.copy.photoFileMenu); await menu(page, f.app, f.copy.photoPhotoMenu); await keyboard(page, named(f.app, 'button', f.copy.photoSelectAll)); }
	else { const fileName = await f.app.locator('[data-photo-library] [data-photo-id] strong').first().textContent(); await keyboard(page, photoCard(f.app, fileName)); }
}
async function openSingle(page, f, format) {
	await menu(page, f.app, f.copy.photoFileMenu); await keyboard(page, named(f.app, 'button', format === 'png' ? photoPngExportMenuLabel(f.locale) : photoJpegExportMenuLabel(f.locale)));
	const copy = format === 'png' ? photoPngExportCopy(f.locale) : photoJpegExportCopy(f.locale), dialog = named(page, 'dialog', copy.title); await expect(named(dialog, 'button', copy.save)).toBeEnabled(); return dialog;
}
async function presetFields(page, dialog, locale) {
	const summary = dialog.locator('summary').filter({ hasText: new RegExp(`^${photoExportPresetsCopy(locale).title}$`, 'u') }); await expect(summary).toBeVisible();
	if (await dialog.locator('[data-photo-export-presets]').getAttribute('open') === null) await keyboard(page, summary);
	await expect(named(dialog, 'combobox', photoExportPresetsCopy(locale).choose)).toBeVisible();
}
async function output(page, dialog, locale) {
	await choose(page, raster(dialog, locale, 'outputSize'), 'percentage'); await raster(dialog, locale, 'percentage').fill('50');
	await choose(page, raster(dialog, locale, 'resample'), 'nearest'); await choose(page, raster(dialog, locale, 'metadata'), 'capture');
	await toggle(page, raster(dialog, locale, 'outputSharpen'), true); await raster(dialog, locale, 'sharpenAmount').fill('37'); await raster(dialog, locale, 'sharpenThreshold').fill('9');
	await raster(dialog, locale, 'filenameTemplate').fill('Chosen-{index:3}-{name}');
}
async function assertOutput(dialog, locale) {
	await expect(raster(dialog, locale, 'outputSize')).toHaveValue('percentage'); await expect(raster(dialog, locale, 'percentage')).toHaveValue('50');
	await expect(raster(dialog, locale, 'resample')).toHaveValue('nearest'); await expect(raster(dialog, locale, 'metadata')).toHaveValue('capture');
	await expect(raster(dialog, locale, 'outputSharpen')).toBeChecked(); await expect(raster(dialog, locale, 'sharpenAmount')).toHaveValue('37');
	await expect(raster(dialog, locale, 'sharpenThreshold')).toHaveValue('9'); await expect(raster(dialog, locale, 'filenameTemplate')).toHaveValue('Chosen-{index:3}-{name}');
}
function assertPng(bytes) {
	expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]); expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1, 1]);
	const compressed = []; for (let offset = 8; offset < bytes.length;) { const size = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8);
		if (kind === 'IDAT') compressed.push(bytes.subarray(offset + 8, offset + 8 + size)); offset += size + 12; }
	expect([...inflateSync(Buffer.concat(compressed))]).toEqual([0, ...COLOR]);
}
function photoCard(app, name) { return app.getByRole('button', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?:\\s|$)`, 'u') }); }
function raster(dialog, locale, key) {
	const roles = { outputSize: 'combobox', resample: 'combobox', metadata: 'combobox', percentage: 'spinbutton',
		sharpenAmount: 'spinbutton', sharpenThreshold: 'spinbutton', filenameTemplate: 'textbox', outputSharpen: 'checkbox', sidecar: 'checkbox' };
	return named(dialog, roles[key], photoPngExportCopy(locale)[key]);
}
function closeButton(dialog, locale) { return named(dialog.locator('.lightscaper-catalog-backup-actions'), 'button', photoPngExportCopy(locale).close); }
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
async function menu(page, app, name) { await keyboard(page, app.locator('summary').filter({ hasText: new RegExp(`^${name}$`, 'u') })); }
async function toggle(page, control, desired) { if (await control.isChecked() !== desired) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Space'); } await expect(control).toBeChecked({ checked: desired }); }
async function choose(page, combo, value) {
	await expect(combo).toBeVisible(); await expect(combo).toBeEnabled(); await expect.poll(() => combo.locator('option').evaluateAll((options, value) => options.some(option => option.value === value), value)).toBe(true);
	const index = await combo.locator('option').evaluateAll((options, value) => options.findIndex(option => option.value === value), value); expect(index).toBeGreaterThanOrEqual(0); expect(index).toBeLessThan(64);
	await combo.focus(); await expect(combo).toBeFocused(); await page.keyboard.press('Home'); for (let step = 0; step < index; step++) await page.keyboard.press('ArrowDown'); await expect(combo).toHaveValue(value);
}
