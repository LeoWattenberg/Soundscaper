/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { numberEntry, pngChunk, textEntry, tiffFixture } from '../helpers/image-metadata-fixtures.ts';
import { decodePinnedJpegRgbFrame, readRgbPixel } from './helpers/pinned-video-frame-decoder.mjs';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { assertNativeOpfsWorkerExecution, installNativeOpfsWorkerCompanion } from './helpers/native-opfs-worker-companion.ts';

// The observer serves test-only code. Cold cases retain ordinary built-site coverage.
const observedTest = test.extend({ browserCoverage: false });
const SOURCE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==', 'base64');
const SENTINEL = 'JPEG original metadata custody sentinel';
const exif = tiffFixture([numberEntry(0x0112, 1), textEntry(0x010f, SENTINEL)], [numberEntry(0xa001, 1)]);
const PNG = Buffer.concat([SOURCE_PNG.subarray(0, -12), pngChunk('eXIf', exif),
	pngChunk('tEXt', Buffer.from(`Comment\0${SENTINEL}`)),
	pngChunk('tEXt', Buffer.from(`XML:com.adobe.xmp\0<x:xmpmeta>${SENTINEL}</x:xmpmeta>`)), SOURCE_PNG.subarray(-12)]);
const CUBE = Buffer.from(`LUT_3D_SIZE 2\n${'0.25 0 0\n'.repeat(8)}`);
const PIXELS = [137, 0, 0, 255, 137, 0, 0, 255];

for (const locale of ['en', 'de']) {
	test(`${locale}: JPEG export is a cold disabled File menu action on an empty library`, async ({ page }) => {
		const requests = [];
		page.on('request', request => { if (request.resourceType() === 'script') requests.push(new URL(request.url()).pathname); });
		const { app, copy } = await open(page, locale);
		await expect(app.locator('[data-photo-library]')).toHaveCount(0);
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await menu(page, app, copy.photoFileMenu);
		const action = app.locator('[data-photo-jpeg-export-menu]');
		await expect(action).toHaveText(locale === 'en' ? 'Export JPEG…' : 'JPEG exportieren…');
		await expect(action).toBeDisabled();
		await expect(app.locator('[data-photo-jpeg-export-dialog]')).toHaveCount(0);
		expect(requests.filter(path => /(?:editor-jpeg-bytes|PhotoJpegExportDialog|PhotoRasterExportDialog|lightscaper-photo-jpeg-export-copy)/u.test(path))).toEqual([]);
	});

	observedTest(`${locale}: keyboard JPEG export preserves full-resolution LUT and crop pixels, strips source metadata, and leaves originals and develop history unchanged`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'The roadmap defers native WebKit Blob/OPFS catalog workflows.');
		test.setTimeout(90_000);
		await page.addInitScript(() => {
			Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
			const create = URL.createObjectURL, blobType = Object.getOwnPropertyDescriptor(Blob.prototype, 'type').get;
			const records = []; Object.defineProperty(globalThis, '__jpegObjectUrlTypes', { value: records });
			// Observe native delivery metadata without fetching CSP-blocked blob URLs or retaining media.
			Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: function (...args) {
				const url = Reflect.apply(create, this, args);
				if (args[0] instanceof Blob) {
					if (records.length === 64) records.shift();
					records.push({ url, type: Reflect.apply(blobType, args[0], []) });
				}
				return url;
			} });
		});
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
		const first = await exportJpeg();
		expect(first.name).toBe('Export original.jpg');
		await assertJpeg(first.bytes);
		expect(await observe(page, photoId)).toEqual(before);
		const second = await exportJpeg();
		expect(second.name).toBe(first.name); await assertJpeg(second.bytes); expect(await observe(page, photoId)).toEqual(before);
		await page.reload(); await expect(app).toBeVisible();
		await menu(page, app, copy.photoViewMenu); await keyboard(page, named(app, 'button', copy.photoShowLibrary));
		await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false'); await keyboard(page, card);
		const reloaded = await exportJpeg(); expect(reloaded.name).toBe(first.name); await assertJpeg(reloaded.bytes);
		expect(await observe(page, photoId)).toEqual(before); expect(errors).toEqual([]);

		async function exportJpeg() {
			await menu(page, app, copy.photoFileMenu); await keyboard(page, app.locator('[data-photo-jpeg-export-menu]'));
			const dialog = page.getByRole('dialog').filter({ has: page.locator('[data-photo-jpeg-export-dialog]') });
			await expect(dialog).toBeVisible();
			const save = dialog.locator('[data-photo-jpeg-export-save]');
			await expect(save).toBeEnabled(); await expect(save).toBeFocused();
			const pending = page.waitForEvent('download'); await keyboard(page, save); const download = await pending;
			const mime = await page.evaluate(url => globalThis.__jpegObjectUrlTypes.filter(record => record.url === url).map(record => record.type), download.url());
			expect(mime).toEqual(['image/jpeg']);
			const bytes = await readFile(await download.path());
			await expect(dialog.locator('[data-photo-jpeg-export-receipt]')).toBeVisible();
			await expect(dialog.locator('[data-photo-jpeg-export-receipt]')).toHaveAttribute('data-photo-jpeg-export-status', 'download-started');
			await expect(save).toBeEnabled(); await expect(dialog.getByRole('alert')).toHaveCount(0);
			await keyboard(page, dialog.locator('[data-photo-jpeg-export-close]')); await expect(dialog).toHaveCount(0);
			return { name: download.suggestedFilename(), bytes };
		}
	});
}

/** Independent marker walk and actual pinned software decode. JPEG loss is
 * compared against literal pixels, never production encoder/renderer output. */
async function assertJpeg(bytes) {
	// Prove the exact tiny geometry before the codec sees this bounded input.
	expect(bytes.length).toBeGreaterThan(4); expect(bytes.length).toBeLessThanOrEqual(1024 * 1024);
	expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
	let offset = 2, inScan = false, frames = 0, ended = false;
	while (offset < bytes.length) {
		if (inScan && bytes[offset] !== 0xff) { offset++; continue; }
		expect(bytes[offset++]).toBe(0xff);
		while (bytes[offset] === 0xff) offset++;
		const marker = bytes[offset++];
		if (inScan && (marker === 0 || marker >= 0xd0 && marker <= 0xd7)) continue;
		if (marker === 0xd9) { expect(offset).toBe(bytes.length); ended = true; break; }
		expect([0, 0xd8, 0xe1, 0xed, 0xfe]).not.toContain(marker); // No Exif/XMP, IPTC or COM, including between scans.
		if (marker === 1) continue;
		expect(offset + 2).toBeLessThanOrEqual(bytes.length);
		const length = bytes.readUInt16BE(offset); expect(length).toBeGreaterThanOrEqual(2);
		expect(offset + length).toBeLessThanOrEqual(bytes.length);
		if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
			expect([0xc0, 0xc1, 0xc2]).toContain(marker); expect(++frames).toBe(1);
			expect(bytes[offset + 2]).toBe(8); expect(bytes.readUInt16BE(offset + 3)).toBe(2); expect(bytes.readUInt16BE(offset + 5)).toBe(1);
			expect([1, 3]).toContain(bytes[offset + 7]); expect(length).toBe(8 + bytes[offset + 7] * 3);
		}
		if (marker === 0xda) { expect(frames).toBe(1); inScan = true; }
		offset += length;
	}
	expect(ended).toBe(true); expect(inScan).toBe(true); expect(frames).toBe(1);
	expect(bytes.includes(Buffer.from(SENTINEL))).toBe(false);
	// Maintained decoder owns/cleans input and output MEMFS files in finally;
	// the Node-side codec never replaces the browser's actual encoder.
	const decoded = await decodePinnedJpegRgbFrame(bytes);
	expect([decoded.width, decoded.height, decoded.rgb.length]).toEqual([1, 2, 6]);
	for (const y of [0, 1]) {
		const rgb = readRgbPixel(decoded, { x: 0, y });
		for (let channel = 0; channel < 3; channel++) expect(Math.abs(rgb[channel] - PIXELS[y * 4 + channel])).toBeLessThanOrEqual(8);
	}
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
	await page.route('**/__jpeg_export_observer.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
	const observed = await page.evaluate(async id => (await import(new URL('/__jpeg_export_observer.js', location.href).href))
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
