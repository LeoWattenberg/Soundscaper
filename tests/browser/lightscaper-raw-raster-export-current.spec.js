/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { bundledSiteCopyForLocale } from '../../src/common/i18n/site-copy.js';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoDevelopSettingsCopy } from '../../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopRepairSpotsCopy } from '../../src/common/i18n/lightscaper-develop-repair-spots-copy.ts';
import { photoPngExportCopy } from '../../src/common/i18n/lightscaper-photo-png-export-copy.ts';
import { photoJpegExportCopy } from '../../src/common/i18n/lightscaper-photo-jpeg-export-copy.ts';
import { photoPngExportMenuLabel } from '../../src/common/i18n/lightscaper-photo-png-export-menu-copy.ts';
import { photoJpegExportMenuLabel } from '../../src/common/i18n/lightscaper-photo-jpeg-export-menu-copy.ts';
import { photoExportPresetsCopy } from '../../src/common/i18n/lightscaper-photo-export-presets-copy.ts';
import { photoRasterDepthCopy } from '../../src/common/i18n/lightscaper-photo-raster-depth-copy.ts';
import { rawDngFixtureV1 } from '../helpers/lightscaper-raw-dng-current-fixture.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';

test.use({ browserCoverage: false });
const PROGRAM = '/__lightscaper_raw_raster_custody.js', NAME = 'Native raster precision.dng', locale = 'en';
let program, wasm, manifest;
test.beforeAll(async () => {
	manifest = JSON.parse(await readFile(new URL('../../config/lightscaper-libraw-runtime-manifest.json', import.meta.url), 'utf8'));
	wasm = await readFile(new URL(`../../${manifest.runtime.path}`, import.meta.url));
	expect(wasm.length).toBe(manifest.runtime.byteLength); expect(createHash('sha256').update(wasm).digest('hex')).toBe(manifest.runtime.sha256);
	program = await compileNativeImageHandoffScript('raw-raster-custody.js', fileURLToPath(new URL('./helpers/lightscaper-raw-import-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});

test('real RAW Clone and linear Develop export exact PNG8/16, retained depth preset and native JPEG without changing Original', async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'This bounded native RAW export workflow qualifies Chromium and Firefox.'); test.setTimeout(180_000);
	const copy = bundledLightscaperEditorCopyForLocale(locale), develop = photoDevelopCopy(locale), settings = photoDevelopSettingsCopy(locale, 'current3');
	const repairs = photoDevelopRepairSpotsCopy(locale), png = photoPngExportCopy(locale), jpeg = photoJpegExportCopy(locale);
	const presets = photoExportPresetsCopy(locale), depth = photoRasterDepthCopy(locale), errors = [], workers = [], downloads = [], assetRequests = [];
	const originalBytes = Buffer.from(rawDngFixtureV1().bytes), digest = createHash('sha256').update(originalBytes).digest('hex');
	page.on('pageerror', error => { errors.push(error.message); }); page.on('download', download => { downloads.push(download); });
	page.on('worker', worker => { if (new URL(worker.url()).pathname.includes('libraw-worker-v1')) workers.push(worker.url()); });
	page.on('request', request => { if (request.url() === manifest.runtime.url) assetRequests.push(request.url()); });
	// Exercise actual fallback downloads, not a substituted save port. The app's
	// native catalog, Original session, bundled Worker and decoder stay intact.
	await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
	await page.route(manifest.runtime.url, route => route.fulfill({ status: 200, headers: {
		'content-type': 'application/wasm', 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin',
	}, body: wasm }));
	await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	await page.goto(resolveBrowserProductTestUrl('/lightscaper/en/'));
	const app = named(page, 'region', 'Lightscaper'); await expect(app).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(copy.photoFileMenu); await keyboard(named(app, 'button', copy.photoImportPhotos));
	const importer = named(page, 'dialog', copy.photoImportPhotos);
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: NAME, mimeType: 'image/png', buffer: originalBytes });
	await keyboard(named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
	const library = named(app, 'region', bundledSiteCopyForLocale(locale).workspacePhoto), card = app.getByRole('button', { name: /^Native raster precision\.dng/u });
	await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false'); await keyboard(card);
	const photoId = await card.getAttribute('data-photo-id'); expect(photoId).toBeTruthy();
	const initial = await observe(); immutable(initial);
	expect(initial.native.descriptor).toEqual({ schemaVersion: 1, width: 32, height: 32, sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' });
	expect(initial.native.rawFlip).toBe(0); expect(initial.native.words).toHaveLength(4096);
	const expected = rasterOracle(initial.native.words);

	await menu(copy.photoFileMenu); await menu(copy.photoPhotoMenu); await keyboard(named(app, 'button', photoDevelopMenuLabel(locale)));
	const editing = named(page, 'dialog', `${develop.title}: ${NAME}`), preview = editing.locator('[data-photo-develop-preview]');
	await expect(preview).toHaveAttribute('data-state', 'ready');
	const summary = editing.getByText(settings.menu, { exact: true });
	if (!await summary.locator('..').evaluate(details => details.open)) await keyboard(summary);
	await keyboard(named(editing, 'button', repairs.menu)); const repair = named(page, 'dialog', repairs.title);
	await expect(named(repair, 'img', repairs.original)).toHaveAttribute('data-state', 'ready');
	await named(repair, 'combobox', repairs.mode).selectOption('clone');
	for (const [field, value] of Object.entries({ targetX: .765625, targetY: .640625, sourceX: .265625, sourceY: .640625, radius: .01, feather: 0, opacity: 1 })) {
		await named(repair, 'spinbutton', repairs[field]).fill(String(value));
	}
	await keyboard(named(repair, 'button', repairs.add)); await keyboard(named(repair, 'button', repairs.apply)); await expect(repair).toHaveCount(0);
	await add('white-balance-v1'); await number('videoEffectParamTemperature', '100');
	await add('tone-ladder-v1'); await number('videoEffectParamExposure', '-1');
	await expect(preview).toHaveAttribute('data-state', 'ready');
	await expect.poll(() => plane(named(editing, 'img', develop.after))).toEqual([32, 32, ...expected.byte]);
	expect(await observe()).toEqual(initial);
	await keyboard(named(editing, 'button', develop.save)); await expect(editing.locator('[data-photo-develop-ack]')).toBeVisible();
	await expect(named(editing, 'button', develop.save)).toBeDisabled();
	const saved = await observe(); immutable(saved); expect(saved.photo.schemaVersion).toBe(3); expect(saved.photo.revision).toBe(initial.photo.revision + 1);
	expect(saved.original).toEqual(initial.original); expect(saved.photo.original).toEqual(initial.photo.original); expect(saved.native).toEqual(initial.native);
	const version = saved.photo.versions.find(value => value.id === saved.photo.activeVersionId), recipe = version.develop;
	expect(recipe.processVersion).toBe(3); expect(recipe.repairs.spots).toHaveLength(1);
	expect(recipe.repairs.spots[0]).toMatchObject({ mode: 'clone', enabled: true, target: { x: .765625, y: .640625 }, source: { x: .265625, y: .640625 }, radius: .01, feather: 0, opacity: 1 });
	expect(recipe.effects.map(effect => effect.type)).toEqual(['white-balance-v1', 'tone-ladder-v1']);
	expect(recipe.effects[0].params.temperature).toBe(100); expect(recipe.effects[1].params.exposure).toBe(-1);
	await close(editing, develop);

	let output = await openExport('png'); await expect(named(output, 'combobox', depth.label)).toHaveValue('8');
	await expect(named(output, 'combobox', png.outputSize)).toHaveValue('original'); await expect(named(output, 'combobox', png.metadata)).toHaveValue('strip');
	await expect(named(output, 'checkbox', png.sidecar)).not.toBeChecked();
	await save(output, 'png', 1); const png8 = readPng(await downloaded(0));
	expect(png8).toEqual({ width: 32, height: 32, depth: 8, samples: expected.byte }); expect(await observe()).toEqual(saved);
	await close(output, png);

	output = await openExport('png'); await named(output, 'combobox', depth.label).selectOption('16');
	await named(output, 'combobox', png.outputSize).selectOption('percentage'); await named(output, 'spinbutton', png.percentage).fill('50');
	await named(output, 'combobox', png.resample).selectOption('nearest'); await checkbox(named(output, 'checkbox', png.sidecar));
	await presetFields(output); await named(output, 'textbox', presets.name).fill('Native RAW sixteen');
	await keyboard(named(output, 'button', presets.save)); await expect(output.locator('[data-photo-export-preset-message]')).toHaveText(presets.saved);
	const presetId = await named(output, 'combobox', presets.choose).inputValue(); expect(presetId).not.toBe('');
	await save(output, 'png', 3); const first16 = await downloaded(1), png16 = readPng(first16);
	expect(png16).toEqual({ width: 16, height: 16, depth: 16, samples: expected.wordHalf });
	// Both top-gray sensor plateaus occupy the same final byte bin, while
	// native-word output retains a real difference that a byte detour erases.
	const low = (4 * 16 + 4) * 4, high = (4 * 16 + 12) * 4;
	expect(png16.samples[high]).toBeGreaterThan(png16.samples[low]);
	expect(Math.round(png16.samples[high] / 257)).toBe(Math.round(png16.samples[low] / 257));
	expect(png16.samples.some((sample, index) => index % 4 !== 3 && sample % 257 !== 0)).toBe(true);
	const firstSidecar = await sidecar(2, downloads[1].suggestedFilename(), saved.photo); expect(await observe()).toEqual(saved);
	await close(output, png);

	await page.reload(); await expect(app).toBeVisible(); await menu(copy.photoViewMenu); await keyboard(named(app, 'button', copy.photoShowLibrary));
	await expect(card).toHaveCount(1); await keyboard(card); expect(await observe()).toEqual(saved);
	output = await openExport('png'); await expect(named(output, 'combobox', depth.label)).toHaveValue('8');
	await expect(named(output, 'combobox', png.outputSize)).toHaveValue('original'); await expect(named(output, 'checkbox', png.sidecar)).not.toBeChecked();
	await presetFields(output); await expect(named(output, 'combobox', presets.choose).locator('option', { hasText: 'Native RAW sixteen' })).toHaveCount(1);
	await named(output, 'combobox', presets.choose).selectOption(presetId); await keyboard(named(output, 'button', presets.apply));
	await expect(named(output, 'button', png.save)).toBeEnabled(); await expect(named(output, 'combobox', depth.label)).toHaveValue('16');
	await expect(named(output, 'combobox', png.outputSize)).toHaveValue('percentage'); await expect(named(output, 'spinbutton', png.percentage)).toHaveValue('50');
	await expect(named(output, 'combobox', png.resample)).toHaveValue('nearest'); await expect(named(output, 'combobox', png.metadata)).toHaveValue('strip');
	await expect(named(output, 'checkbox', png.sidecar)).toBeChecked(); await save(output, 'png', 5);
	expect(await downloaded(3)).toEqual(first16); expect(readPng(await downloaded(3))).toEqual(png16);
	expect(await sidecar(4, downloads[3].suggestedFilename(), saved.photo)).toEqual(firstSidecar);
	expect(await observe()).toEqual(saved); await close(output, png);

	output = await openExport('jpeg'); await expect(named(output, 'combobox', depth.label)).toHaveCount(0);
	await expect(named(output, 'combobox', jpeg.outputSize)).toHaveValue('original'); await expect(named(output, 'checkbox', jpeg.sidecar)).not.toBeChecked();
	await save(output, 'jpeg', 6); const jpegBytes = await downloaded(5);
	expect([...jpegBytes.subarray(0, 2)]).toEqual([255, 216]); expect([...jpegBytes.subarray(-2)]).toEqual([255, 217]);
	const decoded = await page.evaluate(async bytes => {
		const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
		try { const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
			return { width: image.width, height: image.height, pixels: [...context.getImageData(0, 0, image.width, image.height).data] }; }
		finally { image.close(); }
	}, [...jpegBytes]);
	expect([decoded.width, decoded.height]).toEqual([32, 32]); expect(decoded.pixels.filter((_, index) => index % 4 === 3).every(value => value === 255)).toBe(true);
	assertJpegInterior(decoded.pixels, expected.byte); expect(await observe()).toEqual(saved); await close(output, jpeg);
	expect(downloads.map(value => value.suggestedFilename())).toEqual([
		'Native raster precision.png', 'Native raster precision.png', 'Native raster precision.png.lightscaper.json',
		'Native raster precision.png', 'Native raster precision.png.lightscaper.json', 'Native raster precision.jpg',
	]);
	expect(workers.length).toBeGreaterThanOrEqual(3); expect(assetRequests.length).toBeGreaterThan(0);
	for (const url of workers) { expect(new URL(url).origin).toBe(new URL(page.url()).origin); expect(new URL(url).pathname).toMatch(/\/assets\/libraw-worker-v1-[^/]+\.js$/u); }
	expect(errors).toEqual([]);

	async function keyboard(control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
	async function menu(label) { await keyboard(app.getByRole('navigation').getByText(label, { exact: true })); }
	async function add(type) { await named(editing, 'combobox', develop.choose).selectOption(type); await keyboard(named(editing, 'button', develop.add)); }
	async function number(key, value) { const control = named(editing, 'spinbutton', `${develop.shared.videoEffectExactValue}: ${develop.shared[key]}`);
		await control.fill(value); await control.press('Enter'); await expect(control).toHaveValue(value); }
	async function close(dialog, words) { await keyboard(named(dialog, 'button', words.close).last()); await expect(dialog).toHaveCount(0); }
	async function openExport(format) { await menu(copy.photoFileMenu); await keyboard(named(app, 'button', format === 'png' ? photoPngExportMenuLabel(locale) : photoJpegExportMenuLabel(locale)));
		const words = format === 'png' ? png : jpeg, dialog = named(page, 'dialog', words.title); await expect(named(dialog, 'button', words.save)).toBeEnabled(); return dialog; }
	async function save(dialog, format, count) { const words = format === 'png' ? png : jpeg;
		await keyboard(named(dialog, 'button', words.save)); await expect(dialog.locator(`[data-photo-${format}-export-receipt]`)).toHaveAttribute(`data-photo-${format}-export-status`, 'download-started');
		await expect.poll(() => downloads.length).toBe(count); await expect(named(dialog, 'button', words.save)).toBeEnabled(); }
	async function checkbox(control) { await expect(control).not.toBeChecked(); await control.focus(); await page.keyboard.press('Space'); await expect(control).toBeChecked(); }
	async function presetFields(dialog) { const control = dialog.locator('summary').filter({ hasText: presets.title });
		if (await dialog.locator('[data-photo-export-presets]').getAttribute('open') === null) await keyboard(control);
		await expect(named(dialog, 'combobox', presets.choose)).toBeVisible(); }
	async function downloaded(index) { const download = downloads[index]; expect(await download.failure()).toBeNull(); return readFile(await download.path()); }
	async function sidecar(index, imageName, photo) {
		expect(downloads[index].suggestedFilename()).toBe(`${imageName}.lightscaper.json`); const bytes = await downloaded(index); expect(bytes.length).toBeLessThan(2_097_152);
		const value = JSON.parse(bytes.toString('utf8'));
		expect(value).toEqual({ schemaFamily: 'lightscaper', schemaVersion: 2, kind: 'photo-export-sidecar', photoSchemaVersion: 3,
			binding: { catalogId: photo.catalogId, photoId: photo.id, revision: photo.revision, activeVersionId: photo.activeVersionId },
			original: { fileName: photo.original.name, contentSha256: photo.original.contentSha256, byteLength: photo.original.byteLength },
			version: { id: version.id, kind: version.kind, name: version.name, createdAt: version.createdAt, develop: version.develop }, metadata: photo.metadata, extractedMetadata: photo.extractedMetadata });
		return value;
	}
	function observe() { return page.evaluate(async ({ pathname, photoId }) => (await import(new URL(pathname, location.href).href)).readRawImportCustodyCurrentV1(photoId), { pathname: PROGRAM, photoId }); }
	function immutable(value) { expect(value.bytes).toEqual([...originalBytes]); expect(value.original.sha256).toBe(digest); expect(value.original.byteLength).toBe(originalBytes.length);
		expect(value.photo.original.contentSha256).toBe(digest); expect(value.photo.original.mimeType).toBe('image/x-adobe-dng'); }
});

/** Independent source-word mathematics: one literal Original-space Clone,
 * exact WB[2,1,.5], exposure1/2, and Float32 stores after each deep stage.
 * Nearest50% selects source(2x,2y); only final codec output is quantized. */
function rasterOracle(words) {
	const source = Float32Array.from(words, value => value / 65535), clone = source.slice();
	clone.set(source.subarray((20 * 32 + 8) * 4, (20 * 32 + 8) * 4 + 3), (20 * 32 + 24) * 4);
	const balanced = clone.map((value, index) => index % 4 === 3 ? value : value * [2, 1, .5][index % 4]);
	const result = balanced.map((value, index) => index % 4 === 3 ? value : value * .5);
	const sample = (value, index, maximum) => { const clamped = Math.max(0, Math.min(1, value));
		return Math.round(maximum * (index % 4 === 3 ? clamped : clamped <= .0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - .055)); };
	const half = [];
	for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) for (let channel = 0; channel < 4; channel++) half.push(result[(y * 2 * 32 + x * 2) * 4 + channel]);
	return { byte: Array.from(result, (value, index) => sample(value, index, 255)), wordHalf: half.map((value, index) => sample(value, index, 65535)) };
}

/** Independent PNG container, per-chunk CRC, zlib and all five filter readers;
 * neither the production PNG encoder nor a production pixel reader is used. */
function readPng(bytes) {
	expect(bytes.length).toBeLessThan(262_144); expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	const chunks = [], compressed = []; let at = 8;
	while (at < bytes.length) {
		expect(at + 12).toBeLessThanOrEqual(bytes.length); const size = bytes.readUInt32BE(at), end = at + size + 12;
		expect(end).toBeLessThanOrEqual(bytes.length); const type = bytes.toString('ascii', at + 4, at + 8), data = bytes.subarray(at + 8, end - 4);
		expect(bytes.readUInt32BE(end - 4)).toBe(crc32(bytes.subarray(at + 4, end - 4))); chunks.push({ type, data });
		if (type === 'IDAT') compressed.push(data); at = end;
	}
	expect(at).toBe(bytes.length); expect(chunks[0].type).toBe('IHDR'); expect(chunks.at(-1)).toEqual({ type: 'IEND', data: Buffer.alloc(0) });
	expect(chunks.filter(chunk => chunk.type === 'IHDR')).toHaveLength(1); expect(chunks.filter(chunk => chunk.type === 'sRGB').map(chunk => [...chunk.data])).toEqual([[0]]);
	for (const chunk of chunks) expect(['IHDR', 'sRGB', 'IDAT', 'IEND']).toContain(chunk.type);
	const header = chunks[0].data; expect(header.length).toBe(13); const width = header.readUInt32BE(0), height = header.readUInt32BE(4), depth = header[8];
	expect([8, 16]).toContain(depth); expect([header[9], header[10], header[11], header[12]]).toEqual([6, 0, 0, 0]);
	expect(width).toBeGreaterThan(0); expect(width).toBeLessThanOrEqual(32); expect(height).toBeGreaterThan(0); expect(height).toBeLessThanOrEqual(32);
	const pixelBytes = depth / 8 * 4, rowBytes = width * pixelBytes, raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: 16_384 });
	expect(raw.length).toBe((rowBytes + 1) * height); const decoded = Buffer.alloc(rowBytes * height);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (rowBytes + 1)]; expect(filter).toBeLessThanOrEqual(4);
		for (let x = 0; x < rowBytes; x++) {
			const left = x >= pixelBytes ? decoded[y * rowBytes + x - pixelBytes] : 0, above = y ? decoded[(y - 1) * rowBytes + x] : 0;
			const corner = y && x >= pixelBytes ? decoded[(y - 1) * rowBytes + x - pixelBytes] : 0;
			let prediction = 0;
			if (filter === 1) prediction = left; else if (filter === 2) prediction = above; else if (filter === 3) prediction = Math.floor((left + above) / 2);
			else if (filter === 4) { const estimate = left + above - corner, a = Math.abs(estimate - left), b = Math.abs(estimate - above), c = Math.abs(estimate - corner);
				prediction = a <= b && a <= c ? left : b <= c ? above : corner; }
			decoded[y * rowBytes + x] = (raw[y * (rowBytes + 1) + 1 + x] + prediction) & 255;
		}
	}
	const samples = depth === 8 ? [...decoded] : Array.from({ length: decoded.length / 2 }, (_, index) => decoded.readUInt16BE(index * 2));
	return { width, height, depth, samples };
}
function crc32(bytes) { let crc = 0xffffffff; for (const value of bytes) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }

/** JPEG90 is lossy. Qualify real decoder RGB against four flat interior ROIs,
 * away from sensor quadrant boundaries and the deliberate Clone discontinuity. */
function assertJpegInterior(actual, expected) {
	const differences = [];
	for (const [left, top] of [[4, 4], [22, 4], [4, 24], [22, 26]]) for (let y = top; y < top + 3; y++) for (let x = left; x < left + 3; x++) for (let channel = 0; channel < 3; channel++) {
		const index = (y * 32 + x) * 4 + channel; differences.push(Math.abs(actual[index] - expected[index]));
	}
	expect(differences).toHaveLength(108); expect(Math.max(...differences)).toBeLessThanOrEqual(6);
	expect(differences.reduce((sum, value) => sum + value, 0) / differences.length).toBeLessThanOrEqual(3);
}
function plane(canvas) { return canvas.evaluate(node => [node.width, node.height, ...node.getContext('2d').getImageData(0, 0, node.width, node.height).data]); }
function named(root, role, name) { return root.getByRole(role, { name, exact: true }); }
