/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoPngExportCopy } from '../../src/common/i18n/lightscaper-photo-png-export-copy.ts';
import { photoJpegExportCopy } from '../../src/common/i18n/lightscaper-photo-jpeg-export-copy.ts';
import { photoPngExportMenuLabel } from '../../src/common/i18n/lightscaper-photo-png-export-menu-copy.ts';
import { photoJpegExportMenuLabel } from '../../src/common/i18n/lightscaper-photo-jpeg-export-menu-copy.ts';
import { imageExportTextCopy } from '../../src/common/i18n/image-export-text-copy.ts';
import { pngChunk } from '../helpers/image-metadata-fixtures.ts';
import { decodePinnedJpegRgbFrame } from './helpers/pinned-video-frame-decoder.mjs';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { assertNativeOpfsWorkerExecution, installNativeOpfsWorkerCompanion } from './helpers/native-opfs-worker-companion.ts';

// Only the custody observer serves test code; the cold cases collect the real built site.
const observedTest = test.extend({ browserCoverage: false });
const sourceRows = Buffer.alloc(128 * (128 * 4 + 1));
for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) sourceRows[y * 513 + 1 + x * 4 + 3] = 255;
const ihdr = Buffer.from([0, 0, 0, 128, 0, 0, 0, 128, 8, 6, 0, 0, 0]);
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr),
	pngChunk('sRGB', Buffer.from([0])), pngChunk('IDAT', deflateSync(sourceRows)), pngChunk('IEND', Buffer.alloc(0))]);

for (const locale of ['en', 'de']) {
	test(`${locale}: text glyph, copy and font stay cold behind the disabled Photo export menu`, async ({ page }) => {
		const requests = [];
		page.on('request', request => { requests.push(new URL(request.url()).pathname); });
		const { app, copy } = await open(page, locale);
		await menu(page, app, copy.photoFileMenu);
		for (const label of [photoPngExportMenuLabel(locale), photoJpegExportMenuLabel(locale)]) await expect(named(app, 'button', label)).toBeDisabled();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		expect(requests.filter(path => /(?:editor-export-text|PhotoTextWatermarkFields|image-export-text-copy|inter-latin-600-normal)/u.test(path))).toEqual([]);
	});

	for (const format of ['png', 'jpeg']) observedTest(`${locale}: ${format} File export renders readable native text after resize, refuses unsupported glyphs and preserves catalog custody`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'The roadmap defers native WebKit Blob/OPFS catalog workflows.');
		test.setTimeout(90_000);
		await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
		const errors = []; page.on('pageerror', error => { errors.push(error.message); });
		const { app, copy } = await open(page, locale), text = imageExportTextCopy(locale);
		const output = format === 'png' ? photoPngExportCopy(locale) : photoJpegExportCopy(locale);
		const label = format === 'png' ? photoPngExportMenuLabel(locale) : photoJpegExportMenuLabel(locale);
		await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', copy.photoImportPhotos));
		const importer = named(page, 'dialog', copy.photoImportPhotos);
		await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: 'Readable original.png', mimeType: 'image/png', buffer: PNG });
		await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
		const library = app.locator('[data-photo-library]'), card = library.locator('[data-photo-id]');
		await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false'); await keyboard(page, card);
		const photoId = await card.getAttribute('data-photo-id'), before = await observe(page, photoId);
		expect(before.photos[0].bytes).toEqual([...PNG]);
		expect(before.photos[0].photo.original.contentSha256).toBe(createHash('sha256').update(PNG).digest('hex'));
		const baseline = await decode((await exportText(false, false)).bytes, format);
		expect([baseline.width, baseline.height]).toEqual([64, 64]);
		let baselineMaximum = 0;
		for (const channel of baseline.rgb) baselineMaximum = Math.max(baselineMaximum, channel);
		expect(baselineMaximum).toBeLessThanOrEqual(format === 'png' ? 0 : 8);
		const first = await exportText(true);
		expect(first.name).toBe(`Readable original.${format === 'png' ? 'png' : 'jpg'}`);
		assertReadableH(await decode(first.bytes, format), format === 'png' ? 0 : 8);
		expect(await observe(page, photoId)).toEqual(before);
		const repeat = await exportText(false); assertReadableH(await decode(repeat.bytes, format), format === 'png' ? 0 : 8);
		if (format === 'png') expect(repeat.bytes).toEqual(first.bytes);
		expect(await observe(page, photoId)).toEqual(before);
		await page.reload(); await expect(app).toBeVisible();
		await menu(page, app, copy.photoViewMenu); await keyboard(page, named(app, 'button', copy.photoShowLibrary));
		await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false'); await keyboard(page, card);
		assertReadableH(await decode((await exportText(false)).bytes, format), format === 'png' ? 0 : 8);
		expect(await observe(page, photoId)).toEqual(before); expect(errors).toEqual([]);

		async function exportText(checkRefusal, textEnabled = true) {
			await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', label));
			const dialog = named(page, 'dialog', output.title), footer = dialog.locator('.lightscaper-catalog-backup-actions'), save = named(footer, 'button', output.save);
			await expect(save).toBeEnabled(); await expect(save).toBeFocused();
			const enabled = named(dialog, 'checkbox', text.enabled); await expect(enabled).not.toBeChecked();
			await choose(page, named(dialog, 'combobox', output.outputSize), 'percentage');
			await named(dialog, 'spinbutton', output.percentage).fill('50');
			if (textEnabled) {
				await toggle(page, enabled, true); await expect(dialog.getByText(text.help, { exact: true })).toBeVisible();
				if (checkRefusal) {
					await named(dialog, 'textbox', text.text).fill('漢');
					await keyboard(page, save); await expect(dialog.getByRole('alert')).toHaveText(output.invalidSettings);
					await expect(dialog.locator(`[data-photo-${format}-export-receipt]`)).toHaveCount(0);
				}
				await named(dialog, 'textbox', text.text).fill('H');
				await named(dialog, 'spinbutton', text.width).fill('50');
				await named(dialog, 'spinbutton', text.margin).fill('6.25');
				await named(dialog, 'spinbutton', text.opacity).fill('50');
			}
			const pending = page.waitForEvent('download'); await keyboard(page, save); const download = await pending;
			const bytes = await readFile(await download.path());
			await expect(dialog.locator(`[data-photo-${format}-export-receipt]`)).toBeVisible();
			await expect(save).toBeEnabled(); await expect(dialog.getByRole('alert')).toHaveCount(0);
			// Private faces must retire after codec and borrowed-frame settlement.
			expect(await page.evaluate(() => [...document.fonts].filter(face => face.family.startsWith('scape-export-text-')).length)).toBe(0);
			await keyboard(page, named(footer, 'button', output.close)); await expect(dialog).toHaveCount(0);
			return { name: download.suggestedFilename(), bytes };
		}
	});
}

/** Independent literal H topology and linear-light white-at-50% oracle.
 * A readable H has two vertical strokes and one middle crossbar; no renderer,
 * font helper or serializer supplies its expected pixels. */
function assertReadableH(frame, tolerance) {
	expect([frame.width, frame.height]).toEqual([64, 64]);
	const pixel = (x, y) => [...frame.rgb.subarray((y * 64 + x) * 3, (y * 64 + x) * 3 + 3)];
	const inkRows = [], spans = [], inkLevels = [];
	let maximum = 0, maximumGrayDifference = 0, maximumMargin = 0;
	for (let y = 0; y < 64; y++) {
		const runs = []; let start = -1;
		for (let x = 0; x < 64; x++) {
			const rgb = pixel(x, y); maximum = Math.max(maximum, ...rgb);
			maximumGrayDifference = Math.max(maximumGrayDifference, Math.max(...rgb) - Math.min(...rgb));
			// margin 4px, available 56px × width 50% = 28px at bottom right.
			if (x < 30 || x >= 62 || y >= 62) maximumMargin = Math.max(maximumMargin, ...rgb);
			const ink = rgb[0] > 150;
			if (ink) inkLevels.push(rgb[0]);
			if (ink && start === -1) start = x;
			if (!ink && start !== -1) { runs.push([start, x]); start = -1; }
		}
		if (start !== -1) runs.push([start, 64]);
		if (runs.length) { inkRows.push(y); spans.push(runs); }
	}
	// Aggregate the same every-pixel predicates without a matcher step per channel.
	expect(maximumGrayDifference).toBeLessThanOrEqual(tolerance);
	expect(maximumMargin).toBeLessThanOrEqual(tolerance);
	// Native JPEG quantization overshoots at sharp edges. Its stroke plateau
	// carries the composited color; PNG keeps the exact peak-value oracle.
	inkLevels.sort((left, right) => left - right); expect(inkLevels.length).toBeGreaterThan(0);
	const color = tolerance === 0 ? maximum : inkLevels[Math.floor(inkLevels.length / 2)];
	expect(Math.abs(color - 188)).toBeLessThanOrEqual(tolerance);
	expect(inkRows.length).toBeGreaterThanOrEqual(20); expect(inkRows.at(-1)).toBeLessThanOrEqual(59);
	const upper = spans[Math.floor(spans.length / 4)], lower = spans[Math.floor(spans.length * 3 / 4)];
	expect(upper).toHaveLength(2); expect(lower).toHaveLength(2);
	expect(spans.slice(Math.floor(spans.length / 3), Math.ceil(spans.length * 2 / 3)).some(runs => runs.length === 1 && runs[0][1] - runs[0][0] >= 20)).toBe(true);
}

async function decode(bytes, format) {
	if (format === 'jpeg') {
		expect([...bytes.subarray(0, 2)]).toEqual([255, 216]); expect([...bytes.subarray(-2)]).toEqual([255, 217]);
		return decodePinnedJpegRgbFrame(bytes);
	}
	expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	const compressed = []; let offset = 8;
	while (offset < bytes.length) {
		const size = bytes.readUInt32BE(offset), end = offset + size + 12;
		expect(end).toBeLessThanOrEqual(bytes.length);
		const type = bytes.toString('ascii', offset + 4, offset + 8), data = bytes.subarray(offset + 8, end - 4);
		expect(bytes.readUInt32BE(end - 4)).toBe(crc32(bytes.subarray(offset + 4, end - 4)));
		if (type === 'IHDR') expect([...data]).toEqual([0, 0, 0, 64, 0, 0, 0, 64, 8, 6, 0, 0, 0]);
		else if (type === 'IDAT') compressed.push(data);
		else if (type === 'sRGB') expect([...data]).toEqual([0]);
		else { expect(type).toBe('IEND'); expect(size).toBe(0); }
		offset = end;
	}
	expect(offset).toBe(bytes.length);
	const rows = inflateSync(Buffer.concat(compressed), { maxOutputLength: 64 * 257 });
	expect(rows.length).toBe(64 * 257);
	const rgba = new Uint8Array(64 * 256), rgb = new Uint8Array(64 * 64 * 3);
	for (let y = 0; y < 64; y++) {
		const filter = rows[y * 257]; expect(filter).toBeGreaterThanOrEqual(0); expect(filter).toBeLessThanOrEqual(4);
		for (let x = 0; x < 256; x++) {
			const left = x >= 4 ? rgba[y * 256 + x - 4] : 0, up = y ? rgba[(y - 1) * 256 + x] : 0, diagonal = y && x >= 4 ? rgba[(y - 1) * 256 + x - 4] : 0;
			const prediction = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, diagonal);
			rgba[y * 256 + x] = (rows[y * 257 + x + 1] + prediction) & 255;
		}
	}
	let maximumAlphaError = 0;
	for (let i = 0; i < 64 * 64; i++) {
		maximumAlphaError = Math.max(maximumAlphaError, Math.abs(rgba[i * 4 + 3] - 255));
		rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
	}
	expect(maximumAlphaError).toBe(0);
	return { width: 64, height: 64, rgb };
}
function paeth(a, b, c) { const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c); return da <= db && da <= dc ? a : db <= dc ? b : c; }
function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
async function open(page, locale) {
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`); const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
	return { app, copy: bundledLightscaperEditorCopyForLocale(locale) };
}
async function observe(page, photoId) {
	await installNativeOpfsWorkerCompanion(page);
	const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('../helpers/', import.meta.url)), contents: `export { readResidentPhotoLibraryCurrent } from './lightscaper-current-app-fixture.tsx';` },
		bundle: true, write: false, format: 'esm', platform: 'browser', loader: { '.woff2': 'dataurl' } });
	await page.route('**/__text_export_observer.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
	const result = await page.evaluate(async id => (await import(new URL('/__text_export_observer.js', location.href).href))
		.readResidentPhotoLibraryCurrent([id], indexedDB, () => globalThis.__assertNativeOpfsWorkerExecution()), photoId);
	await assertNativeOpfsWorkerExecution(page); return result;
}
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
async function menu(page, app, name) { await keyboard(page, app.locator('summary').filter({ hasText: new RegExp(`^${name}$`, 'u') })); }
async function toggle(page, control, checked) {
	await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused();
	if (await control.isChecked() !== checked) await page.keyboard.press('Space');
	if (checked) await expect(control).toBeChecked(); else await expect(control).not.toBeChecked();
}
async function choose(page, combo, value) {
	await expect(combo).toBeVisible(); await expect(combo).toBeEnabled();
	await expect.poll(() => combo.locator('option').evaluateAll((options, value) => options.some(option => option.value === value), value)).toBe(true);
	const index = await combo.locator('option').evaluateAll((options, value) => options.findIndex(option => option.value === value), value);
	expect(index).toBeGreaterThanOrEqual(0); expect(index).toBeLessThan(64);
	await combo.focus(); await expect(combo).toBeFocused(); await page.keyboard.press('Home');
	for (let step = 0; step < index; step++) await page.keyboard.press('ArrowDown'); await expect(combo).toHaveValue(value);
}
