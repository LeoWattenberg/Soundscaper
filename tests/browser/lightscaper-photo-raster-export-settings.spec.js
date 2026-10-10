/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { pngChunk } from '../helpers/image-metadata-fixtures.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { assertNativeOpfsWorkerExecution, installNativeOpfsWorkerCompanion } from './helpers/native-opfs-worker-companion.ts';

// The catalog custody observer serves test-only code, as in the owning PNG workflow.
test.use({ browserCoverage: false });
const BLACK = [0, 0, 0, 255], GREEN = [0, 200, 0, 255], AVERAGE = [0, 100, 0, 255];
// Independent PNG fixture: four encoded-sRGB corners, with no application encoder.
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
	pngChunk('IHDR', Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0])),
	pngChunk('sRGB', Buffer.from([0])), pngChunk('IDAT', deflateSync(Buffer.from([
		0, ...BLACK, 200, 0, 0, 255, 0, ...GREEN, 200, 200, 0, 255,
	]))), pngChunk('IEND', Buffer.alloc(0))]);

for (const locale of ['en', 'de']) {
	test(`${locale}: menu-opened photo output settings resize and sharpen the saved crop, recover invalid values, and preserve the catalog`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'The roadmap defers native WebKit Blob/OPFS catalog workflows.');
		test.setTimeout(90_000);
		await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
		const errors = [], downloads = [];
		page.on('pageerror', error => { errors.push(error.message); });
		page.on('download', download => { downloads.push(download.suggestedFilename()); });
		const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
		await page.goto(`${origin}/${locale}/`);
		const app = page.locator('[data-lightscaper-bound="true"]'), copy = bundledLightscaperEditorCopyForLocale(locale), messages = photoDevelopCopy(locale);
		await expect(app).toBeVisible();
		await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', copy.photoImportPhotos));
		const importer = named(page, 'dialog', copy.photoImportPhotos);
		await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: 'Sizing original.png', mimeType: 'image/png', buffer: PNG });
		await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
		const library = app.locator('[data-photo-library]'), card = library.locator('[data-photo-id]');
		await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false');
		const photoId = await card.getAttribute('data-photo-id');
		await keyboard(page, card); await menu(page, app, copy.photoFileMenu); await menu(page, app, copy.photoPhotoMenu);
		await keyboard(page, named(app, 'button', photoDevelopMenuLabel(locale)));
		const develop = named(page, 'dialog', `${messages.title}: Sizing original.png`);
		await expect(named(develop, 'region', messages.preview)).toHaveAttribute('data-state', 'ready');
		await named(develop, 'combobox', messages.choose).selectOption('develop-geometry-v1');
		await keyboard(page, named(develop, 'button', messages.add));
		const crop = named(develop, 'spinbutton', `${messages.shared.videoEffectExactValue}: ${messages.shared.videoEffectParamCropWidth}`);
		await crop.fill('0.5'); await crop.press('Enter');
		const after = named(develop, 'img', messages.after);
		await expect.poll(() => after.evaluate(canvas => [canvas.width, canvas.height])).toEqual([1, 2]);
		await expect.poll(() => after.evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, 1, 2).data))).toEqual([...BLACK, ...GREEN]);
		await keyboard(page, named(develop, 'button', messages.save));
		await expect(develop.locator('[data-photo-develop-ack]')).toBeVisible();
		await keyboard(page, named(develop, 'button', messages.close).last()); await expect(develop).toHaveCount(0);
		const before = await observe(page, photoId);
		expect(before.photos[0].bytes).toEqual([...PNG]);
		expect(before.photos[0].photo.original.contentSha256).toBe(createHash('sha256').update(PNG).digest('hex'));
		await menu(page, app, copy.photoFileMenu); await keyboard(page, app.locator('[data-photo-png-export-menu]'));
		const dialog = page.getByRole('dialog').filter({ has: page.locator('[data-photo-png-export-dialog]') });
		await expect(dialog).toBeVisible();
		const sizing = dialog.locator('[data-photo-raster-export-sizing]'), template = dialog.locator('[data-photo-raster-export-filename-template]');
		await expect(sizing).toHaveValue('original'); await expect(template).toHaveValue('{name}');
		await expect(dialog.locator('[data-photo-raster-export-sharpen]')).not.toBeChecked();
		await exportPng('Sizing original.png', 1, 2, [...BLACK, ...GREEN]);
		await template.fill('{clock}'); await keyboard(page, dialog.locator('[data-photo-png-export-save]'));
		await expect(dialog.getByRole('alert')).toBeVisible(); expect(downloads).toEqual(['Sizing original.png']);
		await template.fill('{name}-{index:3}');
		for (const [kind, fields] of [
			['percentage', [['percentage', '50']]], ['fit', [['width', '1'], ['height', '1']]],
			['long-edge', [['long-edge', '1']]], ['megapixels', [['megapixels', '0.000001']]],
		]) {
			await sizing.selectOption(kind);
			for (const [field, value] of fields) await dialog.locator(`[data-photo-raster-export-${field}]`).fill(value);
			await dialog.locator('[data-photo-raster-export-resample]').selectOption('bilinear');
			await exportPng('Sizing original-001.png', 1, 1, AVERAGE);
		}
		await sizing.selectOption('percentage'); await dialog.locator('[data-photo-raster-export-resample]').selectOption('nearest');
		await exportPng('Sizing original-001.png', 1, 1, BLACK);
		await sizing.selectOption('long-edge'); await dialog.locator('[data-photo-raster-export-long-edge]').fill('4');
		await expect(dialog.locator('[data-photo-raster-export-upscale]')).not.toBeChecked();
		await exportPng('Sizing original-001.png', 1, 2, [...BLACK, ...GREEN]);
		await dialog.locator('[data-photo-raster-export-upscale]').check();
		await exportPng('Sizing original-001.png', 2, 4, [...BLACK, ...BLACK, ...BLACK, ...BLACK, ...GREEN, ...GREEN, ...GREEN, ...GREEN]);
		await sizing.selectOption('original'); await dialog.locator('[data-photo-raster-export-sharpen]').check();
		const threshold = dialog.locator('[data-photo-raster-export-sharpen-threshold]');
		await threshold.fill('256'); await keyboard(page, dialog.locator('[data-photo-png-export-save]'));
		await expect(dialog.getByRole('alert')).toBeVisible(); expect(downloads).toHaveLength(8);
		await threshold.fill('0');
		await exportPng('Sizing original-001.png', 1, 2, [...BLACK, 0, 250, 0, 255]);
		await threshold.fill('50');
		await exportPng('Sizing original-001.png', 1, 2, [...BLACK, ...GREEN]);
		await keyboard(page, dialog.locator('[data-photo-png-export-close]')); await expect(dialog).toHaveCount(0);
		expect(await observe(page, photoId)).toEqual(before);
		await page.reload(); await expect(app).toBeVisible();
		await menu(page, app, copy.photoViewMenu); await keyboard(page, named(app, 'button', copy.photoShowLibrary));
		await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false');
		expect(await observe(page, photoId)).toEqual(before); expect(errors).toEqual([]);

		async function exportPng(name, width, height, pixels) {
			const save = dialog.locator('[data-photo-png-export-save]'); await expect(save).toBeEnabled();
			const pending = page.waitForEvent('download'); await keyboard(page, save); const download = await pending;
			expect(download.suggestedFilename()).toBe(name); assertPng(await readFile(await download.path()), width, height, pixels);
			await expect(dialog.locator('[data-photo-png-export-receipt]')).toHaveAttribute('data-photo-png-export-status', 'download-started');
			await expect(save).toBeEnabled(); await expect(dialog.getByRole('alert')).toHaveCount(0);
		}
	});
}

/** Independent zlib and CRC checks pin literal pixels without importing application codecs. */
function assertPng(bytes, width, height, pixels) {
	expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	const chunks = [], compressed = []; let offset = 8;
	while (offset < bytes.length) {
		const size = bytes.readUInt32BE(offset), end = offset + 12 + size;
		expect(end).toBeLessThanOrEqual(bytes.length);
		const type = bytes.toString('ascii', offset + 4, offset + 8), data = bytes.subarray(offset + 8, end - 4);
		expect(bytes.readUInt32BE(end - 4)).toBe(crc32(bytes.subarray(offset + 4, end - 4))); chunks.push(type);
		if (type === 'IHDR') { expect(data.readUInt32BE(0)).toBe(width); expect(data.readUInt32BE(4)).toBe(height); expect([...data.subarray(8)]).toEqual([8, 6, 0, 0, 0]); }
		else if (type === 'sRGB') expect([...data]).toEqual([0]);
		else if (type === 'IDAT') compressed.push(data);
		else { expect(type).toBe('IEND'); expect(size).toBe(0); }
		offset = end;
	}
	expect(offset).toBe(bytes.length); expect(chunks.slice(0, 2)).toEqual(['IHDR', 'sRGB']); expect(chunks.at(-1)).toBe('IEND');
	expect(chunks.slice(2, -1).every(type => type === 'IDAT')).toBe(true); expect(compressed.length).toBeGreaterThan(0);
	const scanlines = []; for (let y = 0; y < height; y++) scanlines.push(0, ...pixels.slice(4 * width * y, 4 * width * (y + 1)));
	expect([...inflateSync(Buffer.concat(compressed))]).toEqual(scanlines);
}
function crc32(bytes) {
	let value = 0xffffffff;
	for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
	return (value ^ 0xffffffff) >>> 0;
}
async function observe(page, photoId) {
	await installNativeOpfsWorkerCompanion(page);
	const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('../helpers/', import.meta.url)), contents:
		`export { readResidentPhotoLibraryCurrent } from './lightscaper-current-app-fixture.tsx';` }, bundle: true, write: false, format: 'esm', platform: 'browser' });
	await page.route('**/__raster_settings_observer.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
	const observed = await page.evaluate(async id => (await import(new URL('/__raster_settings_observer.js', location.href).href))
		.readResidentPhotoLibraryCurrent([id], indexedDB, () => globalThis.__assertNativeOpfsWorkerExecution()), photoId);
	await assertNativeOpfsWorkerExecution(page); return observed;
}
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
async function menu(page, app, name) { await keyboard(page, app.locator('summary').filter({ hasText: new RegExp(`^${name}$`, 'u') })); }
