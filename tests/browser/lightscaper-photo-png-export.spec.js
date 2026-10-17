/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { assertNativeOpfsWorkerExecution, installNativeOpfsWorkerCompanion } from './helpers/native-opfs-worker-companion.ts';

// The observer serves test-only code. Cold cases retain ordinary built-site coverage.
const observedTest = test.extend({ browserCoverage: false });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==', 'base64');
const CUBE = Buffer.from(`LUT_3D_SIZE 2\n${'0.25 0 0\n'.repeat(8)}`);
const PIXELS = [137, 0, 0, 255, 137, 0, 0, 255];

for (const locale of ['en', 'de']) {
	test(`${locale}: PNG export is a cold disabled File menu action on an empty library`, async ({ page }) => {
		const requests = [];
		page.on('request', request => { if (request.resourceType() === 'script') requests.push(new URL(request.url()).pathname); });
		const { app, copy } = await open(page, locale);
		await expect(app.locator('[data-photo-library]')).toHaveCount(0);
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await menu(page, app, copy.photoFileMenu);
		await expect(app.locator('[data-photo-png-export-menu]')).toBeDisabled();
		await expect(app.locator('[data-photo-png-export-dialog]')).toHaveCount(0);
		expect(requests.filter(path => /(?:editor-png-bytes|PhotoPngExportDialog|lightscaper-photo-png-export-copy)/u.test(path))).toEqual([]);
	});

	observedTest(`${locale}: keyboard PNG export preserves full-resolution LUT and crop pixels, strips source metadata, and leaves originals and develop history unchanged`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'The roadmap defers native WebKit Blob/OPFS catalog workflows.');
		test.setTimeout(90_000);
		await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
		const errors = [];
		page.on('pageerror', error => { errors.push(error.message); });
		const { app, copy } = await open(page, locale), messages = photoDevelopCopy(locale);
		await menu(page, app, copy.photoFileMenu);
		await keyboard(page, named(app, 'button', copy.photoImportPhotos));
		const importer = named(page, 'dialog', copy.photoImportPhotos);
		await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: 'Export original.png', mimeType: 'image/png', buffer: PNG });
		await keyboard(page, named(importer, 'button', copy.photoImportAction));
		await expect(importer).toHaveCount(0);
		const library = app.locator('[data-photo-library]'), card = library.locator('[data-photo-id]');
		await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false');
		const photoId = await card.getAttribute('data-photo-id');
		await keyboard(page, card); await menu(page, app, copy.photoFileMenu); await menu(page, app, copy.photoPhotoMenu);
		await keyboard(page, named(app, 'button', photoDevelopMenuLabel(locale)));
		const develop = named(page, 'dialog', `${messages.title}: Export original.png`);
		await expect(named(develop, 'region', messages.preview)).toHaveAttribute('data-state', 'ready');
		await choose(page, named(develop, 'combobox', messages.choose), 'cube-lut-profile-v1');
		await keyboard(page, named(develop, 'button', messages.add));
		await develop.getByLabel(messages.shared.videoEffectCubeLutImport, { exact: true }).setInputFiles({ name: 'Quarter red.cube', mimeType: 'text/plain', buffer: CUBE });
		await choose(page, named(develop, 'combobox', messages.choose), 'develop-geometry-v1');
		await keyboard(page, named(develop, 'button', messages.add));
		const crop = named(develop, 'spinbutton', `${messages.shared.videoEffectExactValue}: ${messages.shared.videoEffectParamCropWidth}`);
		await crop.fill('0.5'); await crop.press('Enter');
		const after = named(develop, 'img', messages.after);
		await expect.poll(() => after.evaluate(canvas => [canvas.width, canvas.height])).toEqual([1, 2]);
		await expect.poll(() => after.evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, 1, 2).data))).toEqual(PIXELS);
		await keyboard(page, named(develop, 'button', messages.save));
		await expect(develop.locator('[data-photo-develop-ack]')).toBeVisible();
		await expect(named(develop, 'button', messages.cancel).last()).toBeDisabled();
		await keyboard(page, named(develop, 'button', messages.close).last()); await expect(develop).toHaveCount(0);
		const before = await observe(page, photoId);
		expect(before.photos[0].bytes).toEqual([...PNG]);
		expect(before.photos[0].photo.original.contentSha256).toBe(createHash('sha256').update(PNG).digest('hex'));
		const first = await exportPng();
		expect(first.name).toBe('Export original.png');
		assertPng(first.bytes);
		expect(await observe(page, photoId)).toEqual(before);
		const second = await exportPng();
		expect(second).toEqual(first); expect(await observe(page, photoId)).toEqual(before);
		await page.reload(); await expect(app).toBeVisible();
		await menu(page, app, copy.photoViewMenu); await keyboard(page, named(app, 'button', copy.photoShowLibrary));
		await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false'); await keyboard(page, card);
		expect(await exportPng()).toEqual(first);
		expect(await observe(page, photoId)).toEqual(before); expect(errors).toEqual([]);

		async function exportPng() {
			await menu(page, app, copy.photoFileMenu); await keyboard(page, app.locator('[data-photo-png-export-menu]'));
			const dialog = page.getByRole('dialog').filter({ has: page.locator('[data-photo-png-export-dialog]') });
			await expect(dialog).toBeVisible();
			const save = dialog.locator('[data-photo-png-export-save]');
			await expect(save).toBeEnabled(); await expect(save).toBeFocused();
			const pending = page.waitForEvent('download'); await keyboard(page, save); const download = await pending;
			const bytes = await readFile(await download.path());
			await expect(dialog.locator('[data-photo-png-export-receipt]')).toBeVisible();
			await expect(save).toBeEnabled(); await expect(dialog.getByRole('alert')).toHaveCount(0);
			await keyboard(page, dialog.locator('[data-photo-png-export-close]')); await expect(dialog).toHaveCount(0);
			return { name: download.suggestedFilename(), bytes };
		}
	});
}

/** Independent zlib/bitwise CRC oracle; never import the encoder or renderer to derive expected pixels. */
function assertPng(bytes) {
	expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	const chunks = [], compressed = [];
	let offset = 8;
	while (offset < bytes.length) {
		const size = bytes.readUInt32BE(offset), end = offset + 12 + size;
		expect(end).toBeLessThanOrEqual(bytes.length);
		const type = bytes.toString('ascii', offset + 4, offset + 8), data = bytes.subarray(offset + 8, end - 4);
		expect(bytes.readUInt32BE(end - 4)).toBe(crc32(bytes.subarray(offset + 4, end - 4)));
		chunks.push(type);
		if (type === 'IHDR') expect([...data]).toEqual([0, 0, 0, 1, 0, 0, 0, 2, 8, 6, 0, 0, 0]);
		else if (type === 'sRGB') expect([...data]).toEqual([0]);
		else if (type === 'IDAT') compressed.push(data);
		else { expect(type).toBe('IEND'); expect(size).toBe(0); }
		offset = end;
	}
	expect(offset).toBe(bytes.length); expect(chunks.slice(0, 2)).toEqual(['IHDR', 'sRGB']); expect(chunks.at(-1)).toBe('IEND');
	expect(chunks.slice(2, -1).every(type => type === 'IDAT')).toBe(true); expect(compressed.length).toBeGreaterThan(0);
	expect([...inflateSync(Buffer.concat(compressed))]).toEqual([0, ...PIXELS.slice(0, 4), 0, ...PIXELS.slice(4)]);
}
function crc32(bytes) {
	let value = 0xffffffff;
	for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
	return (value ^ 0xffffffff) >>> 0;
}
async function open(page, locale) {
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`);
	const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
	return { app, copy: bundledLightscaperEditorCopyForLocale(locale) };
}
async function observe(page, photoId) {
	await installNativeOpfsWorkerCompanion(page);
	const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('../helpers/', import.meta.url)), contents:
		`export { readResidentPhotoLibraryCurrent } from './lightscaper-current-app-fixture.tsx';` }, bundle: true, write: false, format: 'esm', platform: 'browser' });
	await page.route('**/__png_export_observer.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
	const observed = await page.evaluate(async id => (await import(new URL('/__png_export_observer.js', location.href).href))
		.readResidentPhotoLibraryCurrent([id], indexedDB, () => globalThis.__assertNativeOpfsWorkerExecution()), photoId);
	await assertNativeOpfsWorkerExecution(page); return observed;
}
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
async function menu(page, app, name) { await keyboard(page, app.locator('summary').filter({ hasText: new RegExp(`^${name}$`, 'u') })); }
async function choose(page, combo, value) {
	await expect(combo).toBeVisible(); await expect(combo).toBeEnabled();
	await expect.poll(() => combo.locator('option').evaluateAll((options, value) => options.some(option => option.value === value), value)).toBe(true);
	const index = await combo.locator('option').evaluateAll((options, value) => options.findIndex(option => option.value === value), value);
	expect(index).toBeGreaterThanOrEqual(0); expect(index).toBeLessThan(64);
	await combo.focus(); await expect(combo).toBeFocused(); await page.keyboard.press('Home');
	for (let step = 0; step < index; step++) await page.keyboard.press('ArrowDown'); await expect(combo).toHaveValue(value);
}
