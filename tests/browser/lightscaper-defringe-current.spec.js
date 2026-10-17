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
const PROGRAM = '/__lightscaper_defringe_native.js', NAME = 'Defringe reference.png';
const SOURCE = [0, 0, 0, 255, 255, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 0, 255, 0, 255, 255, 255, 255, 255];
// Both saturated centers have black/white neighbors: edge and excess gates1.
// Their encoded luma is73/256 and183/256, giving round(255Y)=73 and182.
const DEVELOPED = [0, 0, 0, 255, 73, 73, 73, 255, 255, 255, 255, 255, 0, 0, 0, 255, 182, 182, 182, 255, 255, 255, 255, 255];
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', Buffer.from([0, 0, 0, 6, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
	pngChunk('sRGB', Buffer.from([0])), pngChunk('IDAT', deflateSync(Buffer.from([0, ...SOURCE]))), pngChunk('IEND', Buffer.alloc(0))]);
let program;
test.beforeAll(async () => {
	program = await compileNativeImageHandoffScript('defringe-reference.js', fileURLToPath(new URL('./helpers/lightscaper-defringe-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});

for (const locale of ['en', 'de']) test(`${locale}: Photo menu authors manual defringe with Escape, threshold, Save, history, Full/Fit, reload and retained native Original custody`, async ({ page, browserName }) => {
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
	expect(choices).toContain('defringe-v1'); await chooser.focus(); await page.keyboard.press('Home');
	for (let index = 0; index < choices.indexOf('defringe-v1'); index++) await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Tab'); await expect(chooser).toHaveValue('defringe-v1'); await keyboard(page, named(dialog, 'button', words.add));
	const purple = named(dialog, 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectDefringePurple}`),
		green = named(dialog, 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectDefringeGreen}`),
		threshold = named(dialog, 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectDefringeEdgeThreshold}`);
	await expect(purple).toHaveValue('0'); await expect(green).toHaveValue('0'); await expect(threshold).toHaveValue('25');
	await purple.fill('45'); await purple.press('Escape'); await expect(purple).toHaveValue('0'); await painted(SOURCE);
	await purple.fill('100'); await purple.press('Enter'); await green.fill('100'); await green.press('Enter'); await painted(DEVELOPED);
	await threshold.fill('100'); await threshold.press('Enter'); await painted(SOURCE);
	await threshold.fill('25'); await threshold.press('Enter'); await painted(DEVELOPED);
	await expect(history).toHaveValue('0'); expect((await custody()).photo).toEqual(initial.photo);
	await keyboard(page, named(dialog, 'button', words.save)); await expect(dialog.locator('[data-photo-develop-ack]')).toContainText(words.acknowledged);
	await expect(named(dialog, 'button', words.save)).toBeDisabled(); await expect(history).toHaveValue('1'); await painted(DEVELOPED);
	const saved = await custody(); unchanged(saved, 1); const version = active(saved.photo);
	expect(version.develop.effects).toHaveLength(1); expect(version.develop.effects[0]).toMatchObject({ type: 'defringe-v1', enabled: true, params: { purple: 100, green: 100, edgeThreshold: 25 } });
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
	await expect(history).toHaveValue('1'); await expect(purple).toHaveValue('100'); await expect(green).toHaveValue('100'); await expect(threshold).toHaveValue('25'); await painted(DEVELOPED);
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
	async function custody() { const value = await helper(page, 'readDefringePhotoCustodyCurrentV1', [photoId]); expect(value.photos).toHaveLength(1); expect(value.bodies).toEqual([]); return { namespace: value.namespace, ...value.photos[0] }; }
	function unchanged(value, delta) {
		expect(value.namespace).toBe(initial.namespace); expect(value.original).toEqual(initial.original); expect(value.bytes).toEqual(initial.bytes);
		expect(value.photo.revision).toBe(initial.photo.revision + delta); expect({ ...value.photo, revision: initial.photo.revision, versions: initial.photo.versions }).toEqual(initial.photo);
	}
});

test('Native WebGL2 defringe36 matches purple/green literals, threshold bypass and exact flat/transparent hidden color', async ({ page, browserName }) => {
	test.setTimeout(90_000); await prepare(page, 'en'); await nativeCapability(page, browserName);
	for (const [center, purple, green, gray] of [[[255, 0, 255], 100, 0, 73], [[0, 255, 0], 0, 100, 182]]) {
		const source = [0, 0, 0, 255, ...center, 255, 255, 255, 255, 255];
		const result = await qualify(page, source, 3, 1, purple, green, 25); nativeFacts(result, source, true);
		expect(result.pixels).toEqual([0, 0, 0, 255, gray, gray, gray, 255, 255, 255, 255, 255]);
		const bypass = await qualify(page, source, 3, 1, purple, green, 100); nativeFacts(bypass, source, true); expect(bypass.pixels).toEqual(source);
	}
	for (const source of [[255, 0, 255, 1, 255, 0, 255, 127, 255, 0, 255, 255], [0, 255, 0, 1, 0, 255, 0, 127, 0, 255, 0, 255],
		[47, 31, 7, 0, 255, 0, 255, 255, 15, 9, 140, 0], [0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]]) {
		const result = await qualify(page, source, 3, 1, 100, 100, 25); nativeFacts(result, source, true); expect(result.pixels).toEqual(source);
	}
});

test('Native WebGL2 defringe36 matches independent clamped-neighbor statistics across fractional controls and varied alpha', async ({ page, browserName }) => {
	test.setTimeout(90_000); await prepare(page, 'en'); await nativeCapability(page, browserName);
	const width = 9, height = 7, source = Array.from({ length: width * height }, (_, n) => [(n * 37 + 47) % 256, (n * 59 + 31) % 256, (n * 101 + 7) % 256,
		n === 0 || n === width * height - 1 ? 0 : n * 41 % 256]).flat();
	for (const [purple, green, threshold, enabled] of [[100, 0, 25, true], [0, 100, 25, true], [100, 100, 0, true], [37.125, 62.5, 12.5, true], [100, 100, 100, true], [0, 0, 25, true], [100, 100, 25, false]]) {
		const expected = defringeOracle(source, width, height, purple, green, threshold, enabled), result = await qualify(page, source, width, height, purple, green, threshold, enabled);
		nativeFacts(result, source, enabled && (purple !== 0 || green !== 0)); expect(result.pixels).toHaveLength(expected.length);
		for (let index = 0; index < expected.length; index++) {
			const exact = !enabled || purple === 0 && green === 0 || index % 4 === 3 || source[index - index % 4 + 3] === 0;
			if (exact) expect(result.pixels[index], `exact sample ${index}`).toBe(expected[index]);
			else expect(Math.abs(result.pixels[index] - expected[index]), `controls ${purple}/${green}/${threshold}, sample ${index}`).toBeLessThanOrEqual(1);
		}
	}
});

/** Group clamped aliases with multiplicity before calculating the independent
 * weighted excess differences. Logical center exclusion leaves eight taps. */
function defringeOracle(source, width, height, purple, green, threshold, enabled) {
	const output = [...source], statistics = index => {
		const [r, g, b] = source.slice(index, index + 3).map(value => value / 255);
		return { y: (54 * r + 183 * g + 19 * b) / 256, p: Math.max(0, Math.min(r, b) - g), g: Math.max(0, g - Math.max(r, b)) };
	}, clamp = value => Math.min(1, Math.max(0, value));
	if (!enabled || purple === 0 && green === 0) return output;
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const index = (y * width + x) * 4; if (source[index + 3] === 0) continue;
		const center = statistics(index), neighbors = new Map();
		for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) {
			if (dx === 0 && dy === 0) continue;
			const offset = (Math.min(height - 1, Math.max(0, y + dy)) * width + Math.min(width - 1, Math.max(0, x + dx))) * 4;
			neighbors.set(offset, (neighbors.get(offset) ?? 0) + 1);
		}
		let low = center.y, high = center.y, total = 0, relativePurple = 0, relativeGreen = 0;
		for (const [offset, count] of neighbors) {
			const weight = count * source[offset + 3] / 255; if (weight === 0) continue;
			const neighbor = statistics(offset); low = Math.min(low, neighbor.y); high = Math.max(high, neighbor.y); total += weight;
			relativePurple += weight * (center.p - neighbor.p); relativeGreen += weight * (center.g - neighbor.g);
		}
		const edge = clamp(4 * (high - low - threshold / 100)), p = total === 0 ? 0 : clamp(4 * relativePurple / total), g = total === 0 ? 0 : clamp(4 * relativeGreen / total);
		const weight = clamp(edge * (purple / 100 * p + green / 100 * g)); if (weight === 0) continue;
		for (let channel = 0; channel < 3; channel++) { const value = source[index + channel] / 255; output[index + channel] = Math.round(255 * (value + weight * (center.y - value))); }
	}
	return output;
}
function nativeFacts(value, source, active) {
	expect(value.passCodes).toEqual(active ? [36] : []); expect(value.programCount).toBe(38); expect(value.defringeProgramLinked).toBe(true);
	expect(value.nativeWebgl2).toBe(true); expect(value.nativeReadbacks).toBe(1); expect(value.glError).toBe(0); expect(value.before).toEqual(source); expect(value.source).toEqual(source); expect(value.ownedBuffersRetired).toBe(true);
}
async function nativeCapability(page, browserName) {
	const supported = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); if (gl) gl.getExtension('WEBGL_lose_context')?.loseContext(); return gl !== null; });
	test.skip(browserName === 'webkit' && !supported, 'This WebKit environment does not provide actual WebGL2.'); expect(supported).toBe(true);
}
async function prepare(page, locale) { await page.context().route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source })); await page.goto(resolveBrowserProductTestUrl(`/lightscaper/${locale}/`)); }
function qualify(page, source, width, height, purple, green, edgeThreshold, enabled = true) { return helper(page, 'qualifyDefringeNativeCurrentV1', { source, width, height, purple, green, edgeThreshold, enabled }); }
function helper(page, method, ...args) { return page.evaluate(async ({ pathname, method, args }) => (await import(pathname))[method](...args), { pathname: PROGRAM, method, args }); }
async function expectPixels(canvas, expected) { await expect.poll(() => canvas.evaluate(node => node.width === 6 && node.height === 1 ? [...node.getContext('2d', { alpha: true, colorSpace: 'srgb' }).getImageData(0, 0, 6, 1).data] : null)).toEqual(expected); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
function active(photo) { const version = photo.versions.find(value => value.id === photo.activeVersionId); expect(version).toBeTruthy(); return version; }
function named(root, role, name) { return root.getByRole(role, { name, exact: true }); }
function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
