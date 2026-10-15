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
const PROGRAM = '/__lightscaper_ca_native.js', NAME = 'Chromatic correction reference.png';
const SOURCE = Array.from({ length: 9 }, (_, x) => [x % 2 ? 255 : 0, 10 + x * 10, x % 2 ? 0 : 255, 255]).flat();
// At9×1, kR=-.01 and kB=.01 displace a pixel by∓(x-4)³/2050.
// Independent nearest-byte literals retain reference Green and alpha.
const DEVELOPED = [8, 10, 255, 255, 252, 20, 3, 255, 1, 30, 254, 255, 255, 40, 0, 255, 0, 50, 255, 255,
	255, 60, 0, 255, 1, 70, 254, 255, 252, 80, 3, 255, 8, 90, 255, 255];
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', Buffer.from([0, 0, 0, 9, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
	pngChunk('sRGB', Buffer.from([0])), pngChunk('IDAT', deflateSync(Buffer.from([0, ...SOURCE]))), pngChunk('IEND', Buffer.alloc(0))]);
let program;
test.beforeAll(async () => {
	program = await compileNativeImageHandoffScript('chromatic-aberration-reference.js', fileURLToPath(new URL('./helpers/lightscaper-chromatic-aberration-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});

for (const locale of ['en', 'de']) test(`${locale}: Photo menu authors independent chromatic correction with Escape, history, Full/Fit, reload and unchanged native Original custody`, async ({ page, browserName }) => {
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
	expect(choices).toContain('chromatic-aberration-v1'); await chooser.focus(); await page.keyboard.press('Home');
	for (let index = 0; index < choices.indexOf('chromatic-aberration-v1'); index++) await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Tab'); await expect(chooser).toHaveValue('chromatic-aberration-v1'); await keyboard(page, named(dialog, 'button', words.add));
	const red = named(dialog, 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectChromaticAberrationRed}`),
		blue = named(dialog, 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectChromaticAberrationBlue}`);
	await expect(red).toHaveValue('0'); await expect(blue).toHaveValue('0');
	await red.fill('100'); await red.press('Escape'); await expect(red).toHaveValue('0'); await painted(SOURCE);
	await red.fill('-100'); await red.press('Enter'); await blue.fill('100'); await blue.press('Enter'); await painted(DEVELOPED);
	await expect(history).toHaveValue('0'); expect((await custody()).photo).toEqual(initial.photo);
	await keyboard(page, named(dialog, 'button', words.save)); await expect(dialog.locator('[data-photo-develop-ack]')).toContainText(words.acknowledged);
	await expect(named(dialog, 'button', words.save)).toBeDisabled(); await expect(history).toHaveValue('1'); await painted(DEVELOPED);
	const saved = await custody(); unchanged(saved, 1); const version = active(saved.photo);
	expect(version.develop.effects).toHaveLength(1); expect(version.develop.effects[0]).toMatchObject({ type: 'chromatic-aberration-v1', enabled: true, params: { red: -100, blue: 100 } });
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
	await expect(history).toHaveValue('1'); await expect(red).toHaveValue('-100'); await expect(blue).toHaveValue('100'); await painted(DEVELOPED);
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
	async function custody() { const value = await helper(page, 'readChromaticPhotoCustodyCurrentV1', [photoId]); expect(value.photos).toHaveLength(1); expect(value.bodies).toEqual([]); return { namespace: value.namespace, ...value.photos[0] }; }
	function unchanged(value, delta) {
		expect(value.namespace).toBe(initial.namespace); expect(value.original).toEqual(initial.original); expect(value.bytes).toEqual(initial.bytes);
		expect(value.photo.revision).toBe(initial.photo.revision + delta); expect({ ...value.photo, revision: initial.photo.revision, versions: initial.photo.versions }).toEqual(initial.photo);
	}
});

test('Native WebGL2 CA35 matches unequal-alpha literals and reconstructs hidden corrected red from sub-byte support without changing Green/alpha/zero Blue', async ({ page, browserName }) => {
	test.setTimeout(90_000); await prepare(page, 'en'); await nativeCapability(page, browserName);
	const source = [0, 91, 255, 128, 255, 37, 0, 255, 0, 203, 255, 64], result = await qualify(page, source, 3, 1, -100, 100);
	expect(result.pixels).toEqual([2, 91, 255, 128, 255, 37, 0, 255, 4, 203, 255, 64]); nativeFacts(result, source, true);
	const hidden = [47, 31, 7, 0, 255, 11, 70, 1, 15, 9, 140, 0];
	for (const [red, expected] of [[-100, [255, 31, 7, 0, 255, 11, 70, 1, 255, 9, 140, 0]], [100, [0, 31, 7, 0, 255, 11, 70, 1, 0, 9, 140, 0]]]) {
		const value = await qualify(page, hidden, 3, 1, red, 0); nativeFacts(value, hidden, true); expect(value.pixels).toEqual(expected);
	}
	// Nonzero controls still reconstruct when their coefficient underflows in
	// JS or a GL float uniform; they are distinct from the exact-zero bypass.
	for (const tiny of [Number.MIN_VALUE, 1e-40]) for (const [red, blue, expected] of [[tiny, 0, [0, 31, 7, 0]], [0, tiny, [47, 31, 0, 0]]]) {
		const value = await qualify(page, [47, 31, 7, 0], 1, 1, red, blue); nativeFacts(value, [47, 31, 7, 0], true); expect(value.pixels).toEqual(expected);
	}
});

test('Native WebGL2 CA35 retains tiny inward motion when hidden reference pixels borrow visible neighboring color', async ({ page, browserName }) => {
	test.setTimeout(90_000); await prepare(page, 'en'); await nativeCapability(page, browserName);
	const source = [47, 31, 7, 0, 255, 11, 70, 255, 15, 9, 140, 0];
	// k=-1e-8 and edge r²=.4 move both edges inward by4e-9 pixels.
	// Only the opaque center contributes alpha, so the corrected channel is
	// exactly its color even though that supporting weight is far below1byte.
	for (const [red, blue, expected] of [[-.0001, 0, [255, 31, 7, 0, 255, 11, 70, 255, 255, 9, 140, 0]],
		[0, -.0001, [47, 31, 70, 0, 255, 11, 70, 255, 15, 9, 70, 0]]]) {
		const result = await qualify(page, source, 3, 1, red, blue); nativeFacts(result, source, true); expect(result.pixels).toEqual(expected);
	}
});

test('Native WebGL2 CA35 matches independent varied-alpha color reconstruction and exactly preserves reference and independently zero channels', async ({ page, browserName }) => {
	test.setTimeout(90_000); await prepare(page, 'en'); await nativeCapability(page, browserName);
	const width = 9, height = 7, source = Array.from({ length: width * height }, (_, n) => [(n * 37 + 47) % 256, (n * 59 + 31) % 256, (n * 101 + 7) % 256,
		n === 0 || n === width * height - 1 ? 0 : n * 41 % 256]).flat();
	for (const [red, blue, enabled] of [[-100, 100, true], [100, -100, true], [37.125, -22.5, true], [0, -100, true], [100, 0, true], [0, 0, true], [100, -100, false]]) {
		const expected = chromaticOracle(source, width, height, red, blue, enabled), result = await qualify(page, source, width, height, red, blue, enabled); nativeFacts(result, source, enabled && (red !== 0 || blue !== 0));
		expect(result.pixels).toHaveLength(expected.length);
		for (let index = 0; index < expected.length; index++) {
			const channel = index % 4, exact = !enabled || channel === 1 || channel === 3 || channel === 0 && red === 0 || channel === 2 && blue === 0;
			// Only corrected R/B admit highp-vs-double/framebuffer rounding of one
			// byte; reference G/A and every untouched channel remain byte-exact.
			if (exact) expect(result.pixels[index], `reference ${index}`).toBe(expected[index]);
			else expect(Math.abs(result.pixels[index] - expected[index]), `controls ${red}/${blue}, sample ${index}`).toBeLessThanOrEqual(1);
		}
	}
});

/** Independent whole-source tent basis, without production maps or samplers.
 * Reconstructed alpha is an unrounded divisor; reference alpha is unchanged. */
function chromaticOracle(source, width, height, red, blue, enabled) {
	const output = [...source], diagonalSquared = width * width + height * height;
	if (!enabled) return output;
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (const [channel, control] of [[0, red], [2, blue]]) {
		if (control === 0) continue; const dx = 2 * x + 1 - width, dy = 2 * y + 1 - height;
		const scale = 1 + control * .0001 * (dx * dx + dy * dy) / diagonalSquared;
		const sx = width / 2 + dx / 2 * scale - .5, sy = height / 2 + dy / 2 * scale - .5;
		let sum = 0, alpha = 0;
		for (let fromY = 0; fromY < height; fromY++) for (let fromX = 0; fromX < width; fromX++) {
			const weight = Math.max(0, 1 - Math.abs(fromX - sx)) * Math.max(0, 1 - Math.abs(fromY - sy)), from = (fromY * width + fromX) * 4, a = source[from + 3] * weight;
			alpha += a; sum += source[from + channel] * a;
		}
		output[(y * width + x) * 4 + channel] = alpha === 0 ? 0 : Math.round(sum / alpha);
	}
	return output;
}
function nativeFacts(value, source, active) {
	expect(value.passCodes).toEqual(active ? [35] : []); expect(value.programCount).toBe(37); expect(value.caProgramLinked).toBe(true);
	expect(value.nativeWebgl2).toBe(true); expect(value.nativeReadbacks).toBe(1); expect(value.glError).toBe(0); expect(value.before).toEqual(source); expect(value.source).toEqual(source); expect(value.ownedBuffersRetired).toBe(true);
}
async function nativeCapability(page, browserName) {
	const supported = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); if (gl) gl.getExtension('WEBGL_lose_context')?.loseContext(); return gl !== null; });
	test.skip(browserName === 'webkit' && !supported, 'This WebKit environment does not provide actual WebGL2.'); expect(supported).toBe(true);
}
async function prepare(page, locale) { await page.context().route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source })); await page.goto(resolveBrowserProductTestUrl(`/lightscaper/${locale}/`)); }
function qualify(page, source, width, height, red, blue, enabled = true) { return helper(page, 'qualifyChromaticNativeCurrentV1', { source, width, height, red, blue, enabled }); }
function helper(page, method, ...args) { return page.evaluate(async ({ pathname, method, args }) => (await import(pathname))[method](...args), { pathname: PROGRAM, method, args }); }
async function expectPixels(canvas, expected) { await expect.poll(() => canvas.evaluate(node => node.width === 9 && node.height === 1 ? [...node.getContext('2d', { alpha: true, colorSpace: 'srgb' }).getImageData(0, 0, 9, 1).data] : null)).toEqual(expected); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
function active(photo) { const version = photo.versions.find(value => value.id === photo.activeVersionId); expect(version).toBeTruthy(); return version; }
function named(root, role, name) { return root.getByRole(role, { name, exact: true }); }
function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
