/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoDevelopSettingsCopy } from '../../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopRepairSpotsCopy } from '../../src/common/i18n/lightscaper-develop-repair-spots-copy.ts';
import { photoPngExportCopy } from '../../src/common/i18n/lightscaper-photo-png-export-copy.ts';
import { photoJpegExportCopy } from '../../src/common/i18n/lightscaper-photo-jpeg-export-copy.ts';
import { photoPngExportMenuLabel } from '../../src/common/i18n/lightscaper-photo-png-export-menu-copy.ts';
import { photoJpegExportMenuLabel } from '../../src/common/i18n/lightscaper-photo-jpeg-export-menu-copy.ts';
import { photoBatchExportCopy } from '../../src/common/i18n/lightscaper-photo-batch-export-copy.ts';
import { photoBatchExportMenuCopy } from '../../src/common/i18n/lightscaper-photo-batch-export-menu-copy.ts';
import { pngChunk, numberEntry, textEntry, tiffFixture } from '../helpers/image-metadata-fixtures.ts';
import { decodePinnedJpegRgbFrame } from './helpers/pinned-video-frame-decoder.mjs';
import { repairOriginalReferencePixelsV1 } from './helpers/lightscaper-repair-spots-reference.ts';
import { expect, test, installNativeImageHandoffRuntime, compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';

const NAME = 'Repair export.png', CAMERA = 'Repair export camera', PROGRAM = '/__repair_export_custody.js';
const ORIGINAL = repairOriginalReferencePixelsV1(), CLONE = [90, 90, 90, 255, 90, 90, 90, 255];
// Independent Heal solution (.25,.75), crop its two targets, flip, then +1EV:
// linear (.75,.25) -> (1,.5) -> encoded gray (255,188).
const HEAL = [255, 255, 255, 255, 188, 188, 188, 255];

for (const locale of ['en', 'de']) for (const format of ['png', 'jpeg']) test(`${locale}: Current ${format} exports Clone and Heal before crop/flip/exposure, with Sidecar2 and unchanged Original`, async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'Native WebKit storage qualification remains deferred.');
	test.setTimeout(150000); runShape();
	const f = await fixture(page, locale), downloads = []; page.on('download', download => { downloads.push(download); });
	await f.openDevelop(); await f.repair('clone'); await f.geometryAndExposure(); await f.painted(CLONE); await f.saveDevelop();
	await f.closeDevelop(); const cloned = await f.observe(); expect(active(cloned.photos[0].photo).develop.processVersion).toBe(3);
	let dialog = await f.openExport(format), words = format === 'png' ? photoPngExportCopy(locale) : photoJpegExportCopy(locale);
	await expect(named(dialog, 'checkbox', words.sidecar)).not.toBeChecked();
	await f.saveExport(dialog, words); await expect.poll(() => downloads.length).toBe(1);
	await image(downloads[0], format, CLONE); await f.closeExport(dialog, words); expect(await f.observe()).toEqual(cloned);
	await f.openDevelop(); await f.repair('heal'); await f.painted(HEAL); await f.saveDevelop(); await f.closeDevelop();
	const healed = await f.observe(); await f.immutable(healed); const photo = healed.photos[0].photo;
	expect(active(photo).develop.repairs.spots[0].mode).toBe('heal');
	dialog = await f.openExport(format); await checkbox(page, named(dialog, 'checkbox', words.sidecar));
	await named(dialog, 'combobox', words.metadata).selectOption('capture');
	await named(dialog, 'textbox', words.filenameTemplate).fill('Chosen-{name}');
	await f.saveExport(dialog, words); await expect.poll(() => downloads.length).toBe(3);
	await image(downloads[1], format, HEAL, true); await sidecar(downloads[2], downloads[1].suggestedFilename(), photo);
	await expect(dialog.getByRole('status').filter({ hasText: words.sidecarSaved.replace('{name}', downloads[2].suggestedFilename()) })).toBeVisible();
	await f.closeExport(dialog, words); expect(await f.observe()).toEqual(healed);
	await page.reload(); await expect(f.app).toBeVisible(); await f.showLibrary(); await f.select();
	dialog = await f.openExport(format); await expect(named(dialog, 'checkbox', words.sidecar)).not.toBeChecked();
	await checkbox(page, named(dialog, 'checkbox', words.sidecar)); await f.saveExport(dialog, words);
	await expect.poll(() => downloads.length).toBe(5); await image(downloads[3], format, HEAL);
	await sidecar(downloads[4], downloads[3].suggestedFilename(), photo); await f.closeExport(dialog, words);
	expect(await f.observe()).toEqual(healed); expect(f.errors).toEqual([]);
});

test('en: Current repaired raster acknowledgement survives JSON refusal and only JSON is retried', async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'Native WebKit storage qualification remains deferred.'); test.setTimeout(90000); runShape();
	const f = await fixture(page, 'en'), downloads = []; page.on('download', download => { downloads.push(download); });
	await f.openDevelop(); await f.repair('heal'); await f.geometryAndExposure(); await f.painted(HEAL); await f.saveDevelop(); await f.closeDevelop();
	const before = await f.observe(), words = photoPngExportCopy('en'), dialog = await f.openExport('png');
	await checkbox(page, named(dialog, 'checkbox', words.sidecar));
	await page.evaluate(() => { globalThis.__repairExportDownloads.failNextJson = true; });
	await keyboard(page, named(dialog, 'button', words.save));
	await expect(dialog.locator('[data-photo-png-export-receipt]')).toHaveAttribute('data-photo-png-export-status', 'download-started');
	await expect(dialog.getByText(words.sidecarPartial, { exact: true })).toBeVisible(); await expect.poll(() => downloads.length).toBe(1);
	await expect(named(dialog, 'button', words.save)).toBeDisabled(); await image(downloads[0], 'png', HEAL);
	await keyboard(page, named(dialog, 'button', words.sidecarRetry)); await expect.poll(() => downloads.length).toBe(2);
	await sidecar(downloads[1], downloads[0].suggestedFilename(), before.photos[0].photo);
	expect(await page.evaluate(() => globalThis.__repairExportDownloads.anchors)).toEqual([
		{ name: NAME, type: 'image/png', refused: false }, { name: `${NAME}.lightscaper.json`, type: 'application/json', refused: true },
		{ name: `${NAME}.lightscaper.json`, type: 'application/json', refused: false },
	]);
	await f.closeExport(dialog, words); expect(await f.observe()).toEqual(before); await f.immutable(before); expect(f.errors).toEqual([]);
});

for (const locale of ['en', 'de']) test(`${locale}: Current repaired PNG batch retains image acknowledgements across reopen and reviewed JSON-only recovery`, async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'Native WebKit storage qualification remains deferred.'); test.setTimeout(150000); runShape();
	const f = await fixture(page, locale, true), downloads = []; page.on('download', download => { downloads.push(download); });
	for (const name of f.names) { await f.select(name); await f.openDevelop(); await f.repair('heal'); await f.geometryAndExposure(); await f.painted(HEAL); await f.saveDevelop(); await f.closeDevelop(); }
	const before = await f.observe(), words = photoBatchExportCopy(locale), settings = photoPngExportCopy(locale);
	await f.menu(f.copy.photoFileMenu); await f.menu(f.copy.photoPhotoMenu); await keyboard(page, named(f.app, 'button', f.copy.photoSelectAll));
	await f.menu(f.copy.photoFileMenu); await keyboard(page, named(f.app, 'button', photoBatchExportMenuCopy(locale).downloadSelected));
	let dialog = named(page, 'dialog', words.title); await expect(dialog).toBeVisible();
	await expect(named(dialog, 'button', words.start)).toBeEnabled(); await expect(named(dialog, 'checkbox', settings.sidecar)).not.toBeChecked();
	await checkbox(page, named(dialog, 'checkbox', settings.sidecar)); await page.evaluate(() => { globalThis.__repairExportDownloads.failNextJson = true; });
	await keyboard(page, named(dialog, 'button', words.start)); await expect.poll(() => downloads.length).toBe(3);
	await expect(dialog.locator('[data-photo-batch-export-receipt]')).toHaveAttribute('data-phase', 'settled');
	const images = downloads.filter(download => download.suggestedFilename().endsWith('.png')); expect(images).toHaveLength(2);
	for (const download of images) await image(download, 'png', HEAL);
	const missing = images.find(download => !downloads.some(other => other.suggestedFilename() === `${download.suggestedFilename()}.lightscaper.json`)); expect(missing).toBeTruthy();
	expect(await f.observe()).toEqual(before); await keyboard(page, named(dialog, 'button', words.hide)); await expect(dialog).toHaveCount(0);
	await page.reload(); await expect(f.app).toBeVisible(); await f.showLibrary();
	await f.menu(f.copy.photoFileMenu); await keyboard(page, named(f.app, 'button', photoBatchExportMenuCopy(locale).queue)); dialog = named(page, 'dialog', words.title);
	await expect(dialog).toBeVisible(); await expect(named(dialog, 'button', words.continue)).toBeDisabled();
	await expect(dialog.locator('[data-journal-state="needs-review"]')).toHaveCount(1);
	await checkbox(page, named(dialog, 'checkbox', words.review.replace('{name}', missing.suggestedFilename())));
	await keyboard(page, named(dialog, 'button', words.continue)); await expect.poll(() => downloads.length).toBe(4);
	await expect(dialog.locator('[data-photo-batch-export-receipt]')).toHaveAttribute('data-phase', 'settled');
	expect(downloads[3].suggestedFilename()).toBe(`${missing.suggestedFilename()}.lightscaper.json`);
	for (const download of downloads.filter(download => download.suggestedFilename().endsWith('.json'))) {
		const value = JSON.parse((await readFile(await download.path())).toString('utf8')), photo = before.photos.find(row => row.photo.id === value.binding.photoId)?.photo; expect(photo).toBeTruthy();
		await sidecar(download, download.suggestedFilename().replace(/\.lightscaper\.json$/u, ''), photo);
	}
	expect(downloads.filter(download => download.suggestedFilename().endsWith('.png'))).toHaveLength(2); expect(await f.observe()).toEqual(before);
	await keyboard(page, named(dialog, 'button', words.hide)); await page.reload(); await expect(f.app).toBeVisible();
	await f.menu(f.copy.photoFileMenu); await keyboard(page, named(f.app, 'button', photoBatchExportMenuCopy(locale).queue)); dialog = named(page, 'dialog', words.title);
	await expect(dialog.locator('[data-journal-state="already-committed"]')).toHaveCount(2); await expect(named(dialog, 'button', words.continue)).toBeDisabled();
	expect(downloads).toHaveLength(4); expect(await f.observe()).toEqual(before); expect(f.errors).toEqual([]);
});

async function fixture(page, locale, withSecond = false) {
	await installNativeImageHandoffRuntime(page); await observeDownloads(page);
	const program = await compileNativeImageHandoffScript('repair-export-custody.js', fileURLToPath(new URL('./helpers/lightscaper-repair-export-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]); await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	const errors = []; page.on('pageerror', error => { errors.push(error.message); });
	const copy = bundledLightscaperEditorCopyForLocale(locale), words = photoDevelopCopy(locale), repairs = photoDevelopRepairSpotsCopy(locale), settings = photoDevelopSettingsCopy(locale, 'current3');
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`); const app = named(page, 'region', 'Lightscaper'); await expect(app).toBeVisible();
	await expect(page.getByRole('dialog')).toHaveCount(0); await menu(copy.photoFileMenu); await keyboard(page, named(app, 'button', copy.photoImportPhotos));
	const importer = named(page, 'dialog', copy.photoImportPhotos), names = withSecond ? [NAME, 'Second repair.png'] : [NAME], pngs = names.map((_, index) => originalPng(index));
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles(names.map((name, index) => ({ name, mimeType: 'image/png', buffer: pngs[index] })));
	await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
	const cards = names.map(name => app.getByRole('button', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u') })); await keyboard(page, cards[0]);
	const ids = []; for (const card of cards) { const id = await card.getAttribute('data-photo-id'); expect(id).toBeTruthy(); ids.push(id); } const initial = await observe();
	for (const [index, row] of initial.photos.entries()) expect(row.original.sha256).toBe(createHash('sha256').update(pngs[index]).digest('hex'));
	expect(initial.photos[0].photo.extractedMetadata.exif.cameraMake).toBe(CAMERA);
	let develop = named(page, 'dialog', `${words.title}: ${NAME}`);
	return { app, copy, words, ids, names, initial, errors, observe, menu, openDevelop, closeDevelop, repair, geometryAndExposure, painted, saveDevelop, openExport, saveExport, closeExport, immutable,
		showLibrary: async () => { await menu(copy.photoViewMenu); await keyboard(page, named(app, 'button', copy.photoShowLibrary)); },
		select: async (name = NAME) => { await keyboard(page, cards[names.indexOf(name)]); develop = named(page, 'dialog', `${words.title}: ${name}`); } };
	async function menu(label) { await keyboard(page, app.getByRole('navigation').getByText(label, { exact: true })); }
	async function openDevelop() { await menu(copy.photoFileMenu); await menu(copy.photoPhotoMenu); await keyboard(page, named(app, 'button', photoDevelopMenuLabel(locale))); await expect(develop).toBeVisible();
		await expect(develop.locator('[data-photo-develop-preview]')).toHaveAttribute('data-state', 'ready'); }
	async function closeDevelop() { await keyboard(page, named(develop, 'button', words.close).last()); await expect(develop).toHaveCount(0); }
	async function repair(mode) {
		const summary = develop.getByText(settings.menu, { exact: true }); if (!await summary.locator('..').evaluate(details => details.open)) await keyboard(page, summary);
		await keyboard(page, named(develop, 'button', repairs.menu)); const dialog = named(page, 'dialog', repairs.title); await expect(dialog).toBeVisible();
		await expect(dialog.locator('[data-photo-repair-original]')).toHaveAttribute('data-state', 'ready');
		await named(dialog, 'combobox', repairs.mode).selectOption(mode);
		if (await named(dialog, 'combobox', repairs.spot).inputValue() === '') {
			for (const [key, value] of Object.entries({ targetX: .7, targetY: .5, sourceX: .2, sourceY: .5, radius: .15, feather: 0, opacity: 1 })) await named(dialog, 'spinbutton', repairs[key]).fill(String(value));
			await keyboard(page, named(dialog, 'button', repairs.add));
		}
		await keyboard(page, named(dialog, 'button', repairs.apply)); await expect(dialog).toHaveCount(0);
	}
	async function geometryAndExposure() {
		await named(develop, 'combobox', words.choose).selectOption('develop-geometry-v1'); await keyboard(page, named(develop, 'button', words.add));
		for (const [key, value] of [['CropWidth', '.2'], ['CropHeight', '.2'], ['CropX', '.6'], ['CropY', '.4']]) {
			const input = named(develop, 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared[`videoEffectParam${key}`]}`); await input.fill(value); await input.press('Enter');
		}
		await named(develop, 'combobox', `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectParamFlipHorizontal}`).selectOption('1');
		await named(develop, 'combobox', words.choose).selectOption('tone-ladder-v1'); await keyboard(page, named(develop, 'button', words.add));
		const exposure = named(develop, 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectParamExposure}`); await exposure.fill('1'); await exposure.press('Enter');
	}
	async function painted(expected) { await expect(develop.locator('[data-photo-develop-preview]')).toHaveAttribute('data-state', 'ready');
		await expect.poll(() => named(develop, 'img', words.after).evaluate(canvas => [canvas.width, canvas.height, ...canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data])).toEqual([2, 1, ...expected]); }
	async function saveDevelop() { await keyboard(page, named(develop, 'button', words.save)); await expect(develop.locator('[data-photo-develop-ack]')).toBeVisible(); await expect(named(develop, 'button', words.save)).toBeDisabled(); }
	async function openExport(format) { await menu(copy.photoFileMenu); await keyboard(page, named(app, 'button', format === 'png' ? photoPngExportMenuLabel(locale) : photoJpegExportMenuLabel(locale)));
		const dialog = named(page, 'dialog', (format === 'png' ? photoPngExportCopy(locale) : photoJpegExportCopy(locale)).title); await expect(dialog).toBeVisible();
		await expect(named(dialog, 'button', (format === 'png' ? photoPngExportCopy(locale) : photoJpegExportCopy(locale)).save)).toBeEnabled(); return dialog; }
	async function saveExport(dialog, copy) { await keyboard(page, named(dialog, 'button', copy.save));
		await expect(dialog.getByRole('status').filter({ hasText: '×' })).toBeVisible(); await expect(named(dialog, 'button', copy.save)).toBeEnabled(); await expect(dialog.getByRole('alert')).toHaveCount(0); }
	async function closeExport(dialog, copy) { await keyboard(page, named(dialog, 'button', copy.close).last()); await expect(dialog).toHaveCount(0); }
	function observe() { return page.evaluate(async ({ pathname, ids }) => (await import(new URL(pathname, location.href).href))
		.readRepairExportCustodyNativeV1(ids, () => globalThis.__assertNativeOpfsWorkerExecution()), { pathname: PROGRAM, ids }); }
	async function immutable(value) { expect(value.namespace).toBe(initial.namespace);
		for (const [index, row] of value.photos.entries()) { expect(row.original).toEqual(initial.photos[index].original); expect(row.photo.original).toEqual(initial.photos[index].photo.original); } }
}

async function image(download, format, pixels, capture = false) {
	const bytes = await readFile(await download.path()); expect(bytes.length).toBeLessThanOrEqual(1024 * 1024);
	if (format === 'jpeg') {
		const decoded = await decodePinnedJpegRgbFrame(bytes); expect([decoded.width, decoded.height]).toEqual([2, 1]);
		for (let index = 0; index < decoded.rgb.length; index++) expect(Math.abs(decoded.rgb[index] - pixels[Math.floor(index / 3) * 4 + index % 3])).toBeLessThanOrEqual(8);
	} else {
		expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]); const compressed = []; let offset = 8;
		while (offset < bytes.length) {
			expect(offset + 12).toBeLessThanOrEqual(bytes.length); const size = bytes.readUInt32BE(offset), end = offset + size + 12; expect(end).toBeLessThanOrEqual(bytes.length);
			const type = bytes.toString('ascii', offset + 4, offset + 8), data = bytes.subarray(offset + 8, end - 4);
			expect(bytes.readUInt32BE(end - 4)).toBe(crc32(bytes.subarray(offset + 4, end - 4)));
			if (type === 'IHDR') expect([...data]).toEqual([0, 0, 0, 2, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
			else if (type === 'IDAT') compressed.push(data); else expect(capture ? ['sRGB', 'eXIf', 'IEND'] : ['sRGB', 'IEND']).toContain(type);
			offset = end;
		}
		expect(offset).toBe(bytes.length); expect([...inflateSync(Buffer.concat(compressed))]).toEqual([0, ...pixels]);
	}
	expect(bytes.includes(Buffer.from(CAMERA))).toBe(capture);
}
async function sidecar(download, imageName, photo) {
	expect(download.suggestedFilename()).toBe(`${imageName}.lightscaper.json`); const bytes = await readFile(await download.path()); expect(bytes.length).toBeLessThanOrEqual(2097152);
	const version = active(photo); expect(JSON.parse(bytes.toString('utf8'))).toEqual({ schemaFamily: 'lightscaper', schemaVersion: 2, kind: 'photo-export-sidecar', photoSchemaVersion: 3,
		binding: { catalogId: photo.catalogId, photoId: photo.id, revision: photo.revision, activeVersionId: photo.activeVersionId },
		original: { fileName: photo.original.name, contentSha256: photo.original.contentSha256, byteLength: photo.original.byteLength },
		version: { id: version.id, kind: version.kind, name: version.name, createdAt: version.createdAt, develop: version.develop }, metadata: photo.metadata, extractedMetadata: photo.extractedMetadata });
}
async function observeDownloads(page) {
	await page.addInitScript(() => {
		Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
		const create = URL.createObjectURL, click = HTMLAnchorElement.prototype.click, blobType = Object.getOwnPropertyDescriptor(Blob.prototype, 'type').get;
		const state = { urls: [], anchors: [], failNextJson: false }; Object.defineProperty(globalThis, '__repairExportDownloads', { value: state });
		Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: function (...args) {
			const url = Reflect.apply(create, this, args); if (args[0] instanceof Blob) state.urls.push({ url, type: Reflect.apply(blobType, args[0], []) }); return url;
		} });
		Object.defineProperty(HTMLAnchorElement.prototype, 'click', { configurable: true, writable: true, value: function (...args) {
			const type = state.urls.find(row => row.url === this.href)?.type;
			if (this.download && type) { const refused = type === 'application/json' && state.failNextJson; state.anchors.push({ name: this.download, type, refused });
				if (refused) { state.failNextJson = false; throw Error('Current repair sidecar delivery refused.'); } }
			return Reflect.apply(click, this, args);
		} });
	});
}
function originalPng(index = 0) {
	const header = Buffer.from([0, 0, 0, 10, 0, 0, 0, 5, 8, 6, 0, 0, 0]);
	const pixels = ORIGINAL.slice(); if (index) pixels.fill(10, 0, 3);
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('sRGB', Buffer.from([0])),
		pngChunk('eXIf', tiffFixture([numberEntry(0x0112, 1), textEntry(0x010f, CAMERA)], [numberEntry(0xa001, 1)])),
		pngChunk('IDAT', deflateSync(Buffer.from(Array.from({ length: 5 }, (_, y) => [0, ...pixels.slice(y * 40, (y + 1) * 40)]).flat()))), pngChunk('IEND', Buffer.alloc(0))]);
}
function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
function active(photo) { const value = photo.versions.find(version => version.id === photo.activeVersionId); expect(value).toBeTruthy(); return value; }
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
async function checkbox(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Space'); }
function runShape() { expect(test.info().config.workers).toBe(1); expect(test.info().retry).toBe(0); expect(test.info().project.retries).toBe(0); }
