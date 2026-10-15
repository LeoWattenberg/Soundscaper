/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoDevelopSettingsCopy } from '../../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { pngChunk } from '../helpers/image-metadata-fixtures.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';

test.use({ browserCoverage: false });
const PROGRAM = '/__lightscaper_optical_native.js', NAME = 'Optical vignette reference.png';
const SOURCE = [64, 32, 16, 255, 64, 32, 16, 255, 64, 32, 16, 255];
// Each3×1 side has r²=.4 and gain2^.8 (or2^-.8). Decode/gain/encode
// before the sole byte rounding gives these independent color literals.
const DEVELOPED = [84, 44, 24, 255, 64, 32, 16, 255, 84, 44, 24, 255],
	ATTENUATED = [48, 23, 10, 255, 64, 32, 16, 255, 48, 23, 10, 255];
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', Buffer.from([0, 0, 0, 3, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
	pngChunk('sRGB', Buffer.from([0])), pngChunk('IDAT', deflateSync(Buffer.from([0, ...SOURCE]))), pngChunk('IEND', Buffer.alloc(0))]);
let program;
test.beforeAll(async () => {
	program = await compileNativeImageHandoffScript('optical-vignette-reference.js', fileURLToPath(new URL('./helpers/lightscaper-optical-vignette-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});

for (const locale of ['en', 'de']) test(`${locale}: Photo menu authors optical vignette with Escape, Save, history, Full/Fit, reload and unchanged native Original custody`, async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'The native OPFS Photo workflow qualifies Chromium and Firefox.'); test.setTimeout(120_000);
	const copy = bundledLightscaperEditorCopyForLocale(locale), words = photoDevelopCopy(locale), settings = photoDevelopSettingsCopy(locale, 'current3'), errors = [];
	page.on('pageerror', error => { errors.push(error.message); }); await prepare(page, locale);
	const app = named(page, 'region', 'Lightscaper'); await expect(app).toBeVisible();
	await menu(copy.photoFileMenu); await keyboard(page, named(app, 'button', copy.photoImportPhotos));
	const importer = named(page, 'dialog', copy.photoImportPhotos); await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: NAME, mimeType: 'image/png', buffer: PNG });
	await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
	const library = app.locator('[data-photo-library]'), card = library.locator('[data-photo-id]'); await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false');
	const photoId = await card.getAttribute('data-photo-id'); expect(photoId).toBeTruthy(); const initial = await custody();
	expect(initial.original.sha256).toBe(createHash('sha256').update(PNG).digest('hex')); expect(initial.bytes).toEqual([...PNG]);
	await keyboard(page, card); await open();
	const dialog = named(page, 'dialog', `${words.title}: ${NAME}`), preview = dialog.locator('[data-photo-develop-preview]'), history = named(dialog, 'combobox', words.history);
	await painted(SOURCE); await expect(history).toHaveValue('0');
	const chooser = named(dialog, 'combobox', words.choose), choices = await chooser.locator('option').evaluateAll(options => options.map(option => option.value));
	expect(choices).toContain('optical-vignette-v1'); await chooser.focus(); await page.keyboard.press('Home');
	for (let index = 0; index < choices.indexOf('optical-vignette-v1'); index++) await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Tab'); await expect(chooser).toHaveValue('optical-vignette-v1'); await keyboard(page, named(dialog, 'button', words.add));
	const amount = named(dialog, 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectOpticalVignetteAmount}`);
	await expect(amount).toHaveValue('0'); await amount.fill('45'); await amount.press('Escape'); await expect(amount).toHaveValue('0'); await painted(SOURCE);
	await amount.fill('-100'); await amount.press('Enter'); await painted(ATTENUATED);
	await amount.fill('100'); await amount.press('Enter'); await painted(DEVELOPED);
	await expect(history).toHaveValue('0'); expect((await custody()).photo).toEqual(initial.photo);
	await keyboard(page, named(dialog, 'button', words.save)); await expect(dialog.locator('[data-photo-develop-ack]')).toContainText(words.acknowledged);
	await expect(named(dialog, 'button', words.save)).toBeDisabled(); await expect(history).toHaveValue('1'); await painted(DEVELOPED);
	const saved = await custody(); unchanged(saved, 1); const version = active(saved.photo);
	expect(version.develop.effects).toHaveLength(1); expect(version.develop.effects[0]).toMatchObject({ type: 'optical-vignette-v1', enabled: true, params: { amount: 100 } });
	expect({ ...version.develop, effects: active(initial.photo).develop.effects }).toEqual(active(initial.photo).develop);
	expect(version.workspace.cursor).toBe(1); expect(version.workspace.entries).toHaveLength(2); expect(version.workspace.snapshots).toEqual([]);
	await resolution('full'); await painted(DEVELOPED); await expect(named(dialog, 'region', words.imageViewport)).toBeVisible();
	await resolution('proxy'); await painted(DEVELOPED); await expect(named(dialog, 'region', words.imageViewport)).toHaveCount(0); expect(await custody()).toEqual(saved);
	await history.focus(); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Tab'); await expect(history).toHaveValue('0'); await painted(SOURCE);
	const undone = await custody(); unchanged(undone, 2); expect(active(undone.photo).develop).toEqual(active(initial.photo).develop);
	await history.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Tab'); await expect(history).toHaveValue('1'); await painted(DEVELOPED);
	const restored = await custody(); unchanged(restored, 3); expect(active(restored.photo)).toEqual(version);
	await close(); await page.reload(); await expect(app).toBeVisible(); await menu(copy.photoViewMenu); await keyboard(page, named(app, 'button', copy.photoShowLibrary));
	await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false'); await keyboard(page, card); await open();
	await expect(history).toHaveValue('1'); await expect(amount).toHaveValue('100'); await painted(DEVELOPED);
	await expect(dialog.locator('[data-resolution]')).toHaveAttribute('data-resolution', 'proxy'); expect(await custody()).toEqual(restored); await expect(dialog.getByRole('alert')).toHaveCount(0);
	await close(); expect(errors).toEqual([]);

	async function menu(label) { await keyboard(page, app.getByRole('navigation').getByText(label, { exact: true })); }
	async function open() { await menu(copy.photoFileMenu); await menu(copy.photoPhotoMenu); await keyboard(page, named(app, 'button', photoDevelopMenuLabel(locale))); }
	async function close() { await keyboard(page, named(dialog.locator('.lightscaper-develop-actions'), 'button', words.close)); await expect(dialog).toHaveCount(0); }
	async function painted(expected) { await expect(preview).toHaveAttribute('data-state', 'ready'); await expectPixels(named(dialog, 'img', words.before), SOURCE); await expectPixels(named(dialog, 'img', words.after), expected); }
	async function resolution(value) {
		const summary = dialog.locator('summary').filter({ hasText: new RegExp(`^${escape(settings.menu)}$`, 'u') });
		if (!await summary.evaluate(node => node.parentElement.open)) await keyboard(page, summary);
		await keyboard(page, named(dialog, 'button', value === 'full' ? words.fullResolution : words.fitResolution)); await expect(dialog.locator('[data-resolution]')).toHaveAttribute('data-resolution', value);
	}
	async function custody() { const value = await helper(page, 'readOpticalPhotoCustodyCurrentV1', [photoId]); expect(value.photos).toHaveLength(1); expect(value.bodies).toEqual([]); return { namespace: value.namespace, ...value.photos[0] }; }
	function unchanged(value, delta) {
		expect(value.namespace).toBe(initial.namespace); expect(value.original).toEqual(initial.original); expect(value.bytes).toEqual(initial.bytes);
		expect(value.photo.revision).toBe(initial.photo.revision + delta); expect({ ...value.photo, revision: initial.photo.revision, versions: initial.photo.versions }).toEqual(initial.photo);
	}
});

test('Native WebGL2 optical37 matches independent linear-light gain literals and exactly retains black, center and transparent hidden color', async ({ page, browserName }) => {
	test.setTimeout(90_000); await prepare(page, 'en'); await nativeCapability(page, browserName);
	const source = [64, 32, 16, 1, 64, 32, 16, 127, 64, 32, 16, 255];
	for (const [amount, expected] of [[100, [84, 44, 24, 1, 64, 32, 16, 127, 84, 44, 24, 255]],
		[-100, [48, 23, 10, 1, 64, 32, 16, 127, 48, 23, 10, 255]]]) {
		const result = await qualify(page, source, 3, 1, amount); nativeFacts(result, source, true); expect(result.pixels).toEqual(expected);
	}
	for (const source of [[0, 0, 0, 255, 0, 0, 0, 127, 0, 0, 0, 1], [47, 31, 7, 0, 64, 32, 16, 127, 15, 9, 140, 0]]) {
		for (const amount of [-100, 100]) { const result = await qualify(page, source, 3, 1, amount); nativeFacts(result, source, true); expect(result.pixels).toEqual(source); }
	}
	const center = [64, 32, 16, 127], result = await qualify(page, center, 1, 1, 100); nativeFacts(result, center, true); expect(result.pixels).toEqual(center);
});

test('Native WebGL2 optical37 matches independent continuous radial gain over varied alpha and fractional Amount', async ({ page, browserName }) => {
	test.setTimeout(90_000); await prepare(page, 'en'); await nativeCapability(page, browserName);
	const width = 9, height = 7, source = Array.from({ length: width * height }, (_, n) => [(n * 37 + 47) % 256, (n * 59 + 31) % 256, (n * 101 + 7) % 256,
		n === 0 || n === width * height - 1 ? 0 : n * 41 % 256]).flat();
	for (const [amount, enabled] of [[100, true], [-100, true], [37.125, true], [-22.5, true], [0, true], [100, false]]) {
		const expected = opticalOracle(source, width, height, amount, enabled), result = await qualify(page, source, width, height, amount, enabled);
		nativeFacts(result, source, enabled && amount !== 0); expect(result.pixels).toHaveLength(expected.length);
		for (let index = 0; index < expected.length; index++) {
			const exact = !enabled || amount === 0 || index % 4 === 3 || source[index - index % 4 + 3] === 0;
			if (exact) expect(result.pixels[index], `exact sample ${index}`).toBe(expected[index]);
			else expect(Math.abs(result.pixels[index] - expected[index]), `Amount ${amount}, sample ${index}`).toBeLessThanOrEqual(1);
		}
	}
});

/** Independent center-distance geometry and continuous sRGB equations. This
 * reference never imports a production scalar mapper, transfer or byte LUT. */
function opticalOracle(source, width, height, amount, enabled) {
	const output = [...source], centerX = (width - 1) / 2, centerY = (height - 1) / 2, diagonal = (width * width + height * height) / 4;
	if (!enabled || amount === 0) return output;
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const index = (y * width + x) * 4; if (source[index + 3] === 0) continue;
		const distance = ((x - centerX) ** 2 + (y - centerY) ** 2) / diagonal, gain = Math.exp(Math.LN2 * (amount / 50) * distance);
		if (gain === 1) continue;
		for (let channel = 0; channel < 3; channel++) {
			const value = source[index + channel] / 255, linear = value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
			const corrected = linear * gain, encoded = corrected <= .0031308 ? 12.92 * corrected : 1.055 * corrected ** (1 / 2.4) - .055;
			output[index + channel] = Math.round(255 * Math.min(1, Math.max(0, encoded)));
		}
	}
	return output;
}
function nativeFacts(value, source, active) {
	expect(value.passCodes).toEqual(active ? [37] : []); expect(value.programCount).toBe(38); expect(value.opticalProgramLinked).toBe(true);
	expect(value.nativeWebgl2).toBe(true); expect(value.nativeReadbacks).toBe(1); expect(value.glError).toBe(0); expect(value.before).toEqual(source); expect(value.source).toEqual(source); expect(value.ownedBuffersRetired).toBe(true);
}
async function nativeCapability(page, browserName) {
	const supported = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); if (gl) gl.getExtension('WEBGL_lose_context')?.loseContext(); return gl !== null; });
	test.skip(browserName === 'webkit' && !supported, 'This WebKit environment does not provide actual WebGL2.'); expect(supported).toBe(true);
}
async function prepare(page, locale) { await page.context().route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source })); await page.goto(resolveBrowserProductTestUrl(`/lightscaper/${locale}/`)); }
function qualify(page, source, width, height, amount, enabled = true) { return helper(page, 'qualifyOpticalNativeCurrentV1', { source, width, height, amount, enabled }); }
function helper(page, method, ...args) { return page.evaluate(async ({ pathname, method, args }) => (await import(pathname))[method](...args), { pathname: PROGRAM, method, args }); }
async function expectPixels(canvas, expected) { await expect.poll(() => canvas.evaluate(node => node.width === 3 && node.height === 1 ? [...node.getContext('2d', { alpha: true, colorSpace: 'srgb' }).getImageData(0, 0, 3, 1).data] : null)).toEqual(expected); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
function active(photo) { const version = photo.versions.find(value => value.id === photo.activeVersionId); expect(version).toBeTruthy(); return version; }
function named(root, role, name) { return root.getByRole(role, { name, exact: true }); }
function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
