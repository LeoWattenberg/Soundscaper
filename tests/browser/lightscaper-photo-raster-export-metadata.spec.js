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
import { decodePinnedJpegRgbFrame } from './helpers/pinned-video-frame-decoder.mjs';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { assertNativeOpfsWorkerExecution, installNativeOpfsWorkerCompanion } from './helpers/native-opfs-worker-companion.ts';

// The catalog observer serves executable test-only code, as in the owning raster workflows.
test.use({ browserCoverage: false });
// Independent classic TIFF literals: orientation 8, camera/lens and unsigned rationals.
// Neither the fixture nor the expected tag/pixel values comes from an application writer.
const CAPTURE_TIFF = Buffer.from('SUkqAAgAAAAGABIBAwABAAAACAAAAA8BAgAPAAAAvAAAABABAgAIAAAAywAAADsBAgAXAAAA0wAAAA4BAgAcAAAA6gAAAGmHBAABAAAAVgAAAAAAAAAIADSkAgANAAAABgEAAJqCBQABAAAAEwEAAJ2CBQABAAAAGwEAAAqSBQABAAAAIwEAACeIAwABAAAAyAAAAAGgAwABAAAAAQAAAAKgBAABAAAAAgAAAAOgBAABAAAAAgAAAAAAAABGaXh0dXJlIENhbWVyYQBNb2RlbCAyAFNvdXJjZSBhcnRpc3Qgc2VudGluZWwAU291cmNlIGRlc2NyaXB0aW9uIHNlbnRpbmVsAEZpeHR1cmUgMzVtbQABAAAAfQAAAA4AAAAFAAAAIwAAAAEAAAA=', 'base64');
// 4294967294/4294967295 is valid stored TIFF. Its rounded numeric read model
// cannot be written as an exact bounded unsigned rational; Capture must refuse it.
const REFUSED_TIFF = Buffer.from('SUkqAAgAAAADABIBAwABAAAAAQAAAA8BAgAYAAAAUAAAAGmHBAABAAAAMgAAAAAAAAACAJqCBQABAAAAaAAAAAGgAwABAAAAAQAAAAAAAABCb3VuZGVkIG51bWVyaWMgZml4dHVyZQD+/////////w==', 'base64');
const CORNERS = [200, 0, 0, 255, 0, 200, 0, 255, 0, 0, 200, 255, 200, 200, 0, 255];
const UPRIGHT = [0, 200, 0, 255, 200, 200, 0, 255, 200, 0, 0, 255, 0, 0, 200, 255];
const PIXELS = [137, 0, 0, 255, 137, 0, 0, 255];
const REFUSED_PIXELS = Array.from({ length: 4 }, () => [31, 97, 193, 255]).flat();
const PNG = sourcePng(CAPTURE_TIFF, CORNERS), REFUSED_PNG = sourcePng(REFUSED_TIFF, REFUSED_PIXELS);
const CUBE = Buffer.from(`LUT_3D_SIZE 2\n${'0.25 0 0\n'.repeat(8)}`);

for (const locale of ['en', 'de']) {
	test(`${locale}: File PNG and JPEG Capture rebuild admitted EXIF after Develop, recover bounded metadata refusal, and preserve the resident catalog`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'The roadmap defers native WebKit Blob/OPFS catalog workflows.');
		test.setTimeout(90_000);
		await page.addInitScript(() => {
			Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
			const create = URL.createObjectURL, blobType = Object.getOwnPropertyDescriptor(Blob.prototype, 'type').get;
			const records = []; Object.defineProperty(globalThis, '__metadataObjectUrlTypes', { value: records });
			// Native receiver/result remain unchanged; retain only bounded URL/MIME strings.
			Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: function (...args) {
				const url = Reflect.apply(create, this, args);
				if (args[0] instanceof Blob) { if (records.length === 64) records.shift(); records.push({ url, type: Reflect.apply(blobType, args[0], []) }); }
				return url;
			} });
		});
		const errors = [], downloads = [];
		page.on('pageerror', error => { errors.push(error.message); });
		page.on('download', download => { downloads.push(download.suggestedFilename()); });
		const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
		await page.goto(`${origin}/${locale}/`);
		const app = page.locator('[data-lightscaper-bound="true"]'), copy = bundledLightscaperEditorCopyForLocale(locale), messages = photoDevelopCopy(locale);
		await expect(app).toBeVisible();
		await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', copy.photoImportPhotos));
		const importer = named(page, 'dialog', copy.photoImportPhotos);
		await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles([
			{ name: 'Metadata original.png', mimeType: 'image/png', buffer: PNG },
			{ name: 'Numeric original.png', mimeType: 'image/png', buffer: REFUSED_PNG },
		]);
		await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
		const library = app.locator('[data-photo-library]'), cards = library.locator('[data-photo-id]');
		await expect(cards).toHaveCount(2); await expect(library).toHaveAttribute('aria-busy', 'false');
		const card = cards.filter({ has: page.getByText('Metadata original.png', { exact: true }) });
		const refusedCard = cards.filter({ has: page.getByText('Numeric original.png', { exact: true }) });
		const ids = [await card.getAttribute('data-photo-id'), await refusedCard.getAttribute('data-photo-id')];
		const imported = await observe(page, ids);
		const stored = imported.photos[0].photo.extractedMetadata;
		expect(stored.issues).toEqual([]);
		expect(stored.exif).toMatchObject({ orientation: 8, cameraMake: 'Fixture Camera', cameraModel: 'Model 2', lensModel: 'Fixture 35mm',
			exposureSeconds: 1 / 125, aperture: 2.8, iso: 200, focalLengthMm: 35, artist: 'Source artist sentinel', description: 'Source description sentinel' });
		expect(imported.photos[1].photo.extractedMetadata.issues).toEqual([]);
		expect(imported.photos[1].photo.extractedMetadata.exif.exposureSeconds).toBe(0.9999999997671694);
		for (const [index, bytes] of [PNG, REFUSED_PNG].entries()) {
			expect(imported.photos[index].bytes).toEqual([...bytes]);
			expect(imported.photos[index].photo.original.contentSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
		}
		await keyboard(page, card); await menu(page, app, copy.photoFileMenu); await menu(page, app, copy.photoPhotoMenu);
		await keyboard(page, named(app, 'button', photoDevelopMenuLabel(locale)));
		const develop = named(page, 'dialog', `${messages.title}: Metadata original.png`);
		await expect(named(develop, 'region', messages.preview)).toHaveAttribute('data-state', 'ready');
		const after = named(develop, 'img', messages.after);
		await expect.poll(() => after.evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, 2, 2).data))).toEqual(UPRIGHT);
		await choose(page, named(develop, 'combobox', messages.choose), 'cube-lut-profile-v1');
		await keyboard(page, named(develop, 'button', messages.add));
		await develop.getByLabel(messages.shared.videoEffectCubeLutImport, { exact: true }).setInputFiles({ name: 'Quarter red.cube', mimeType: 'text/plain', buffer: CUBE });
		await choose(page, named(develop, 'combobox', messages.choose), 'develop-geometry-v1');
		await keyboard(page, named(develop, 'button', messages.add));
		const crop = named(develop, 'spinbutton', `${messages.shared.videoEffectExactValue}: ${messages.shared.videoEffectParamCropWidth}`);
		await crop.fill('0.5'); await crop.press('Enter');
		await expect.poll(() => after.evaluate(canvas => [canvas.width, canvas.height])).toEqual([1, 2]);
		await expect.poll(() => after.evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, 1, 2).data))).toEqual(PIXELS);
		await keyboard(page, named(develop, 'button', messages.save)); await expect(develop.locator('[data-photo-develop-ack]')).toBeVisible();
		await keyboard(page, named(develop, 'button', messages.close).last()); await expect(develop).toHaveCount(0);
		const before = await observe(page, ids);
		expect(before.root.id).toBe(imported.root.id); expect(before.namespace).toBe(imported.namespace);
		expect(before.photos[0].photo.extractedMetadata).toEqual(stored);
		for (const format of ['png', 'jpeg']) {
			const dialog = await openExport(format), scope = dialog.locator('[data-photo-raster-export-metadata]');
			await expect(scope).toHaveValue('strip');
			await expect(dialog.locator('[data-photo-raster-export-metadata-help]')).toContainText('GPS');
			await expect(dialog.locator('[data-photo-raster-export-metadata-help]')).toContainText('ASCII');
			const stripped = await saveExport(dialog, format, 1, 2, PIXELS, false);
			await choose(page, scope, 'capture');
			const captured = await saveExport(dialog, format, 1, 2, PIXELS, true);
			expect(captured).toEqual(stripped); // Within-engine decoded pixels, never JPEG byte equality.
			await closeExport(dialog, format); expect(await observe(page, ids)).toEqual(before);
		}
		await keyboard(page, refusedCard);
		for (const format of ['png', 'jpeg']) {
			const dialog = await openExport(format), scope = dialog.locator('[data-photo-raster-export-metadata]');
			await choose(page, scope, 'capture'); const priorDownloads = downloads.length;
			await keyboard(page, dialog.locator(`[data-photo-${format}-export-save]`));
			await expect(dialog.locator('[data-photo-raster-export-metadata-error]')).toBeVisible();
			await expect(dialog.locator(`[data-photo-${format}-export-save]`)).toBeEnabled();
			expect(downloads).toHaveLength(priorDownloads);
			await choose(page, scope, 'strip'); await saveExport(dialog, format, 2, 2, REFUSED_PIXELS, false);
			await closeExport(dialog, format); expect(await observe(page, ids)).toEqual(before);
		}
		await page.reload(); await expect(app).toBeVisible();
		await menu(page, app, copy.photoViewMenu); await keyboard(page, named(app, 'button', copy.photoShowLibrary));
		await expect(cards).toHaveCount(2); await expect(library).toHaveAttribute('aria-busy', 'false'); await keyboard(page, card);
		for (const format of ['png', 'jpeg']) {
			const dialog = await openExport(format); await choose(page, dialog.locator('[data-photo-raster-export-metadata]'), 'capture');
			await saveExport(dialog, format, 1, 2, PIXELS, true); await closeExport(dialog, format);
		}
		expect(await observe(page, ids)).toEqual(before); expect(errors).toEqual([]);

		async function openExport(format) {
			await menu(page, app, copy.photoFileMenu); await keyboard(page, app.locator(`[data-photo-${format}-export-menu]`));
			const dialog = page.getByRole('dialog').filter({ has: page.locator(`[data-photo-${format}-export-dialog]`) });
			await expect(dialog).toBeVisible(); await expect(dialog.locator(`[data-photo-${format}-export-save]`)).toBeFocused(); return dialog;
		}
		async function saveExport(dialog, format, width, height, pixels, capture) {
			const save = dialog.locator(`[data-photo-${format}-export-save]`), pending = page.waitForEvent('download');
			await keyboard(page, save); const download = await pending;
			expect(download.suggestedFilename()).toBe(`${width === 1 ? 'Metadata' : 'Numeric'} original.${format === 'png' ? 'png' : 'jpg'}`);
			expect(await page.evaluate(url => globalThis.__metadataObjectUrlTypes.filter(row => row.url === url).map(row => row.type), download.url())).toEqual([`image/${format}`]);
			const bytes = await readFile(await download.path()), decoded = format === 'png'
				? assertPng(bytes, width, height, pixels, capture) : await assertJpeg(bytes, width, height, pixels, capture);
			await expect(dialog.locator(`[data-photo-${format}-export-receipt]`)).toHaveAttribute(`data-photo-${format}-export-status`, 'download-started');
			await expect(save).toBeEnabled(); await expect(dialog.getByRole('alert')).toHaveCount(0); return decoded;
		}
		async function closeExport(dialog, format) { await keyboard(page, dialog.locator(`[data-photo-${format}-export-close]`)); await expect(dialog).toHaveCount(0); }
	});
}

function sourcePng(tiff, pixels) {
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk('IHDR', Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0])), pngChunk('sRGB', Buffer.from([0])),
		pngChunk('eXIf', tiff), pngChunk('tEXt', Buffer.from('XML:com.adobe.xmp\0Source XMP sentinel')),
		pngChunk('IDAT', deflateSync(Buffer.from([0, ...pixels.slice(0, 8), 0, ...pixels.slice(8)]))), pngChunk('IEND', Buffer.alloc(0))]);
}
/** Independent container, CRC, inflate and TIFF walks; literal tags/pixels are the oracle. */
function assertPng(bytes, width, height, pixels, capture) {
	expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	const chunks = [], compressed = [], exif = []; let offset = 8;
	while (offset < bytes.length) {
		const size = bytes.readUInt32BE(offset), end = offset + 12 + size; expect(end).toBeLessThanOrEqual(bytes.length);
		const type = bytes.toString('ascii', offset + 4, offset + 8), data = bytes.subarray(offset + 8, end - 4);
		expect(bytes.readUInt32BE(end - 4)).toBe(crc32(bytes.subarray(offset + 4, end - 4))); chunks.push(type);
		if (type === 'IHDR') { expect(data.readUInt32BE(0)).toBe(width); expect(data.readUInt32BE(4)).toBe(height); expect([...data.subarray(8)]).toEqual([8, 6, 0, 0, 0]); }
		else if (type === 'sRGB') expect([...data]).toEqual([0]);
		else if (type === 'IDAT') compressed.push(data);
		else if (type === 'eXIf') exif.push(data);
		else { expect(type).toBe('IEND'); expect(size).toBe(0); }
		offset = end;
	}
	expect(offset).toBe(bytes.length); expect(chunks.slice(0, 2)).toEqual(['IHDR', 'sRGB']); expect(chunks.at(-1)).toBe('IEND');
	expect(compressed.length).toBeGreaterThan(0); assertMetadata(exif, capture, width, height);
	const rows = []; for (let y = 0; y < height; y++) rows.push(0, ...pixels.slice(4 * width * y, 4 * width * (y + 1)));
	expect([...inflateSync(Buffer.concat(compressed))]).toEqual(rows); return pixels;
}
async function assertJpeg(bytes, width, height, pixels, capture) {
	expect(bytes.length).toBeLessThanOrEqual(1024 * 1024); expect([...bytes.subarray(0, 2)]).toEqual([255, 216]);
	const exif = []; let offset = 2, inScan = false, frames = 0, ended = false;
	while (offset < bytes.length) {
		if (inScan && bytes[offset] !== 255) { offset++; continue; }
		expect(bytes[offset++]).toBe(255); while (bytes[offset] === 255) offset++;
		const marker = bytes[offset++];
		if (inScan && (marker === 0 || marker >= 0xd0 && marker <= 0xd7)) continue;
		if (marker === 0xd9) { expect(offset).toBe(bytes.length); ended = true; break; }
		expect([0, 0xd8, 0xed, 0xfe]).not.toContain(marker); if (marker === 1) continue;
		const length = bytes.readUInt16BE(offset); expect(length).toBeGreaterThanOrEqual(2); expect(offset + length).toBeLessThanOrEqual(bytes.length);
		if (marker === 0xe1) { expect(bytes.toString('ascii', offset + 2, offset + 8)).toBe('Exif\0\0'); exif.push(bytes.subarray(offset + 8, offset + length)); }
		if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
			expect([0xc0, 0xc1, 0xc2]).toContain(marker); expect(++frames).toBe(1); expect(bytes[offset + 2]).toBe(8);
			expect(bytes.readUInt16BE(offset + 3)).toBe(height); expect(bytes.readUInt16BE(offset + 5)).toBe(width);
		}
		if (marker === 0xda) { expect(frames).toBe(1); inScan = true; } offset += length;
	}
	expect(ended && inScan).toBe(true); expect(frames).toBe(1); assertMetadata(exif, capture, width, height);
	const decoded = await decodePinnedJpegRgbFrame(bytes); expect([decoded.width, decoded.height]).toEqual([width, height]);
	expect(decoded.rgb.length).toBe(width * height * 3);
	for (let index = 0; index < decoded.rgb.length; index++) expect(Math.abs(decoded.rgb[index] - pixels[Math.floor(index / 3) * 4 + index % 3])).toBeLessThanOrEqual(8);
	return [...decoded.rgb];
}
function assertMetadata(tiffs, capture, width, height) {
	expect(tiffs).toHaveLength(capture ? 1 : 0); if (!capture) return;
	const bytes = tiffs[0]; expect([...bytes.subarray(0, 4)]).toEqual([73, 73, 42, 0]);
	const root = directory(bytes.readUInt32LE(4)), sub = directory(root.get(0x8769));
	expect([...root.keys()]).toEqual([0x010f, 0x0110, 0x0112, 0x8769]);
	expect([...sub.keys()]).toEqual([0x829a, 0x829d, 0x8827, 0x8830, 0x8833, 0x9000, 0x920a, 0xa001, 0xa002, 0xa003, 0xa434]);
	expect(root.get(0x0112)).toBe(1); expect(root.get(0x010f)).toBe('Fixture Camera'); expect(root.get(0x0110)).toBe('Model 2');
	expect(sub.get(0xa434)).toBe('Fixture 35mm'); expect(sub.get(0x829a)).toEqual([1, 125]); expect(sub.get(0x829d)).toEqual([14, 5]);
	expect(sub.get(0x920a)).toEqual([35, 1]); expect(sub.get(0x8827)).toBe(200); expect(sub.get(0x8833)).toBe(200);
	expect(sub.get(0x9000)).toEqual([48, 50, 51, 50]); expect(sub.get(0x8830)).toBe(3);
	expect(sub.get(0xa001)).toBe(1); expect(sub.get(0xa002)).toBe(width); expect(sub.get(0xa003)).toBe(height);
	for (const text of ['Source artist sentinel', 'Source description sentinel', 'Source XMP sentinel']) expect(bytes.includes(Buffer.from(text))).toBe(false);
	function directory(at) {
		expect(at + 2).toBeLessThanOrEqual(bytes.length); const count = bytes.readUInt16LE(at); expect(count).toBeLessThan(32);
		expect(at + 6 + count * 12).toBeLessThanOrEqual(bytes.length); const values = new Map();
		for (let index = 0; index < count; index++) {
			const entry = at + 2 + index * 12, tag = bytes.readUInt16LE(entry), type = bytes.readUInt16LE(entry + 2), size = bytes.readUInt32LE(entry + 4);
			expect([2, 3, 4, 5, 7]).toContain(type); expect(values.has(tag)).toBe(false);
			const length = size * ({ 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 })[type], body = length <= 4 ? entry + 8 : bytes.readUInt32LE(entry + 8);
			expect(size).toBeGreaterThan(0); expect(body + length).toBeLessThanOrEqual(bytes.length);
			const value = type === 2 ? bytes.toString('ascii', body, body + length - 1) : type === 3 ? bytes.readUInt16LE(body)
				: type === 4 ? bytes.readUInt32LE(body) : type === 5 ? [bytes.readUInt32LE(body), bytes.readUInt32LE(body + 4)] : [...bytes.subarray(body, body + length)];
			if (type === 2) expect(bytes[body + length - 1]).toBe(0); values.set(tag, value);
		}
		expect(bytes.readUInt32LE(at + 2 + count * 12)).toBe(0); return values;
	}
}
function crc32(bytes) {
	let value = 0xffffffff;
	for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
	return (value ^ 0xffffffff) >>> 0;
}
async function observe(page, ids) {
	await installNativeOpfsWorkerCompanion(page);
	const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('../helpers/', import.meta.url)), contents:
		`export { readResidentPhotoLibraryCurrent } from './lightscaper-current-app-fixture.tsx';` }, bundle: true, write: false, format: 'esm', platform: 'browser' });
	await page.route('**/__raster_metadata_observer.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
	const observed = await page.evaluate(async photoIds => (await import(new URL('/__raster_metadata_observer.js', location.href).href))
		.readResidentPhotoLibraryCurrent(photoIds, indexedDB, () => globalThis.__assertNativeOpfsWorkerExecution()), ids);
	await assertNativeOpfsWorkerExecution(page); return observed;
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
