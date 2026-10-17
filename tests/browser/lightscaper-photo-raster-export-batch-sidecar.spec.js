/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoBatchExportCopy } from '../../src/common/i18n/lightscaper-photo-batch-export-copy.ts';
import { photoBatchExportMenuCopy } from '../../src/common/i18n/lightscaper-photo-batch-export-menu-copy.ts';
import { photoPngExportCopy } from '../../src/common/i18n/lightscaper-photo-png-export-copy.ts';
import { photoJpegExportCopy } from '../../src/common/i18n/lightscaper-photo-jpeg-export-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { numberEntry, pngChunk, textEntry, tiffFixture } from '../helpers/image-metadata-fixtures.ts';
import { decodePinnedJpegRgbFrame } from './helpers/pinned-video-frame-decoder.mjs';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { assertNativeOpfsWorkerExecution, installNativeOpfsWorkerCompanion } from './helpers/native-opfs-worker-companion.ts';

// Native catalog observation serves executable test-only code. Cold cases keep ordinary coverage.
const observedTest = test.extend({ browserCoverage: false });
const SOURCE_NAME = 'Sidecar original.png', CAMERA = 'Sidecar camera sentinel';
const PIXELS = [137, 0, 0, 255, 137, 0, 0, 255];
const CUBE = Buffer.from(`LUT_3D_SIZE 2\n${'0.25 0 0\n'.repeat(8)}`);
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
	pngChunk('IHDR', Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0])), pngChunk('sRGB', Buffer.from([0])),
	pngChunk('eXIf', tiffFixture([numberEntry(0x0112, 1), textEntry(0x010f, CAMERA)], [numberEntry(0xa001, 1)])),
	pngChunk('IDAT', deflateSync(Buffer.from([0, 200, 0, 0, 255, 0, 200, 0, 255, 0, 0, 0, 200, 255, 200, 200, 0, 255]))), pngChunk('IEND', Buffer.alloc(0))]);

for (const locale of ['en', 'de']) {
	test(`${locale}: paired sidecars remain inside the cold selected-photo File menu`, async ({ page }) => {
		const requested = []; page.on('request', request => { if (request.resourceType() === 'script') requested.push(request.url()); });
		const { app, copy } = await open(page, locale); await menu(page, app, copy.photoFileMenu);
		await expect(named(app, 'button', photoBatchExportMenuCopy(locale).downloadSelected)).toBeDisabled();
		await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('checkbox')).toHaveCount(0);
		expect(requested.filter(url => /(?:PhotoRasterBatchExportDialog|photo-raster-export-batch-sidecar|editor-(?:png|jpeg)-bytes)/u.test(url))).toEqual([]);
	});
	for (const format of ['png', 'jpeg']) observedTest(`${locale}: ${format} batch pairs canonical saved LUT/crop facts with each image and keeps default-off delivery`, async ({ page, browserName }) => {
		observedTest.skip(browserName === 'webkit', 'The roadmap defers native WebKit Blob/OPFS catalog workflows.'); observedTest.setTimeout(120_000);
		const f = await developed(page, locale), downloads = []; page.on('download', download => { downloads.push(download); });
		const words = photoBatchExportCopy(locale), settings = format === 'png' ? photoPngExportCopy(locale) : photoJpegExportCopy(locale);
		let dialog = await batch(page, f, false); await choose(page, named(dialog, 'combobox', words.format), format);
		const enabled = named(dialog, 'checkbox', settings.sidecar); await expect(enabled).not.toBeChecked();
		await keyboard(page, named(dialog, 'button', words.start)); await expect.poll(() => downloads.length).toBe(2);
		await expect(dialog.locator('[data-photo-batch-export-receipt]')).toHaveAttribute('data-phase', 'settled');
		const names = f.names.map((name, index) => `${String(index + 1).padStart(2, '0')}-${name.replace(/\.png$/u, '')}.${format === 'png' ? 'png' : 'jpg'}`);
		for (const [index, download] of downloads.entries()) await assertImage(page, download, format, names[index]);
		await expect(dialog.locator('[data-photo-batch-sidecar-receipt]')).toHaveCount(0);
		await keyboard(page, named(dialog, 'button', words.hide)); dialog = await batch(page, f, false);
		await expect(named(dialog, 'button', words.replaceCompleted)).toBeEnabled();
		const pair = named(dialog, 'checkbox', settings.sidecar); await pair.focus(); await expect(pair).toBeFocused(); await page.keyboard.press('Space'); await expect(pair).toBeChecked();
		await keyboard(page, named(dialog, 'button', words.replaceCompleted)); await expect.poll(() => downloads.length).toBe(6);
		await expect(dialog.locator('[data-photo-batch-export-receipt]')).toHaveAttribute('data-phase', 'settled');
		expect(downloads.slice(2).map(download => download.suggestedFilename())).toEqual([names[0], `${names[0]}.lightscaper.json`, names[1], `${names[1]}.lightscaper.json`]);
		for (let index = 0; index < 2; index++) {
			await assertImage(page, downloads[2 + index * 2], format, names[index]);
			await assertSidecar(page, downloads[3 + index * 2], names[index], { root: f.before.root, photos: [f.before.photos[index]] });
		}
		await expect(dialog.locator('[data-sidecar-status="download-started"]')).toHaveCount(2);
		expect(await observe(page, f.ids)).toEqual(f.before); expect(f.errors).toEqual([]);
		await page.reload(); await expect(f.app).toBeVisible(); expect(await observe(page, f.ids)).toEqual(f.before);
		dialog = await batch(page, f, true); await expect(dialog.locator('[data-journal-state="already-committed"]')).toHaveCount(2);
		await expect(named(dialog, 'button', words.continue)).toBeDisabled(); expect(downloads).toHaveLength(6);
	});
}
observedTest('en: a refused companion remains reviewed unfinished history and retries only JSON', async ({ page, browserName }) => {
	observedTest.skip(browserName === 'webkit', 'The roadmap defers native WebKit Blob/OPFS catalog workflows.'); observedTest.setTimeout(120_000);
	const f = await developed(page, 'en'), downloads = []; page.on('download', download => { downloads.push(download); });
	const words = photoBatchExportCopy('en'), settings = photoPngExportCopy('en'); let dialog = await batch(page, f, false);
	const pair = named(dialog, 'checkbox', settings.sidecar); await pair.focus(); await expect(pair).toBeFocused(); await page.keyboard.press('Space');
	await page.evaluate(() => { globalThis.__sidecarDownloadObservation.failNextJson = true; });
	await keyboard(page, named(dialog, 'button', words.start)); await expect.poll(() => downloads.length).toBe(3);
	await expect(dialog.locator('[data-photo-batch-export-receipt]')).toHaveAttribute('data-phase', 'settled');
	await expect(dialog.locator('[data-sidecar-status="failed"]')).toContainText(settings.sidecarPartial);
	const names = f.names.map((name, index) => `${String(index + 1).padStart(2, '0')}-${name}`);
	expect(downloads.map(download => download.suggestedFilename())).toEqual([names[0], names[1], `${names[1]}.lightscaper.json`]);
	await assertImage(page, downloads[0], 'png', names[0]); expect(await observe(page, f.ids)).toEqual(f.before);
	await keyboard(page, named(dialog, 'button', words.hide)); dialog = await batch(page, f, true);
	await expect(dialog.locator('[data-journal-state="needs-review"]')).toHaveCount(1); await expect(named(dialog, 'button', words.replaceCompleted)).toHaveCount(0);
	await expect(named(dialog, 'button', words.discard)).toBeDisabled(); await expect(named(dialog, 'button', words.continue)).toBeDisabled();
	const review = named(dialog, 'checkbox', words.review.replace('{name}', names[0]));
	await review.focus(); await expect(review).toBeFocused(); await page.keyboard.press('Space'); await expect(review).toBeChecked();
	await keyboard(page, named(dialog, 'button', words.continue)); await expect.poll(() => downloads.length).toBe(4);
	await expect(dialog.locator('[data-photo-batch-export-receipt]')).toHaveAttribute('data-phase', 'settled');
	await assertSidecar(page, downloads[3], names[0], { root: f.before.root, photos: [f.before.photos[0]] });
	expect(downloads.filter(download => /\.(?:png|jpg)$/u.test(download.suggestedFilename()))).toHaveLength(2);
	expect(await observe(page, f.ids)).toEqual(f.before); expect(f.errors).toEqual([]);
});
async function batch(page, f, reopen) {
	const words = photoBatchExportCopy(f.locale), labels = photoBatchExportMenuCopy(f.locale);
	if (!reopen) { await menu(page, f.app, f.copy.photoFileMenu); await menu(page, f.app, f.copy.photoPhotoMenu); await keyboard(page, named(f.app, 'button', f.copy.photoSelectAll)); }
	await menu(page, f.app, f.copy.photoFileMenu); await keyboard(page, named(f.app, 'button', reopen ? labels.queue : labels.downloadSelected));
	const dialog = named(page, 'dialog', words.title); await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('status').filter({ hasText: words.preparing })).toHaveCount(0); return dialog;
}
async function developed(page, locale) {
	await page.addInitScript(() => {
		Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
		const create = URL.createObjectURL, click = HTMLAnchorElement.prototype.click, blobType = Object.getOwnPropertyDescriptor(Blob.prototype, 'type').get;
		const state = { urls: [], anchors: [], failNextJson: false }; Object.defineProperty(globalThis, '__sidecarDownloadObservation', { value: state });
		Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: function (...args) {
			const url = Reflect.apply(create, this, args);
			if (args[0] instanceof Blob) { if (state.urls.length === 64) state.urls.shift(); state.urls.push({ url, type: Reflect.apply(blobType, args[0], []) }); }
			return url;
		} });
		// Only the deliberately armed JSON delivery fails. Other native receiver/arguments/results are preserved.
		Object.defineProperty(HTMLAnchorElement.prototype, 'click', { configurable: true, writable: true, value: function (...args) {
			const type = state.urls.find(row => row.url === this.href)?.type;
			if (this.download && type) {
				const refused = type === 'application/json' && state.failNextJson;
				if (state.anchors.length === 32) state.anchors.shift(); state.anchors.push({ name: this.download, type, refused });
				if (refused) { state.failNextJson = false; throw new Error('Sidecar test JSON delivery refused.'); }
			}
			return Reflect.apply(click, this, args);
		} });
	});
	const errors = []; page.on('pageerror', error => { errors.push(error.message); });
	const { app, copy } = await open(page, locale), messages = photoDevelopCopy(locale);
	await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', copy.photoImportPhotos));
	const importer = named(page, 'dialog', copy.photoImportPhotos);
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles([{ name: SOURCE_NAME, mimeType: 'image/png', buffer: PNG }, { name: 'Second original.png', mimeType: 'image/png', buffer: PNG }]);
	await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
	const library = app.locator('[data-photo-library]'), cards = library.locator('[data-photo-id]');
	await expect(cards).toHaveCount(2); await expect(library).toHaveAttribute('aria-busy', 'false'); const ids = await cards.evaluateAll(elements => elements.map(element => element.getAttribute('data-photo-id')));
	const imported = await observe(page, ids); expect(imported.photos.map(item => item.photo.original.name).sort()).toEqual([SOURCE_NAME, 'Second original.png'].sort());
	for (let index = 0; index < 2; index++) {
		const sourceName = imported.photos[index].photo.original.name;
		await keyboard(page, cards.nth(index)); await menu(page, app, copy.photoFileMenu); await menu(page, app, copy.photoPhotoMenu);
		await keyboard(page, named(app, 'button', photoDevelopMenuLabel(locale)));
		const dialog = named(page, 'dialog', `${messages.title}: ${sourceName}`);
		await expect(named(dialog, 'region', messages.preview)).toHaveAttribute('data-state', 'ready');
		await choose(page, named(dialog, 'combobox', messages.choose), 'cube-lut-profile-v1'); await keyboard(page, named(dialog, 'button', messages.add));
		await dialog.getByLabel(messages.shared.videoEffectCubeLutImport, { exact: true }).setInputFiles({ name: 'Quarter red.cube', mimeType: 'text/plain', buffer: CUBE });
		await choose(page, named(dialog, 'combobox', messages.choose), 'develop-geometry-v1'); await keyboard(page, named(dialog, 'button', messages.add));
		const crop = named(dialog, 'spinbutton', `${messages.shared.videoEffectExactValue}: ${messages.shared.videoEffectParamCropWidth}`); await crop.fill('0.5'); await crop.press('Enter');
		const after = named(dialog, 'img', messages.after); await expect.poll(() => after.evaluate(canvas => [canvas.width, canvas.height])).toEqual([1, 2]);
		await expect.poll(() => after.evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, 1, 2).data))).toEqual(PIXELS);
		await keyboard(page, named(dialog, 'button', messages.save)); await expect(dialog.locator('[data-photo-develop-ack]')).toBeVisible();
		await expect(named(dialog, 'button', messages.cancel).last()).toBeDisabled(); await keyboard(page, named(dialog, 'button', messages.close).last()); await expect(dialog).toHaveCount(0);
	}
	const before = await observe(page, ids);
	for (const [index, item] of before.photos.entries()) {
		const photo = item.photo, version = photo.versions.find(item => item.id === photo.activeVersionId);
		expect(item.bytes).toEqual([...PNG]); expect(photo.original.name).toBe(imported.photos[index].photo.original.name); expect(photo.original.byteLength).toBe(PNG.length);
		expect(photo.original.contentSha256).toBe(createHash('sha256').update(PNG).digest('hex')); expect(photo.schemaVersion).toBe(2); expect(version.develop.processVersion).toBe(2);
		expect(version.develop.effects.map(effect => [effect.type, effect.enabled])).toEqual([['cube-lut-profile-v1', true], ['develop-geometry-v1', true]]);
		expect(version.develop.effects[0].params.lut).toMatchObject({ sha256: createHash('sha256').update(CUBE).digest('hex'), byteLength: CUBE.length, size: 2 });
		expect(version.develop.effects[1].params.cropWidth).toBe(0.5); expect(photo.extractedMetadata.exif.cameraMake).toBe(CAMERA);
	}
	return { app, copy, ids, before, errors, locale, names: before.photos.map(item => item.photo.original.name) };
}

async function assertSidecar(page, download, rasterName, before) {
	expect(download.suggestedFilename()).toBe(`${rasterName}.lightscaper.json`); await assertMime(page, download, 'application/json');
	const bytes = await readFile(await download.path()); expect(bytes.length).toBeGreaterThan(0); expect(bytes.length).toBeLessThanOrEqual(2_097_152);
	const value = JSON.parse(bytes.toString('utf8')), photo = before.photos[0].photo, selected = photo.versions.find(version => version.id === photo.activeVersionId);
	// Explicit facts from the real resident owner, not an application serializer or renderer as oracle.
	expect(value).toEqual({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-export-sidecar', photoSchemaVersion: photo.schemaVersion,
		binding: { catalogId: before.root.id, photoId: photo.id, revision: photo.revision, activeVersionId: photo.activeVersionId },
		original: { fileName: photo.original.name, contentSha256: createHash('sha256').update(PNG).digest('hex'), byteLength: PNG.length },
		version: { id: selected.id, kind: selected.kind, name: selected.name, createdAt: selected.createdAt, develop: selected.develop },
		metadata: photo.metadata, extractedMetadata: photo.extractedMetadata });
}
async function assertImage(page, download, format, name) {
	expect(download.suggestedFilename()).toBe(name); await assertMime(page, download, `image/${format}`);
	const bytes = await readFile(await download.path()); expect(bytes.length).toBeLessThanOrEqual(1024 * 1024);
	if (format === 'jpeg') {
		expect([...bytes.subarray(0, 2)]).toEqual([255, 216]); expect([...bytes.subarray(-2)]).toEqual([255, 217]);
		const decoded = await decodePinnedJpegRgbFrame(bytes); expect([decoded.width, decoded.height, decoded.rgb.length]).toEqual([1, 2, 6]);
		for (let index = 0; index < decoded.rgb.length; index++) expect(Math.abs(decoded.rgb[index] - PIXELS[Math.floor(index / 3) * 4 + index % 3])).toBeLessThanOrEqual(8);
		return;
	}
	expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]); const compressed = []; let offset = 8;
	while (offset < bytes.length) {
		expect(offset + 12).toBeLessThanOrEqual(bytes.length); const size = bytes.readUInt32BE(offset), end = offset + size + 12; expect(end).toBeLessThanOrEqual(bytes.length);
		const type = bytes.toString('ascii', offset + 4, offset + 8), data = bytes.subarray(offset + 8, end - 4); expect(bytes.readUInt32BE(end - 4)).toBe(crc32(bytes.subarray(offset + 4, end - 4)));
		if (type === 'IHDR') expect([...data]).toEqual([0, 0, 0, 1, 0, 0, 0, 2, 8, 6, 0, 0, 0]);
		else if (type === 'IDAT') compressed.push(data); else { expect(['sRGB', 'IEND']).toContain(type); if (type === 'sRGB') expect([...data]).toEqual([0]); else expect(size).toBe(0); }
		offset = end;
	}
	expect(offset).toBe(bytes.length); expect(compressed.length).toBeGreaterThan(0); expect([...inflateSync(Buffer.concat(compressed))]).toEqual([0, ...PIXELS.slice(0, 4), 0, ...PIXELS.slice(4)]);
}
async function assertMime(page, download, type) {
	expect(await page.evaluate(url => globalThis.__sidecarDownloadObservation.urls.filter(row => row.url === url).map(row => row.type), download.url())).toEqual([type]);
}
function crc32(bytes) {
	let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0;
}
async function open(page, locale) {
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`); const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible(); return { app, copy: bundledLightscaperEditorCopyForLocale(locale) };
}
async function observe(page, ids) {
	await installNativeOpfsWorkerCompanion(page);
	const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('../helpers/', import.meta.url)), contents: `export { readResidentPhotoLibraryCurrent } from './lightscaper-current-app-fixture.tsx';` }, bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.woff2': 'dataurl' } });
	await page.route('**/__raster_sidecar_observer.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
	const result = await page.evaluate(async id => (await import(new URL('/__raster_sidecar_observer.js', location.href).href)).readResidentPhotoLibraryCurrent(id, indexedDB, () => globalThis.__assertNativeOpfsWorkerExecution()), ids);
	await assertNativeOpfsWorkerExecution(page); return result;
}
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
async function menu(page, app, name) { await keyboard(page, app.locator('summary').filter({ hasText: new RegExp(`^${name}$`, 'u') })); }
async function choose(page, combo, value) {
	await expect(combo).toBeVisible(); await expect(combo).toBeEnabled();
	await expect.poll(() => combo.locator('option').evaluateAll((options, value) => options.some(option => option.value === value), value)).toBe(true);
	const index = await combo.locator('option').evaluateAll((options, value) => options.findIndex(option => option.value === value), value); expect(index).toBeGreaterThanOrEqual(0); expect(index).toBeLessThan(64);
	await combo.focus(); await expect(combo).toBeFocused(); await page.keyboard.press('Home'); for (let step = 0; step < index; step++) await page.keyboard.press('ArrowDown'); await expect(combo).toHaveValue(value);
}
