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
import { photoDevelopRawDevelopmentCopy } from '../../src/common/i18n/lightscaper-raw-development-copy.ts';
import { photoDevelopSoftProofCopy } from '../../src/common/i18n/lightscaper-develop-soft-proof-copy.ts';
import { photoPngExportCopy } from '../../src/common/i18n/lightscaper-photo-png-export-copy.ts';
import { photoPngExportMenuLabel } from '../../src/common/i18n/lightscaper-photo-png-export-menu-copy.ts';
import { photoRasterDepthCopy } from '../../src/common/i18n/lightscaper-photo-raster-depth-copy.ts';
import { photoRasterProfileCopy } from '../../src/common/i18n/lightscaper-photo-raster-profile-copy.ts';
import { rawRecoveryDngFixtureV1 } from '../helpers/lightscaper-raw-recovery-dng-current-fixture.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';

test.use({ browserCoverage: false });
const PROGRAM = '/__lightscaper_display_p3_custody.js', NAME = 'P3 recovered output.dng';
let program;
const binaries = [];
test.beforeAll(async () => {
	for (const name of ['lightscaper-libraw-runtime-manifest.json', 'lightscaper-libraw-recovery-runtime-manifest.json']) {
		const manifest = JSON.parse(await readFile(new URL(`../../config/${name}`, import.meta.url), 'utf8'));
		const bytes = await readFile(new URL(`../../${manifest.runtime.path}`, import.meta.url));
		expect(bytes.length).toBe(manifest.runtime.byteLength); expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.runtime.sha256);
		binaries.push({ url: manifest.runtime.url, bytes });
	}
	program = await compileNativeImageHandoffScript('display-p3-custody.js', fileURLToPath(new URL('./helpers/lightscaper-raw-development-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});

for (const locale of ['en', 'de']) test(`${locale}: menu-owned soft proof and real recovered RAW P3 PNG8/16 preserve native custody`, async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'This bounded RAW workflow qualifies Chromium and Firefox.'); test.setTimeout(240_000);
	const copy = bundledLightscaperEditorCopyForLocale(locale), develop = photoDevelopCopy(locale), settings = photoDevelopSettingsCopy(locale, 'current3');
	const raw = photoDevelopRawDevelopmentCopy(locale), proof = photoDevelopSoftProofCopy(locale), png = photoPngExportCopy(locale);
	const depth = photoRasterDepthCopy(locale), profile = photoRasterProfileCopy(locale), errors = [], downloads = [];
	page.on('pageerror', error => { errors.push(error.message); }); page.on('download', download => { downloads.push(download); });
	await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
	for (const binary of binaries) await page.route(binary.url, route => route.fulfill({ status: 200, headers: {
		'content-type': 'application/wasm', 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin',
	}, body: binary.bytes }));
	await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	await page.goto(resolveBrowserProductTestUrl(`/lightscaper/${locale}/`));
	const app = named(page, 'region', 'Lightscaper'); await expect(app).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(copy.photoFileMenu); await keyboard(named(app, 'button', copy.photoImportPhotos)); const importer = named(page, 'dialog', copy.photoImportPhotos);
	const original = Buffer.from(rawRecoveryDngFixtureV1({ orientation: 6 }).bytes);
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: NAME, mimeType: 'image/png', buffer: original });
	await keyboard(named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
	const card = app.getByRole('button', { name: /^P3 recovered output\.dng/u }); await expect(card).toHaveCount(1);
	await expect(named(app, 'region', bundledSiteCopyForLocale(locale).workspacePhoto)).toHaveAttribute('aria-busy', 'false'); await keyboard(card);
	const photoId = await card.getAttribute('data-photo-id'); expect(photoId).toBeTruthy(); const initial = await observe();
	expect(initial.bytes).toEqual([...original]); expect(initial.original.sha256).toBe(createHash('sha256').update(original).digest('hex'));
	await openDevelop(); const editing = named(page, 'dialog', `${develop.title}: ${NAME}`), preview = editing.locator('[data-photo-develop-preview]');
	await expect(preview).toHaveAttribute('data-state', 'ready'); await settingsMenu(); await keyboard(named(editing, 'button', raw.menu));
	const processing = named(page, 'dialog', raw.title); await named(processing, 'combobox', raw.mode).selectOption('recovery');
	await keyboard(named(processing, 'button', raw.apply)); await expect(processing).toHaveCount(0);
	await named(editing, 'combobox', develop.choose).selectOption('tone-ladder-v1'); await keyboard(named(editing, 'button', develop.add));
	const exposure = named(editing, 'spinbutton', `${develop.shared.videoEffectExactValue}: ${develop.shared.videoEffectParamExposure}`);
	await exposure.fill('-1'); await exposure.press('Enter'); await expect(preview).toHaveAttribute('data-state', 'ready');
	await keyboard(named(editing, 'button', develop.save)); await expect(editing.locator('[data-photo-develop-ack]')).toBeVisible();
	await expect(named(editing, 'button', develop.save)).toBeDisabled(); const saved = await observe();
	expect(saved.bytes).toEqual(initial.bytes); expect(saved.original).toEqual(initial.original); expect(saved.native).toEqual(initial.native);
	const native = initial.native.recovery.samples.map((value, index) => index % 4 === 3 ? value : Math.fround(value * .5));
	const canonical = initial.native.canonical.words.map(value => value / 65535), srgb = target(native, 'srgb', 8);
	const before = named(editing, 'img', develop.before), after = named(editing, 'img', develop.after);
	await ready(srgb, 'srgb'); await expect(editing.locator('[data-photo-develop-soft-proof-profile]')).toHaveCount(0);
	for (const bitDepth of [8, 16]) {
		await openProof(); const dialog = named(page, 'dialog', proof.title);
		await dialog.locator('[data-photo-develop-soft-proof-profile]').selectOption('display-p3');
		await dialog.locator('[data-photo-develop-soft-proof-depth]').selectOption(String(bitDepth)); await keyboard(named(dialog, 'button', proof.apply));
		if (browserName === 'firefox') {
			await expect(dialog.getByRole('alert')).toHaveText(proof.unavailable); await expect(dialog).toBeVisible(); await ready(srgb, 'srgb');
			await dialog.locator('[data-photo-develop-soft-proof-profile]').selectOption('srgb'); await keyboard(named(dialog, 'button', proof.apply));
			await expect(dialog).toHaveCount(0); await ready(project(target(native, 'srgb', bitDepth), bitDepth), 'srgb');
		} else { await expect(dialog).toHaveCount(0); await ready(project(target(native, 'display-p3', bitDepth), bitDepth), 'display-p3'); }
		expect(await observe()).toEqual(saved); await expect(named(editing, 'button', develop.save)).toBeDisabled();
		await openProof(); const off = named(page, 'dialog', proof.title); await off.locator('[data-photo-develop-soft-proof-profile]').selectOption('off');
		await keyboard(named(off, 'button', proof.apply)); await expect(off).toHaveCount(0); await ready(srgb, 'srgb'); expect(await observe()).toEqual(saved);
	}
	await close(editing, develop);
	for (const bitDepth of [8, 16]) for (const scope of ['strip', 'capture']) {
		await menu(copy.photoFileMenu); await keyboard(named(app, 'button', photoPngExportMenuLabel(locale))); const output = named(page, 'dialog', png.title);
		await named(output, 'combobox', profile.label).selectOption('display-p3'); await named(output, 'combobox', depth.label).selectOption(String(bitDepth));
		await named(output, 'combobox', png.metadata).selectOption(scope); const count = downloads.length + 1; await keyboard(named(output, 'button', png.save));
		await expect(output.locator('[data-photo-png-export-receipt]')).toHaveAttribute('data-photo-png-export-status', 'download-started');
		await expect.poll(() => downloads.length).toBe(count); expect(await downloads.at(-1).failure()).toBeNull();
		const bytes = await readFile(await downloads.at(-1).path()), decoded = readPng(bytes, bitDepth);
		expect(decoded.samples).toEqual(target(native, 'display-p3', bitDepth)); expect(decoded.exif).toBe(scope === 'capture');
		await close(output, png); expect(await observe()).toEqual(saved);
	}
	await page.reload(); await expect(app).toBeVisible(); await menu(copy.photoViewMenu); await keyboard(named(app, 'button', copy.photoShowLibrary));
	await expect(card).toHaveCount(1); await keyboard(card); await openDevelop(); await ready(srgb, 'srgb'); expect(await observe()).toEqual(saved);
	await openProof(); await expect(named(page, 'dialog', proof.title).locator('[data-photo-develop-soft-proof-profile]')).toHaveValue('off');
	await close(named(page, 'dialog', proof.title), proof); await close(editing, develop); expect(errors).toEqual([]);

	async function keyboard(control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
	async function menu(label) { await keyboard(app.getByRole('navigation').getByText(label, { exact: true })); }
	async function openDevelop() { await menu(copy.photoFileMenu); await menu(copy.photoPhotoMenu); await keyboard(named(app, 'button', photoDevelopMenuLabel(locale))); }
	async function settingsMenu() { const summary = editing.locator('summary').filter({ hasText: settings.menu });
		if (!await summary.locator('..').evaluate(details => details.open)) await keyboard(summary); }
	async function openProof() { await settingsMenu(); await keyboard(named(editing, 'button', proof.menu)); }
	async function close(dialog, words) { await keyboard(named(dialog, 'button', words.close).last()); await expect(dialog).toHaveCount(0); }
	async function ready(expected, colorSpace) { await expect(preview).toHaveAttribute('data-state', 'ready');
		await expect.poll(() => plane(before, 'srgb')).toEqual([96, 128, ...target(canonical, 'srgb', 8)]);
		await expect.poll(() => plane(after, colorSpace)).toEqual([96, 128, ...expected]); }
	function observe() { return page.evaluate(async ({ pathname, photoId }) => (await import(new URL(pathname, location.href).href)).readRawDevelopmentCustodyCurrentV1(photoId), { pathname: PROGRAM, photoId }); }
});

// Independent CSS Color4 rational matrices through XYZ D65, with the only
// clipping/transfer/quantization after the selected target-primary conversion.
function target(samples, profile, bitDepth) {
	const result = [], maximum = bitDepth === 8 ? 255 : 65535;
	for (let index = 0; index < samples.length; index += 4) {
		let red = samples[index], green = samples[index + 1], blue = samples[index + 2];
		if (profile === 'display-p3') {
			const x = 506752 / 1228815 * red + 87881 / 245763 * green + 12673 / 70218 * blue;
			const y = 87098 / 409605 * red + 175762 / 245763 * green + 12673 / 175545 * blue;
			const z = 7918 / 409605 * red + 87881 / 737289 * green + 1001167 / 1053270 * blue;
			red = 446124 / 178915 * x - 333277 / 357830 * y - 72051 / 178915 * z;
			green = -14852 / 17905 * x + 63121 / 35810 * y + 423 / 17905 * z;
			blue = 11844 / 330415 * x - 50337 / 660830 * y + 316169 / 330415 * z;
		}
		for (const value of [red, green, blue]) { const unit = Math.max(0, Math.min(1, value));
			result.push(Math.round(maximum * (unit <= .0031308 ? 12.92 * unit : 1.055 * unit ** (1 / 2.4) - .055))); }
		result.push(Math.round(maximum * samples[index + 3]));
	}
	return result;
}
function project(samples, bitDepth) { return bitDepth === 8 ? samples : samples.map(value => Math.round(value * 255 / 65535)); }
function plane(canvas, colorSpace) { return canvas.evaluate((node, colorSpace) => [node.width, node.height,
	...(node.width && node.height ? node.getContext('2d').getImageData(0, 0, node.width, node.height, { colorSpace }).data : [])], colorSpace); }
function named(root, role, name) { return root.getByRole(role, { name, exact: true }); }
function readPng(bytes, bitDepth) {
	expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]); const chunks = [], compressed = [];
	let at = 8;
	for (; at < bytes.length;) { const size = bytes.readUInt32BE(at), end = at + size + 12; expect(end).toBeLessThanOrEqual(bytes.length);
		const type = bytes.toString('ascii', at + 4, at + 8), data = bytes.subarray(at + 8, end - 4);
		expect(bytes.readUInt32BE(end - 4)).toBe(crc32(bytes.subarray(at + 4, end - 4))); chunks.push({ type, data }); if (type === 'IDAT') compressed.push(data); at = end; }
	expect(at).toBe(bytes.length); const names = chunks.map(chunk => chunk.type), header = chunks[0].data;
	expect(names[0]).toBe('IHDR'); expect(names.at(-1)).toBe('IEND'); expect([...header.subarray(8)]).toEqual([bitDepth, 6, 0, 0, 0]);
	expect(names.filter(name => name === 'cICP')).toHaveLength(1); expect([...chunks.find(chunk => chunk.type === 'cICP').data]).toEqual([12, 13, 0, 1]);
	expect(names.indexOf('cICP')).toBeLessThan(names.indexOf('IDAT')); expect(names.includes('sRGB')).toBe(false); expect(names.includes('iCCP')).toBe(false);
	const width = header.readUInt32BE(0), height = header.readUInt32BE(4); expect([width, height]).toEqual([96, 128]);
	const bpp = bitDepth / 2, stride = width * bpp, raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: (stride + 1) * height });
	expect(raw.length).toBe((stride + 1) * height); const pixels = Buffer.alloc(stride * height);
	for (let y = 0; y < height; y++) { expect(raw[y * (stride + 1)]).toBe(0); raw.copy(pixels, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1)); }
	const samples = bitDepth === 8 ? [...pixels] : Array.from({ length: pixels.length / 2 }, (_, index) => pixels.readUInt16BE(index * 2));
	const exif = chunks.find(chunk => chunk.type === 'eXIf'); if (exif) expect(exifColorSpace(exif.data)).toBe(65535); return { samples, exif: Boolean(exif) };
}
function exifColorSpace(tiff) { expect(tiff.toString('ascii', 0, 2)).toBe('II'); let offset = tiff.readUInt32LE(4);
	const entries = start => Array.from({ length: tiff.readUInt16LE(start) }, (_, index) => start + 2 + index * 12);
	offset = tiff.readUInt32LE(entries(offset).find(at => tiff.readUInt16LE(at) === 0x8769) + 8);
	const color = entries(offset).find(at => tiff.readUInt16LE(at) === 0xa001); expect(color).toBeDefined(); return tiff.readUInt16LE(color + 8); }
function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) { value ^= byte;
	for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
