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

const NAME = 'Color original.png';
const ORIGINAL = [0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 128, 128, 128, 255];
const COVERAGE = [255, 47, 47, 131];
// Independent linear sRGB blending against literal exposure-1 output: each
// primary255 becomes188 and gray128 becomes92. Crop removes the black pixel.
const EXPECTED = [188, 0, 0, 255, 0, 244, 0, 255, 0, 0, 244, 255, 111, 111, 111, 255];

for (const locale of ['en', 'de']) test(`${locale}: menu-authored color range follows effect-input pixels through crop, save, reload and native PNG export`, async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'Native WebKit catalog qualification is deferred by the roadmap.');
	test.setTimeout(90_000);
	const png = pngFixture(), originalSha256 = createHash('sha256').update(png).digest('hex');
	const errors = []; page.on('pageerror', error => { errors.push(error.message); });
	await installNativeImageHandoffRuntime(page);
	await page.goto(`${browserProductSiteForBuild('lightscaper').origin}/${locale}/`);
	const copy = bundledLightscaperEditorCopyForLocale(locale), words = photoDevelopCopy(locale);
	const settings = photoDevelopSettingsCopy(locale), local = photoDevelopLocalAdjustmentsCopy(locale, 'color-range');
	const app = named(page, 'region', 'Lightscaper'); await expect(app).toBeVisible();
	await expect(named(app, 'button', local.menu)).toHaveCount(0);
	await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', copy.photoImportPhotos));
	const importer = named(page, 'dialog', copy.photoImportPhotos);
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: NAME, mimeType: 'image/png', buffer: png });
	await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
	await expect(app.locator('[data-photo-library]')).toHaveAttribute('aria-busy', 'false');
	const card = app.getByRole('button', { name: /^Color original\.png/u });
	await keyboard(page, card); const photoId = await card.getAttribute('data-photo-id'); expect(photoId).toBeTruthy();
	const original = await observeNativeImageHandoffLibrary(page, [photoId]);
	expect(original.photos[0].bytes).toEqual([...png]); expect(original.photos[0].photo.original.contentSha256).toBe(originalSha256);
	await openDevelop();
	const develop = named(page, 'dialog', `${words.title}: ${NAME}`), after = named(develop, 'img', words.after);
	await expect(named(develop, 'region', words.preview)).toHaveAttribute('data-state', 'ready');
	expect(await canvasPixels(named(develop, 'img', words.before))).toEqual(ORIGINAL);
	await choose(named(develop, 'combobox', words.choose), 'tone-ladder-v1'); await keyboard(page, named(develop, 'button', words.add));
	await number('videoEffectParamExposure', '-1');
	await choose(named(develop, 'combobox', words.choose), 'develop-geometry-v1'); await keyboard(page, named(develop, 'button', words.add));
	await number('videoEffectParamCropWidth', '0.8'); await number('videoEffectParamCropX', '0.2');
	await expect.poll(() => after.evaluate(canvas => [canvas.width, canvas.height])).toEqual([4, 1]);
	await keyboard(page, develop.getByText(settings.menu, { exact: true })); await keyboard(page, named(develop, 'button', local.menu));
	const range = named(page, 'dialog', local.title); await expect(range).toBeVisible();
	await expect(named(range, 'combobox', local.gradient)).toHaveValue('');
	await expect(named(range, 'checkbox', local.showOverlay)).not.toBeChecked();
	for (const [label, initial, value] of [[local.red, '1', '1'], [local.green, '0', '0'], [local.blue, '0', '0'],
		[local.radius, '0.1', '0'], [local.falloff, '0.1', '1']]) {
		const field = named(range, 'spinbutton', label);
		await expect(field).toHaveValue(initial);
		await expect(field).toHaveAttribute('min', '0'); await expect(field).toHaveAttribute('max', '1'); await expect(field).toHaveAttribute('step', 'any');
		await field.fill(value);
	}
	await keyboardCheck(page, named(range, 'checkbox', `${local.bind}: ${words.shared.videoEffectToneLadder} (1)`));
	await keyboardCheck(page, named(range, 'checkbox', local.showOverlay));
	const overlayEffect = named(range, 'combobox', local.overlayEffect); await expect(overlayEffect).toHaveValue('');
	const effectId = await overlayEffect.locator('option').evaluateAll(options => options.find(option => option.value)?.value);
	expect(effectId).toBeTruthy(); await choose(overlayEffect, effectId);
	await keyboard(page, named(range, 'button', local.apply)); await expect(range).toHaveCount(0);
	await expect.poll(() => canvasPixels(after)).toEqual(EXPECTED);
	const overlay = named(develop, 'img', local.maskOverlay);
	await expect(overlay).toBeVisible(); await expect(overlay).toHaveAttribute('data-state', 'ready');
	expect(await overlay.evaluate(canvas => [canvas.width, canvas.height])).toEqual([4, 1]);
	const displayed = await Promise.all([after.boundingBox(), overlay.boundingBox()]);
	expect(displayed[0]).not.toBeNull(); expect(displayed[1]).toEqual(displayed[0]);
	expect((await canvasPixels(overlay)).filter((_, index) => index % 4 === 3)).toEqual(COVERAGE);
	expect(await canvasPixels(named(develop, 'img', words.before))).toEqual(ORIGINAL);
	await keyboard(page, named(develop, 'button', words.save)); await expect(named(develop, 'button', words.save)).toBeDisabled();
	const saved = await observeNativeImageHandoffLibrary(page, [photoId]), savedPhoto = saved.photos[0].photo;
	const savedVersion = savedPhoto.versions.find(version => version.id === savedPhoto.activeVersionId);
	expect(savedVersion).toBeTruthy(); const recipe = savedVersion.develop;
	expect(recipe.effects.map(effect => effect.type)).toEqual(['tone-ladder-v1', 'develop-geometry-v1']);
	expect(recipe.effects[0].id).toBe(effectId); expect(recipe.effects[0].enabled).toBe(true);
	expect(recipe.masks).toHaveLength(1); const mask = recipe.masks[0];
	expect(mask.kind).toBe('mask'); expect(mask.inputs).toEqual([]);
	expect(mask.nodes).toEqual([{ id: mask.outputNodeId, kind: 'color-range', color: { r: 1, g: 0, b: 0 }, radius: 0, falloff: 1 }]);
	expect(recipe.maskBindings).toEqual([{ effectId, maskId: mask.id }]);
	expect(savedPhoto.original).toEqual(original.photos[0].photo.original);
	expect(saved.photos[0].bytes).toEqual(original.photos[0].bytes);
	await keyboard(page, named(develop, 'button', words.close).last()); await expect(develop).toHaveCount(0);
	await page.reload(); await expect(app).toBeVisible();
	await menu(page, app, copy.photoViewMenu); await keyboard(page, named(app, 'button', copy.photoShowLibrary));
	await keyboard(page, app.getByRole('button', { name: /^Color original\.png/u })); await openDevelop();
	await expect.poll(() => canvasPixels(after)).toEqual(EXPECTED);
	await expect(named(develop, 'img', local.maskOverlay)).toHaveCount(0);
	expect(await observeNativeImageHandoffLibrary(page, [photoId])).toEqual(saved);
	await keyboard(page, named(develop, 'button', words.close).last()); await expect(develop).toHaveCount(0);
	await installDestination(page);
	try {
		await menu(page, app, copy.photoFileMenu); await keyboard(page, named(app, 'button', photoPngExportMenuLabel(locale)));
		const exportWords = photoPngExportCopy(locale), exporter = named(page, 'dialog', exportWords.title);
		await keyboard(page, named(exporter, 'button', exportWords.save));
		await expect(exporter.locator('[data-photo-png-export-receipt]')).toHaveAttribute('data-photo-png-export-status', 'saved');
		const bytes = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await (await globalThis.__colorRangeDestination.file()).arrayBuffer()))));
		expect(decodedPng(bytes)).toEqual(EXPECTED);
		await keyboard(page, named(exporter, 'button', exportWords.close).last());
		expect(await observeNativeImageHandoffLibrary(page, [photoId])).toEqual(saved);
		expect(createHash('sha256').update(Buffer.from(saved.photos[0].bytes)).digest('hex')).toBe(originalSha256);
		expect(errors).toEqual([]);
	} finally { await page.evaluate(() => globalThis.__colorRangeDestination.retire()); }

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
function pngFixture() {
	const header = Buffer.alloc(13); header.writeUInt32BE(5); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('sRGB', Buffer.from([0])),
		chunk('IDAT', deflateSync(Buffer.from([0, ...ORIGINAL]))), chunk('IEND', Buffer.alloc(0))]);
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
function decodedPng(bytes) {
	expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	const compressed = []; let headerSeen = false, endSeen = false;
	for (let offset = 8; offset < bytes.length;) {
		const size = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8), end = offset + size + 12;
		expect(end).toBeLessThanOrEqual(bytes.length); expect(bytes.readUInt32BE(end - 4)).toBe(crc32(bytes.subarray(offset + 4, end - 4)));
		if (kind === 'IHDR') { expect(headerSeen).toBe(false); headerSeen = true;
			expect([...bytes.subarray(offset + 8, end - 4)]).toEqual([0, 0, 0, 4, 0, 0, 0, 1, 8, 6, 0, 0, 0]); }
		if (kind === 'IDAT') compressed.push(bytes.subarray(offset + 8, end - 4));
		if (kind === 'IEND') { expect(size).toBe(0); expect(end).toBe(bytes.length); endSeen = true; }
		offset = end;
	}
	expect(headerSeen).toBe(true); expect(endSeen).toBe(true); expect(compressed.length).toBeGreaterThan(0);
	const row = inflateSync(Buffer.concat(compressed)); expect(row.length).toBe(17); expect(row[0]).toBe(0); return [...row.subarray(1)];
}
async function installDestination(page) {
	await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory(), name = `color-range-export-${crypto.randomUUID()}`;
		const directory = await root.getDirectoryHandle(name, { create: true }), handle = await directory.getFileHandle('Color original.png', { create: true });
		const previous = globalThis.showSaveFilePicker;
		globalThis.showSaveFilePicker = async () => handle;
		globalThis.__colorRangeDestination = { file: () => handle.getFile(), async retire() {
			globalThis.showSaveFilePicker = previous; await root.removeEntry(name, { recursive: true });
		} };
	});
}
