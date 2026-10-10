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
	test(`${locale}: sidecar controls stay inside cold opt-in File export dialogs`, async ({ page }) => {
		const requested = []; page.on('request', request => { if (request.resourceType() === 'script') requested.push(new URL(request.url()).pathname); });
		const { app, copy } = await open(page, locale); await menu(page, app, copy.photoFileMenu);
		await expect(app.locator('[data-photo-png-export-menu]')).toBeDisabled(); await expect(app.locator('[data-photo-jpeg-export-menu]')).toBeDisabled();
		await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('[data-photo-raster-export-sidecar]')).toHaveCount(0);
		expect(requested.filter(path => /(?:editor-(?:png|jpeg)-bytes|Photo(?:Png|Jpeg|Raster)ExportDialog|lightscaper-photo-(?:png|jpeg)-export-copy)/u.test(path))).toEqual([]);
	});
	for (const format of ['png', 'jpeg']) observedTest(`${locale}: ${format} sidecar describes the saved LUT and crop version without changing original or history`, async ({ page, browserName }) => {
		observedTest.skip(browserName === 'webkit', 'The roadmap defers native WebKit Blob/OPFS catalog workflows.'); observedTest.setTimeout(90_000);
		const f = await developed(page, locale), downloads = []; page.on('download', download => { downloads.push(download); });
		let dialog = await openExport(page, f, format), checkbox = dialog.locator('[data-photo-raster-export-sidecar]');
		await expect(checkbox).not.toBeChecked(); await save(page, dialog, format);
		await expect.poll(() => downloads.length).toBe(1); await assertImage(page, downloads[0], format, `Sidecar original.${format === 'png' ? 'png' : 'jpg'}`);
		await expect(dialog.locator('[data-photo-raster-export-sidecar-receipt]')).toHaveCount(0);
		await closeExport(page, dialog, format); expect(await observe(page, f.photoId)).toEqual(f.before);
		dialog = await openExport(page, f, format); checkbox = dialog.locator('[data-photo-raster-export-sidecar]');
		await expect(checkbox).not.toBeChecked(); await checkbox.focus(); await expect(checkbox).toBeFocused(); await page.keyboard.press('Space'); await expect(checkbox).toBeChecked();
		await dialog.locator('[data-photo-raster-export-filename-template]').fill('Chosen {name}-{index:2}');
		await save(page, dialog, format); await expect.poll(() => downloads.length).toBe(3);
		const name = `Chosen Sidecar original-01.${format === 'png' ? 'png' : 'jpg'}`;
		await assertImage(page, downloads[1], format, name); await assertSidecar(page, downloads[2], name, f.before);
		await expect(dialog.locator('[data-photo-raster-export-sidecar-receipt]')).toContainText(`${name}.lightscaper.json`);
		await expect(dialog.locator('[data-photo-raster-export-sidecar-partial]')).toHaveCount(0);
		await closeExport(page, dialog, format); expect(await observe(page, f.photoId)).toEqual(f.before);
		await page.reload(); await expect(f.app).toBeVisible(); await menu(page, f.app, f.copy.photoViewMenu); await keyboard(page, named(f.app, 'button', f.copy.photoShowLibrary));
		const card = f.app.locator('[data-photo-library] [data-photo-id]'); await expect(card).toHaveCount(1);
		await expect(f.app.locator('[data-photo-library]')).toHaveAttribute('aria-busy', 'false'); await keyboard(page, card);
		dialog = await openExport(page, f, format); checkbox = dialog.locator('[data-photo-raster-export-sidecar]');
		await expect(checkbox).not.toBeChecked(); await checkbox.focus(); await page.keyboard.press('Space'); await expect(checkbox).toBeChecked();
		await save(page, dialog, format); await expect.poll(() => downloads.length).toBe(5);
		const reloadedName = `Sidecar original.${format === 'png' ? 'png' : 'jpg'}`;
		await assertImage(page, downloads[3], format, reloadedName); await assertSidecar(page, downloads[4], reloadedName, f.before);
		await closeExport(page, dialog, format); expect(await observe(page, f.photoId)).toEqual(f.before); expect(f.errors).toEqual([]);
	});
}

observedTest('en: JSON anchor refusal preserves image acknowledgment and retries only the sidecar', async ({ page, browserName }) => {
	observedTest.skip(browserName === 'webkit', 'The roadmap defers native WebKit Blob/OPFS catalog workflows.'); observedTest.setTimeout(90_000);
	const f = await developed(page, 'en'), downloads = []; page.on('download', download => { downloads.push(download); });
	const dialog = await openExport(page, f, 'png'), checkbox = dialog.locator('[data-photo-raster-export-sidecar]');
	await checkbox.focus(); await expect(checkbox).toBeFocused(); await page.keyboard.press('Space'); await expect(checkbox).toBeChecked();
	await page.evaluate(() => { globalThis.__sidecarDownloadObservation.failNextJson = true; });
	await keyboard(page, dialog.locator('[data-photo-png-export-save]'));
	await expect(dialog.locator('[data-photo-png-export-receipt]')).toHaveAttribute('data-photo-png-export-status', 'download-started');
	await expect(dialog.locator('[data-photo-raster-export-sidecar-partial]')).toBeVisible();
	const retry = dialog.locator('[data-photo-raster-export-sidecar-retry]'); await expect(retry).toBeEnabled();
	await expect(dialog.locator('[data-photo-png-export-save]')).toBeDisabled(); await expect.poll(() => downloads.length).toBe(1);
	await assertImage(page, downloads[0], 'png', 'Sidecar original.png'); expect(await observe(page, f.photoId)).toEqual(f.before);
	await keyboard(page, retry); await expect(dialog.locator('[data-photo-raster-export-sidecar-receipt]')).toBeVisible();
	await expect(dialog.locator('[data-photo-raster-export-sidecar-partial]')).toHaveCount(0);
	await expect(dialog.locator('[data-photo-png-export-save]')).toBeEnabled(); await expect.poll(() => downloads.length).toBe(2);
	await assertSidecar(page, downloads[1], downloads[0].suggestedFilename(), f.before);
	expect(await page.evaluate(() => globalThis.__sidecarDownloadObservation.anchors)).toEqual([
		{ name: 'Sidecar original.png', type: 'image/png', refused: false },
		{ name: 'Sidecar original.png.lightscaper.json', type: 'application/json', refused: true },
		{ name: 'Sidecar original.png.lightscaper.json', type: 'application/json', refused: false },
	]);
	await closeExport(page, dialog, 'png'); expect(await observe(page, f.photoId)).toEqual(f.before); expect(f.errors).toEqual([]);
});

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
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: SOURCE_NAME, mimeType: 'image/png', buffer: PNG });
	await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
	const library = app.locator('[data-photo-library]'), card = library.locator('[data-photo-id]');
	await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false'); const photoId = await card.getAttribute('data-photo-id');
	await keyboard(page, card); await menu(page, app, copy.photoFileMenu); await menu(page, app, copy.photoPhotoMenu);
	await keyboard(page, named(app, 'button', photoDevelopMenuLabel(locale)));
	const dialog = named(page, 'dialog', `${messages.title}: ${SOURCE_NAME}`);
	await expect(named(dialog, 'region', messages.preview)).toHaveAttribute('data-state', 'ready');
	await choose(page, named(dialog, 'combobox', messages.choose), 'cube-lut-profile-v1'); await keyboard(page, named(dialog, 'button', messages.add));
	await dialog.getByLabel(messages.shared.videoEffectCubeLutImport, { exact: true }).setInputFiles({ name: 'Quarter red.cube', mimeType: 'text/plain', buffer: CUBE });
	await choose(page, named(dialog, 'combobox', messages.choose), 'develop-geometry-v1'); await keyboard(page, named(dialog, 'button', messages.add));
	const crop = named(dialog, 'spinbutton', `${messages.shared.videoEffectExactValue}: ${messages.shared.videoEffectParamCropWidth}`); await crop.fill('0.5'); await crop.press('Enter');
	const after = named(dialog, 'img', messages.after); await expect.poll(() => after.evaluate(canvas => [canvas.width, canvas.height])).toEqual([1, 2]);
	await expect.poll(() => after.evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, 1, 2).data))).toEqual(PIXELS);
	await keyboard(page, named(dialog, 'button', messages.save)); await expect(dialog.locator('[data-photo-develop-ack]')).toBeVisible();
	await expect(named(dialog, 'button', messages.cancel).last()).toBeDisabled(); await keyboard(page, named(dialog, 'button', messages.close).last()); await expect(dialog).toHaveCount(0);
	const before = await observe(page, photoId), photo = before.photos[0].photo, version = photo.versions.find(item => item.id === photo.activeVersionId);
	expect(before.photos[0].bytes).toEqual([...PNG]); expect(photo.original.name).toBe(SOURCE_NAME); expect(photo.original.byteLength).toBe(PNG.length);
	expect(photo.original.contentSha256).toBe(createHash('sha256').update(PNG).digest('hex')); expect(photo.schemaVersion).toBe(2); expect(version.develop.processVersion).toBe(2);
	expect(version.develop.effects.map(effect => [effect.type, effect.enabled])).toEqual([['cube-lut-profile-v1', true], ['develop-geometry-v1', true]]);
	expect(version.develop.effects[0].params.lut).toMatchObject({ sha256: createHash('sha256').update(CUBE).digest('hex'), byteLength: CUBE.length, size: 2 });
	expect(version.develop.effects[1].params.cropWidth).toBe(0.5); expect(photo.extractedMetadata.exif.cameraMake).toBe(CAMERA);
	return { app, copy, photoId, before, errors };
}

async function assertSidecar(page, download, rasterName, before) {
	expect(download.suggestedFilename()).toBe(`${rasterName}.lightscaper.json`); await assertMime(page, download, 'application/json');
	const bytes = await readFile(await download.path()); expect(bytes.length).toBeGreaterThan(0); expect(bytes.length).toBeLessThanOrEqual(2_097_152);
	const value = JSON.parse(bytes.toString('utf8')), photo = before.photos[0].photo, selected = photo.versions.find(version => version.id === photo.activeVersionId);
	// Explicit facts from the real resident owner, not an application serializer or renderer as oracle.
	expect(value).toEqual({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-export-sidecar', photoSchemaVersion: photo.schemaVersion,
		binding: { catalogId: before.root.id, photoId: photo.id, revision: photo.revision, activeVersionId: photo.activeVersionId },
		original: { fileName: SOURCE_NAME, contentSha256: createHash('sha256').update(PNG).digest('hex'), byteLength: PNG.length },
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
async function save(page, dialog, format) {
	await keyboard(page, dialog.locator(`[data-photo-${format}-export-save]`));
	await expect(dialog.locator(`[data-photo-${format}-export-receipt]`)).toHaveAttribute(`data-photo-${format}-export-status`, 'download-started');
	await expect(dialog.locator(`[data-photo-${format}-export-save]`)).toBeEnabled(); await expect(dialog.getByRole('alert')).toHaveCount(0);
}
async function openExport(page, f, format) {
	await menu(page, f.app, f.copy.photoFileMenu); await keyboard(page, f.app.locator(`[data-photo-${format}-export-menu]`));
	const dialog = page.getByRole('dialog').filter({ has: page.locator(`[data-photo-${format}-export-dialog]`) });
	await expect(dialog).toBeVisible(); await expect(dialog.locator(`[data-photo-${format}-export-save]`)).toBeFocused(); return dialog;
}
async function closeExport(page, dialog, format) { await keyboard(page, dialog.locator(`[data-photo-${format}-export-close]`)); await expect(dialog).toHaveCount(0); }
async function open(page, locale) {
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`); const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible(); return { app, copy: bundledLightscaperEditorCopyForLocale(locale) };
}
async function observe(page, photoId) {
	await installNativeOpfsWorkerCompanion(page);
	const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('../helpers/', import.meta.url)), contents: `export { readResidentPhotoLibraryCurrent } from './lightscaper-current-app-fixture.tsx';` }, bundle: true, write: false, format: 'esm', platform: 'browser' });
	await page.route('**/__raster_sidecar_observer.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
	const result = await page.evaluate(async id => (await import(new URL('/__raster_sidecar_observer.js', location.href).href)).readResidentPhotoLibraryCurrent([id], indexedDB, () => globalThis.__assertNativeOpfsWorkerExecution()), photoId);
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
