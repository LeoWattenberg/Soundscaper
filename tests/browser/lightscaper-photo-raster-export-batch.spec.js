/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoBatchExportMenuCopy } from '../../src/common/i18n/lightscaper-photo-batch-export-menu-copy.ts';
import { photoBatchExportCopy } from '../../src/common/i18n/lightscaper-photo-batch-export-copy.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { assertNativeOpfsWorkerExecution, installNativeOpfsWorkerCompanion } from './helpers/native-opfs-worker-companion.ts';

const observedTest = test.extend({ browserCoverage: false });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==', 'base64');
for (const locale of ['en', 'de']) {
	test(`${locale}: selected photo downloads and queue remain opt-in cold File entries`, async ({ page }) => {
		const requested = []; page.on('request', request => { if (request.resourceType() === 'script') requested.push(request.url()); });
		const { app, copy } = await open(page, locale); await menu(page, app, copy.photoFileMenu);
		await expect(app.locator('[data-photo-batch-export-menu]')).toBeDisabled(); await expect(app.locator('[data-photo-queue-export-menu]')).toBeDisabled();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		expect(requested.filter(url => /(?:PhotoRasterBatchExportDialog|photo-raster-export-batch-queue|lightscaper-photo-batch-export-copy|editor-png-bytes)/u.test(url))).toEqual([]);
	});
	for (const format of ['png', 'jpeg']) observedTest(`${locale}: selected ${format} downloads preserve order, current originals and the hidden queue`, async ({ page, browserName }) => {
		observedTest.skip(browserName === 'webkit', 'The roadmap defers native WebKit Blob/OPFS catalog workflows.'); observedTest.setTimeout(90_000);
		const errors = [], downloads = []; page.on('pageerror', error => { errors.push(error.message); }); page.on('download', download => { downloads.push(download); });
		await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: () => { throw new Error('Batch cannot open a deferred picker'); } }); });
		await installNativeOpfsWorkerCompanion(page);
		const { app, copy } = await open(page, locale), words = photoBatchExportCopy(locale), labels = photoBatchExportMenuCopy(locale);
		await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', copy.photoImportPhotos));
		const importer = named(page, 'dialog', copy.photoImportPhotos);
		await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles([
			{ name: 'First.png', mimeType: 'image/png', buffer: PNG }, { name: 'Second.png', mimeType: 'image/png', buffer: PNG },
		]);
		await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
		const library = app.locator('[data-photo-library]'), cards = library.locator('[data-photo-id]');
		await expect(cards).toHaveCount(2); await expect(library).toHaveAttribute('aria-busy', 'false');
		const ids = await cards.evaluateAll(elements => elements.map(element => element.getAttribute('data-photo-id')));
		const before = await observe(page, ids); expect(before.photos.map(item => item.bytes)).toEqual([[...PNG], [...PNG]]);
		expect(before.photos.map(item => item.photo.original.contentSha256)).toEqual(Array(2).fill(createHash('sha256').update(PNG).digest('hex')));
		await menu(page, app, copy.photoFileMenu); await menu(page, app, copy.photoPhotoMenu); await keyboard(page, named(app, 'button', copy.photoSelectAll));
		await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', labels.downloadSelected));
		let dialog = named(page, 'dialog', words.title); await expect(dialog.locator('[data-photo-batch-export-start]')).toBeEnabled();
		await keyboard(page, dialog.locator('[data-photo-batch-export-hide]')); await expect(dialog).toHaveCount(0);
		// A later selection change cannot replace the menu-captured page order.
		await keyboard(page, cards.first());
		await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', labels.queue));
		dialog = named(page, 'dialog', words.title);
		await choose(page, dialog.locator('[data-photo-batch-export-format]'), format);
		await keyboard(page, dialog.locator('[data-photo-batch-export-start]'));
		await keyboard(page, dialog.locator('[data-photo-batch-export-hide]')); await expect(dialog).toHaveCount(0);
		await expect.poll(() => downloads.length).toBe(2);
		await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', labels.queue));
		dialog = named(page, 'dialog', words.title); await expect(dialog.locator('[data-photo-batch-export-receipt]')).toHaveAttribute('data-phase', 'settled');
		await expect(dialog.locator('[data-photo-batch-job][data-state="completed"]')).toHaveCount(2); await expect(dialog.getByRole('alert')).toHaveCount(0);
		const names = before.photos.map((item, index) => `${String(index + 1).padStart(2, '0')}-${item.photo.metadata.fileName.replace(/\.[^.]*$/u, '')}.${format === 'png' ? 'png' : 'jpg'}`);
		expect(downloads.map(download => download.suggestedFilename())).toEqual(names);
		for (const [index, download] of downloads.entries()) {
			await expect(dialog.locator('[data-photo-batch-job]').nth(index)).toContainText(words.downloaded.replace('{name}', names[index]));
			const bytes = await readFile(await download.path());
			if (format === 'png') assertPng(bytes);
			const decoded = await page.evaluate(async input => {
				const bitmap = await createImageBitmap(new Blob([Uint8Array.from(input.bytes)], { type: input.mimeType }));
				try { const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0);
					return { width: bitmap.width, height: bitmap.height, pixels: [...context.getImageData(0, 0, bitmap.width, bitmap.height).data] }; }
				finally { bitmap.close(); }
			}, { bytes: [...bytes], mimeType: format === 'png' ? 'image/png' : 'image/jpeg' });
			expect([decoded.width, decoded.height]).toEqual([2, 2]);
			for (let offset = 0; offset < decoded.pixels.length; offset += 4) {
				for (const [channel, value] of [255, 200, 0, 255].entries()) expect(Math.abs(decoded.pixels[offset + channel] - value)).toBeLessThanOrEqual(format === 'png' ? 0 : 3);
			}
		}
		expect(await observe(page, ids)).toEqual(before); expect(errors).toEqual([]);
		await page.reload(); await expect(app).toBeVisible(); expect(await observe(page, ids)).toEqual(before);
		await menu(page, app, copy.photoFileMenu); await expect(app.locator('[data-photo-queue-export-menu]')).toBeDisabled();
	});
}
function assertPng(bytes) {
	expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]); const compressed = []; let offset = 8;
	while (offset < bytes.length) {
		const size = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8), data = bytes.subarray(offset + 8, offset + 8 + size);
		if (type === 'IHDR') expect([...data]).toEqual([0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0]);
		else if (type === 'IDAT') compressed.push(data); else expect(['sRGB', 'IEND']).toContain(type);
		offset += size + 12;
	}
	expect(offset).toBe(bytes.length); expect([...inflateSync(Buffer.concat(compressed))]).toEqual([0, 255, 200, 0, 255, 255, 200, 0, 255, 0, 255, 200, 0, 255, 255, 200, 0, 255]);
}
async function open(page, locale) {
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`); const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
	return { app, copy: bundledLightscaperEditorCopyForLocale(locale) };
}
async function observe(page, ids) {
	const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('../helpers/', import.meta.url)), contents: `export { readResidentPhotoLibraryCurrent } from './lightscaper-current-app-fixture.tsx';` }, bundle: true, write: false, format: 'esm', platform: 'browser' });
	await page.route('**/__batch_export_observer.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
	const result = await page.evaluate(async photoIds => (await import(new URL('/__batch_export_observer.js', location.href).href)).readResidentPhotoLibraryCurrent(photoIds, indexedDB, () => globalThis.__assertNativeOpfsWorkerExecution()), ids);
	await assertNativeOpfsWorkerExecution(page); return result;
}
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
async function menu(page, app, name) { await keyboard(page, app.locator('summary').filter({ hasText: new RegExp(`^${name}$`, 'u') })); }
async function choose(page, combo, value) {
	await expect(combo).toBeVisible(); await expect(combo).toBeEnabled();
	await expect.poll(() => combo.locator('option').evaluateAll((options, value) => options.some(option => option.value === value), value)).toBe(true);
	const index = await combo.locator('option').evaluateAll((options, value) => options.findIndex(option => option.value === value), value);
	expect(index).toBeGreaterThanOrEqual(0); expect(index).toBeLessThan(64); await combo.focus(); await expect(combo).toBeFocused(); await page.keyboard.press('Home');
	for (let step = 0; step < index; step++) await page.keyboard.press('ArrowDown'); await expect(combo).toHaveValue(value);
}
