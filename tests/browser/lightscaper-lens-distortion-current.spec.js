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
const PROGRAM = '/__lightscaper_lens_native.js', NAME = 'Manual lens reference.png';
const SOURCE = [0, 0, 0, 255, 100, 100, 100, 255, 200, 200, 200, 255];
const DEVELOPED = [12, 12, 12, 255, 100, 100, 100, 255, 188, 188, 188, 255];
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', Buffer.from([0, 0, 0, 3, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
	pngChunk('sRGB', Buffer.from([0])), pngChunk('IDAT', deflateSync(Buffer.from([0, ...SOURCE]))), pngChunk('IEND', Buffer.alloc(0))]);
let program;
test.beforeAll(async () => {
	program = await compileNativeImageHandoffScript('lens-distortion-reference.js', fileURLToPath(new URL('./helpers/lightscaper-lens-distortion-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});

for (const locale of ['en', 'de']) test(`${locale}: Photo menu authors manual lens distortion with Escape, durable history, Full/Fit and unchanged Original custody`, async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'The native OPFS Photo workflow qualifies Chromium and Firefox.'); test.setTimeout(120_000);
	const copy = bundledLightscaperEditorCopyForLocale(locale), words = photoDevelopCopy(locale), settings = photoDevelopSettingsCopy(locale, 'current3'), errors = [];
	page.on('pageerror', error => { errors.push(error.message); }); await prepare(page, locale);
	const app = named(page, 'region', 'Lightscaper'); await expect(app).toBeVisible();
	await menu(copy.photoFileMenu); await keyboard(page, named(app, 'button', copy.photoImportPhotos));
	const importer = named(page, 'dialog', copy.photoImportPhotos);
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: NAME, mimeType: 'image/png', buffer: PNG });
	await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
	const library = app.locator('[data-photo-library]'), card = library.locator('[data-photo-id]');
	await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false');
	const photoId = await card.getAttribute('data-photo-id'); expect(photoId).toBeTruthy();
	const initial = await custody(); expect(initial.original.sha256).toBe(createHash('sha256').update(PNG).digest('hex')); expect(initial.original.byteLength).toBe(PNG.length); expect(initial.bytes).toEqual([...PNG]);
	await keyboard(page, card); await open();
	const dialog = named(page, 'dialog', `${words.title}: ${NAME}`), preview = dialog.locator('[data-photo-develop-preview]'), history = named(dialog, 'combobox', words.history);
	await painted(SOURCE); await expect(history).toHaveValue('0');
	const chooser = named(dialog, 'combobox', words.choose), choices = await chooser.locator('option').evaluateAll(options => options.map(option => option.value));
	expect(choices).toContain('lens-distortion-v1'); await chooser.focus(); await page.keyboard.press('Home');
	for (let index = 0; index < choices.indexOf('lens-distortion-v1'); index++) await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Tab'); await expect(chooser).toHaveValue('lens-distortion-v1'); await keyboard(page, named(dialog, 'button', words.add));
	const amount = named(dialog, 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectLensDistortionAmount}`);
	await expect(amount).toHaveValue('0'); await amount.fill('100'); await amount.press('Escape'); await expect(amount).toHaveValue('0'); await painted(SOURCE);
	await amount.fill('-100'); await amount.press('Enter'); await expect(amount).toHaveValue('-100'); await painted(DEVELOPED);
	await expect(history).toHaveValue('0'); expect((await custody()).photo).toEqual(initial.photo);
	await keyboard(page, named(dialog, 'button', words.save)); await expect(dialog.locator('[data-photo-develop-ack]')).toContainText(words.acknowledged);
	await expect(named(dialog, 'button', words.save)).toBeDisabled(); await expect(history).toHaveValue('1'); await painted(DEVELOPED);
	const saved = await custody(); unchanged(saved, 1);
	const version = active(saved.photo); expect(version.develop.effects).toHaveLength(1);
	expect(version.develop.effects[0]).toMatchObject({ type: 'lens-distortion-v1', enabled: true, params: { amount: -100 } });
	expect({ ...version.develop, effects: active(initial.photo).develop.effects }).toEqual(active(initial.photo).develop);
	expect(version.workspace.cursor).toBe(1); expect(version.workspace.entries).toHaveLength(2); expect(version.workspace.snapshots).toEqual([]);
	await resolution('full'); await painted(DEVELOPED); await expect(named(dialog, 'region', words.imageViewport)).toBeVisible();
	await resolution('proxy'); await painted(DEVELOPED); await expect(named(dialog, 'region', words.imageViewport)).toHaveCount(0); expect(await custody()).toEqual(saved);
	await history.focus(); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Tab'); await expect(history).toHaveValue('0'); await painted(SOURCE);
	const undone = await custody(); unchanged(undone, 2); expect(active(undone.photo).develop).toEqual(active(initial.photo).develop);
	await history.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Tab'); await expect(history).toHaveValue('1'); await painted(DEVELOPED);
	const restored = await custody(); unchanged(restored, 3); expect(active(restored.photo)).toEqual(version);
	await close(); await page.reload(); await expect(app).toBeVisible();
	await menu(copy.photoViewMenu); await keyboard(page, named(app, 'button', copy.photoShowLibrary)); await expect(card).toHaveCount(1);
	await expect(library).toHaveAttribute('aria-busy', 'false'); await keyboard(page, card); await open();
	await expect(history).toHaveValue('1'); await expect(amount).toHaveValue('-100'); await painted(DEVELOPED);
	await expect(dialog.locator('[data-resolution]')).toHaveAttribute('data-resolution', 'proxy'); expect(await custody()).toEqual(restored);
	await expect(dialog.getByRole('alert')).toHaveCount(0); await close(); expect(errors).toEqual([]);

	async function menu(label) { await keyboard(page, app.getByRole('navigation').getByText(label, { exact: true })); }
	async function open() { await menu(copy.photoFileMenu); await menu(copy.photoPhotoMenu); await keyboard(page, named(app, 'button', photoDevelopMenuLabel(locale))); }
	async function close() { await keyboard(page, named(dialog.locator('.lightscaper-develop-actions'), 'button', words.close)); await expect(dialog).toHaveCount(0); }
	async function painted(expected) {
		await expect(preview).toHaveAttribute('data-state', 'ready'); await expectPixels(named(dialog, 'img', words.before), SOURCE);
		await expectPixels(named(dialog, 'img', words.after), expected);
	}
	async function resolution(value) {
		const summary = dialog.locator('summary').filter({ hasText: new RegExp(`^${escape(settings.menu)}$`, 'u') });
		if (!await summary.evaluate(node => node.parentElement.open)) await keyboard(page, summary);
		await keyboard(page, named(dialog, 'button', value === 'full' ? words.fullResolution : words.fitResolution));
		await expect(dialog.locator('[data-resolution]')).toHaveAttribute('data-resolution', value);
	}
	async function custody() { const value = await helper(page, 'readLensPhotoCustodyCurrentV1', [photoId]);
		expect(value.photos).toHaveLength(1); expect(value.bodies).toEqual([]); return { namespace: value.namespace, ...value.photos[0] }; }
	function unchanged(value, delta) {
		expect(value.namespace).toBe(initial.namespace); expect(value.original).toEqual(initial.original); expect(value.bytes).toEqual(initial.bytes);
		expect(value.photo.revision).toBe(initial.photo.revision + delta);
		expect({ ...value.photo, revision: initial.photo.revision, versions: initial.photo.versions }).toEqual(initial.photo);
	}
});

test('Native WebGL2 lens34 uses exact zero-extended alpha taps for the independent three-pixel literal', async ({ page, browserName }) => {
	test.setTimeout(90_000);
	await prepare(page, 'en'); await nativeCapability(page, browserName);
	const source = [255, 0, 0, 255, 0, 128, 255, 128, 32, 200, 16, 64], result = await qualify(page, source, 3, 1, 100);
	expect(result.pixels).toEqual([255, 0, 0, 224, 0, 128, 255, 128, 32, 200, 16, 56]); nativeFacts(result, source, true);
});

test('Native WebGL2 lens34 transports varied alpha over both radial signs and preserves exact neutral/disabled hidden color', async ({ page, browserName }) => {
	test.setTimeout(90_000);
	await prepare(page, 'en'); await nativeCapability(page, browserName);
	const width = 9, height = 7, source = Array.from({ length: width * height }, (_, index) => [index * 37 % 256, index * 59 % 256, index * 101 % 256,
		index === 0 ? 0 : index === width * height - 1 ? 255 : index * 41 % 256]).flat();
	for (const amount of [-100, -50, 25, 100]) {
		const expected = lensOracle(source, width, height, amount), actual = await qualify(page, source, width, height, amount); nativeFacts(actual, source, true);
		// Native highp arithmetic and byte framebuffer rounding have a one-byte
		// envelope against this independent double-precision tent specification.
		expect(actual.pixels).toHaveLength(expected.length);
		for (let index = 0; index < expected.length; index++) expect(Math.abs(actual.pixels[index] - expected[index]), `amount ${amount}, sample ${index}`).toBeLessThanOrEqual(1);
	}
	for (const [amount, enabled] of [[0, true], [100, false]]) {
		const result = await qualify(page, source, width, height, amount, enabled); nativeFacts(result, source, false); expect(result.pixels).toEqual(source);
	}
});

/** Independent whole-source triangular basis: sum every source pixel's tent
 * contribution, without the production mapper or four-tap sampler. */
function lensOracle(source, width, height, amount) {
	const output = [], diagonalSquared = width * width + height * height;
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const nx = 2 * x + 1 - width, ny = 2 * y + 1 - height, scale = 1 + amount * .003 * (nx * nx + ny * ny) / diagonalSquared;
		const sx = width / 2 + nx / 2 * scale - .5, sy = height / 2 + ny / 2 * scale - .5;
		const sum = [0, 0, 0]; let alpha = 0;
		for (let fromY = 0; fromY < height; fromY++) for (let fromX = 0; fromX < width; fromX++) {
			const weight = Math.max(0, 1 - Math.abs(fromX - sx)) * Math.max(0, 1 - Math.abs(fromY - sy)), from = (fromY * width + fromX) * 4, a = source[from + 3] * weight;
			alpha += a; for (let channel = 0; channel < 3; channel++) sum[channel] += source[from + channel] * a;
		}
		const deliveredAlpha = Math.round(alpha); output.push(...(deliveredAlpha ? sum.map(value => Math.round(value / alpha)) : [0, 0, 0]), deliveredAlpha);
	}
	return output;
}
function nativeFacts(value, source, active) {
	expect(value.passCodes).toEqual(active ? [34] : []); expect(value.programCount).toBe(36); expect(value.lensProgramLinked).toBe(true);
	expect(value.nativeWebgl2).toBe(true); expect(value.nativeReadbacks).toBe(1); expect(value.glError).toBe(0);
	expect(value.before).toEqual(source); expect(value.source).toEqual(source); expect(value.ownedBuffersRetired).toBe(true);
}
async function nativeCapability(page, browserName) {
	const supported = await page.evaluate(() => { const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl2');
		if (gl) gl.getExtension('WEBGL_lose_context')?.loseContext(); return gl !== null; });
	test.skip(browserName === 'webkit' && !supported, 'This WebKit environment does not provide an actual WebGL2 context.'); expect(supported).toBe(true);
}
async function prepare(page, locale) {
	await page.context().route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	await page.goto(resolveBrowserProductTestUrl(`/lightscaper/${locale}/`));
}
async function qualify(page, source, width, height, amount, enabled = true) { return helper(page, 'qualifyLensNativeCurrentV1', { source, width, height, amount, enabled }); }
function helper(page, method, ...args) { return page.evaluate(async ({ pathname, method, args }) => (await import(pathname))[method](...args), { pathname: PROGRAM, method, args }); }
async function expectPixels(canvas, expected) { await expect.poll(() => canvas.evaluate(node => node.width === 3 && node.height === 1
	? [...node.getContext('2d', { alpha: true, colorSpace: 'srgb' }).getImageData(0, 0, 3, 1).data] : null)).toEqual(expected); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
function active(photo) { const version = photo.versions.find(value => value.id === photo.activeVersionId); expect(version).toBeTruthy(); return version; }
function named(root, role, name) { return root.getByRole(role, { name, exact: true }); }
function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
