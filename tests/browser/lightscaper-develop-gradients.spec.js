/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoDevelopSettingsCopy } from '../../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopLocalAdjustmentsCopy } from '../../src/common/i18n/lightscaper-develop-local-adjustments-copy.ts';
import { photoPngExportCopy } from '../../src/common/i18n/lightscaper-photo-png-export-copy.ts';
import { photoPngExportMenuLabel } from '../../src/common/i18n/lightscaper-photo-png-export-menu-copy.ts';
import { expect, test, installNativeImageHandoffRuntime, observeNativeImageHandoffLibrary } from './helpers/lightscaper-image-handoff-native-fixture.js';

const NAME = 'Gradient original.png', RGB = [64, 128, 192];
/** @type {Array<{ kind: 'linear-gradient' | 'radial-gradient'; width: number; cropWidth: string; cropX: string; coverage: number[] }>} */
const CASES = [
	{ kind: 'linear-gradient', width: 4, cropWidth: '0.5', cropX: '0.25', coverage: [96, 159] },
	{ kind: 'radial-gradient', width: 5, cropWidth: '0.6', cropX: '0.2', coverage: [153, 255, 153] },
];

for (const scenario of CASES) for (const locale of ['en', 'de']) test(`${locale}: ${scenario.kind} keyboard authoring retains saved mask and actual overlay through geometry, reload and PNG export`, async ({ page, browserName }) => {
	const originalPixels = Array.from({ length: scenario.width }, () => [...RGB, 255]).flat();
	const png = pngFixture(scenario.width, originalPixels), expected = scenario.coverage.flatMap(coverage => [...maskedRgb(coverage), 255]);
	const outputExtent = [scenario.coverage.length, 1];
	test.skip(browserName === 'webkit', 'Native WebKit catalog qualification is deferred by the roadmap.');
	test.setTimeout(90_000);
	const errors = []; page.on('pageerror', error => { errors.push(error.message); });
	await installNativeImageHandoffRuntime(page);
	const origin = browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`);
	const copy = bundledLightscaperEditorCopyForLocale(locale), words = photoDevelopCopy(locale);
	const settings = photoDevelopSettingsCopy(locale), local = photoDevelopLocalAdjustmentsCopy(locale, scenario.kind);
	const app = named(page, 'region', 'Lightscaper'); await expect(app).toBeVisible();
	await expect(named(app, 'button', local.menu)).toHaveCount(0);
	await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', copy.photoImportPhotos));
	const importer = named(page, 'dialog', copy.photoImportPhotos);
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: NAME, mimeType: 'image/png', buffer: png });
	await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
	await expect(app.locator('[data-photo-library]')).toHaveAttribute('aria-busy', 'false');
	const card = app.getByRole('button', { name: /^Gradient original\.png/u });
	await keyboard(page, card); const photoId = await card.getAttribute('data-photo-id'); expect(photoId).toBeTruthy();
	const original = await observeNativeImageHandoffLibrary(page, [photoId]);
	expect(original.photos[0].bytes).toEqual([...png]);
	await openDevelop();
	const develop = named(page, 'dialog', `${words.title}: ${NAME}`), after = named(develop, 'img', words.after);
	await expect(named(develop, 'region', words.preview)).toHaveAttribute('data-state', 'ready');
	expect(await canvasPixels(named(develop, 'img', words.before))).toEqual(originalPixels);
	await choose(named(develop, 'combobox', words.choose), 'tone-ladder-v1'); await keyboard(page, named(develop, 'button', words.add));
	await number('videoEffectParamExposure', '1');
	await choose(named(develop, 'combobox', words.choose), 'develop-geometry-v1'); await keyboard(page, named(develop, 'button', words.add));
	await number('videoEffectParamCropWidth', scenario.cropWidth); await number('videoEffectParamCropX', scenario.cropX);
	await expect.poll(() => after.evaluate(canvas => [canvas.width, canvas.height])).toEqual(outputExtent);
	await keyboard(page, develop.getByText(settings.menu, { exact: true })); await keyboard(page, named(develop, 'button', local.menu));
	const gradient = named(page, 'dialog', local.title); await expect(gradient).toBeVisible();
	const fields = scenario.kind === 'linear-gradient'
		? [[local.startX, '0'], [local.startY, '0'], [local.endX, '1'], [local.endY, '0']]
		: [[local.centerX, '0.5'], [local.centerY, '0.5'], [local.radiusX, '0.5'], [local.radiusY, '0.5'], [local.innerFraction, '0']];
	for (const [label, value] of fields) {
		await named(gradient, 'spinbutton', label).fill(value);
	}
	await keyboardCheck(page, named(gradient, 'checkbox', `${local.bind}: ${words.shared.videoEffectToneLadder} (1)`));
	await keyboardCheck(page, named(gradient, 'checkbox', local.showOverlay));
	const overlayEffect = named(gradient, 'combobox', local.overlayEffect);
	const effectId = await overlayEffect.locator('option').evaluateAll(options => options.find(option => option.value)?.value);
	expect(effectId).toBeTruthy(); await choose(overlayEffect, effectId);
	await keyboard(page, named(gradient, 'button', local.apply)); await expect(gradient).toHaveCount(0);
	await expect.poll(() => canvasPixels(after)).toEqual(expected);
	const overlay = named(develop, 'img', local.maskOverlay);
	await expect(overlay).toBeVisible(); await expect(overlay).toHaveAttribute('data-state', 'ready');
	expect(await overlay.evaluate(canvas => [canvas.width, canvas.height])).toEqual(outputExtent);
	const displayed = await Promise.all([after.boundingBox(), overlay.boundingBox()]);
	expect(displayed[0]).not.toBeNull(); expect(displayed[1]).toEqual(displayed[0]);
	const overlayPixels = await canvasPixels(overlay);
	expect(overlayPixels.filter((_, index) => index % 4 === 3)).toEqual(scenario.coverage);
	await keyboard(page, named(develop, 'button', words.save)); await expect(named(develop, 'button', words.save)).toBeDisabled();
	const saved = await observeNativeImageHandoffLibrary(page, [photoId]);
	expect(saved.photos[0].photo.versions[0].develop.maskBindings).toHaveLength(1);
	expect(saved.photos[0].photo.versions[0].develop.masks[0].nodes[0].kind).toBe(scenario.kind);
	expect(saved.photos[0].bytes).toEqual(original.photos[0].bytes);
	await keyboard(page, named(develop, 'button', words.close).last()); await expect(develop).toHaveCount(0);
	await page.reload(); await expect(app).toBeVisible();
	await menu(page, app, copy.photoViewMenu); await keyboard(page, named(app, 'button', copy.photoShowLibrary));
	await keyboard(page, app.getByRole('button', { name: /^Gradient original\.png/u })); await openDevelop();
	await expect.poll(() => canvasPixels(after)).toEqual(expected);
	await expect(named(develop, 'img', local.maskOverlay)).toHaveCount(0);
	await keyboard(page, named(develop, 'button', words.close).last()); await expect(develop).toHaveCount(0);
	await installDestination(page);
	try {
		await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', photoPngExportMenuLabel(locale)));
		const exportWords = photoPngExportCopy(locale), exporter = named(page, 'dialog', exportWords.title);
		await keyboard(page, named(exporter, 'button', exportWords.save));
		await expect(exporter.locator('[data-photo-png-export-receipt]')).toHaveAttribute('data-photo-png-export-status', 'saved');
		const bytes = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await (await globalThis.__gradientDestination.file()).arrayBuffer()))));
		expect(decodedPng(bytes, scenario.coverage.length)).toEqual(expected);
		await keyboard(page, named(exporter, 'button', exportWords.close).last());
		expect(await observeNativeImageHandoffLibrary(page, [photoId])).toEqual(saved);
		expect(saved.photos[0].photo.original.contentSha256).toBe(createHash('sha256').update(png).digest('hex'));
		expect(errors).toEqual([]);
	} finally { await page.evaluate(() => globalThis.__gradientDestination.retire()); }

	async function openDevelop() {
		await menu(page, app, copy.photoFileMenu); await menu(page, app, copy.photoPhotoMenu);
		await keyboard(page, named(app, 'button', photoDevelopMenuLabel(locale)));
	}
	async function number(key, value) {
		const control = named(develop, 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared[key]}`);
		await control.fill(value); await control.press('Enter');
	}
});

function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
async function keyboardCheck(page, control) { await expect(control).not.toBeChecked(); await control.focus(); await expect(control).toBeFocused();
	await page.keyboard.press('Space'); await expect(control).toBeChecked(); }
async function menu(page, app, label) { await keyboard(page, app.getByRole('navigation').getByText(label, { exact: true })); }
async function choose(control, value) { await expect(control).toBeEnabled(); await control.selectOption(value); }
function canvasPixels(canvas) { return canvas.evaluate(canvas => canvas.width && canvas.height
	? Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data) : []); }
function maskedRgb(coverage) {
	const decode = value => { const n = value / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; };
	const encode = value => Math.round(255 * (value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055));
	return RGB.map((value, channel) => encode(decode(value) * (1 - coverage / 255) + decode([90, 176, 255][channel]) * coverage / 255));
}
function pngFixture(width, pixels) {
	const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('sRGB', Buffer.from([0])),
		chunk('IDAT', deflateSync(Buffer.from([0, ...pixels]))), chunk('IEND', Buffer.alloc(0))]);
}
function chunk(kind, data) {
	const body = Buffer.concat([Buffer.from(kind), data]), prefix = Buffer.alloc(4), suffix = Buffer.alloc(4);
	prefix.writeUInt32BE(data.length); suffix.writeUInt32BE(crc32(body)); return Buffer.concat([prefix, body, suffix]);
}
function crc32(bytes) {
	let value = 0xffffffff;
	for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); }
	return (value ^ 0xffffffff) >>> 0;
}
function decodedPng(bytes, width) {
	const compressed = [];
	for (let offset = 8; offset < bytes.length;) {
		const size = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8), end = offset + size + 12;
		expect(bytes.readUInt32BE(end - 4)).toBe(crc32(bytes.subarray(offset + 4, end - 4)));
		if (kind === 'IHDR') expect([...bytes.subarray(offset + 8, end - 4)]).toEqual([0, 0, 0, width, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
		if (kind === 'IDAT') compressed.push(bytes.subarray(offset + 8, end - 4)); offset = end;
	}
	const row = inflateSync(Buffer.concat(compressed)); expect(row[0]).toBe(0); return [...row.subarray(1)];
}
async function installDestination(page) {
	await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory(), name = `gradient-export-${crypto.randomUUID()}`;
		const directory = await root.getDirectoryHandle(name, { create: true }), handle = await directory.getFileHandle('Gradient original.png', { create: true });
		const previous = globalThis.showSaveFilePicker;
		globalThis.showSaveFilePicker = async () => handle;
		globalThis.__gradientDestination = { file: () => handle.getFile(), async retire() {
			globalThis.showSaveFilePicker = previous; await root.removeEntry(name, { recursive: true });
		} };
	});
}
