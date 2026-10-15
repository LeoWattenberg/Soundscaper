/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { bundledSiteCopyForLocale } from '../../src/common/i18n/site-copy.js';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { rawDngFixtureV1 } from '../helpers/lightscaper-raw-dng-current-fixture.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';

test.use({ browserCoverage: false });
const PROGRAM = '/__lightscaper_raw_import_custody.js', NAME = 'Native precision.dng', locale = 'en';
let program, wasm, manifest;
test.beforeAll(async () => {
	manifest = JSON.parse(await readFile(new URL('../../config/lightscaper-libraw-runtime-manifest.json', import.meta.url), 'utf8'));
	wasm = await readFile(new URL(`../../${manifest.runtime.path}`, import.meta.url));
	expect(wasm.length).toBe(manifest.runtime.byteLength); expect(createHash('sha256').update(wasm).digest('hex')).toBe(manifest.runtime.sha256);
	program = await compileNativeImageHandoffScript('raw-import-custody.js', fileURLToPath(new URL('./helpers/lightscaper-raw-import-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});

test('real RAW File import, native word Original, thumbnail and linear Develop survive Save and reload', async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'This bounded RAW workflow qualifies Chromium and Firefox.'); test.setTimeout(90_000);
	const copy = bundledLightscaperEditorCopyForLocale(locale), words = photoDevelopCopy(locale), errors = [], workers = [], assetRequests = [];
	const fixture = rawDngFixtureV1(), originalBytes = Buffer.from(fixture.bytes), sha256 = createHash('sha256').update(originalBytes).digest('hex');
	page.on('pageerror', error => { errors.push(error.message); });
	page.on('worker', worker => { if (new URL(worker.url()).pathname.includes('libraw-worker-v1')) workers.push(worker.url()); });
	page.on('request', request => { if (request.url() === manifest.runtime.url) assetRequests.push(request.url()); });
	await page.route(manifest.runtime.url, route => route.fulfill({ status: 200, headers: {
		'content-type': 'application/wasm', 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin',
	}, body: wasm }));
	await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	await page.goto(resolveBrowserProductTestUrl('/lightscaper/en/'));
	const app = named(page, 'region', 'Lightscaper'); await expect(app).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(copy.photoFileMenu); await keyboard(named(app, 'button', copy.photoImportPhotos));
	const importer = named(page, 'dialog', copy.photoImportPhotos);
	// The genuine File carries an incorrect raster MIME hint. Only its native
	// owned DNG container is permitted to select the real RAW route.
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: NAME, mimeType: 'image/png', buffer: originalBytes });
	await keyboard(named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
	const library = named(app, 'region', bundledSiteCopyForLocale(locale).workspacePhoto), card = app.getByRole('button', { name: /^Native precision\.dng/u });
	await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false'); await keyboard(card);
	const photoId = await card.getAttribute('data-photo-id'); expect(photoId).toBeTruthy();
	const initial = await observe(); expectOriginal(initial); expect(initial.photo.original.mimeType).toBe('image/x-adobe-dng');
	expect(initial.native.descriptor).toEqual({ schemaVersion: 1, width: 32, height: 32, sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' });
	expect(initial.native.rawFlip).toBe(0); expect(initial.native.words).toHaveLength(4096);
	const low = (8 * 32 + 8) * 4, high = (8 * 32 + 24) * 4;
	for (let channel = 0; channel < 3; channel++) {
		expect(initial.native.words[high + channel]).toBeGreaterThan(initial.native.words[low + channel]);
		expect(Math.floor(initial.native.words[high + channel] / 257)).toBe(Math.floor(initial.native.words[low + channel] / 257));
	}
	await menu(copy.photoViewMenu); await keyboard(named(app, 'button', copy.photoShowThumbnails));
	const thumbnail = named(card, 'img', NAME); await expect(thumbnail).toBeVisible();
	await expect.poll(() => plane(thumbnail)).toEqual([32, 32, ...displayOracle(initial.native.words, false)]);
	await openDevelop(); const dialog = named(page, 'dialog', `${words.title}: ${NAME}`), preview = dialog.locator('[data-photo-develop-preview]');
	const before = named(dialog, 'img', words.before), after = named(dialog, 'img', words.after);
	await expect(preview).toHaveAttribute('data-state', 'ready');
	const beforePixels = displayOracle(initial.native.words, false); await expect.poll(() => plane(before)).toEqual([32, 32, ...beforePixels]);
	await named(dialog, 'combobox', words.choose).selectOption('white-balance-v1'); await keyboard(named(dialog, 'button', words.add));
	await number('videoEffectParamTemperature', '100');
	await named(dialog, 'combobox', words.choose).selectOption('tone-ladder-v1'); await keyboard(named(dialog, 'button', words.add));
	await number('videoEffectParamExposure', '-1');
	const expected = displayOracle(initial.native.words, true); expect(expected).not.toEqual(beforePixels);
	await expect.poll(() => plane(after)).toEqual([32, 32, ...expected]); await expect(preview).toHaveAttribute('data-state', 'ready');
	expect(await observe()).toEqual(initial);
	await keyboard(named(dialog, 'button', words.save)); await expect(dialog.locator('[data-photo-develop-ack]')).toBeVisible();
	await expect(named(dialog, 'button', words.save)).toBeDisabled();
	const saved = await observe(); expect(saved.photo.revision).toBe(initial.photo.revision + 1); expectOriginal(saved);
	expect(saved.original).toEqual(initial.original); expect(saved.photo.original).toEqual(initial.photo.original); expect(saved.native).toEqual(initial.native);
	const recipe = saved.photo.versions.find(version => version.id === saved.photo.activeVersionId).develop;
	expect(recipe.effects.map(effect => [effect.type, effect.enabled])).toEqual([['white-balance-v1', true], ['tone-ladder-v1', true]]);
	expect(recipe.effects[0].params.temperature).toBe(100); expect(recipe.effects[1].params.exposure).toBe(-1);
	await keyboard(named(dialog, 'button', words.close).last()); await expect(dialog).toHaveCount(0);
	await page.reload(); await expect(app).toBeVisible(); await menu(copy.photoViewMenu); await keyboard(named(app, 'button', copy.photoShowLibrary));
	await expect(card).toHaveCount(1); await keyboard(card); await openDevelop();
	await expect(preview).toHaveAttribute('data-state', 'ready'); await expect.poll(() => plane(before)).toEqual([32, 32, ...beforePixels]);
	await expect.poll(() => plane(after)).toEqual([32, 32, ...expected]);
	await expect(named(dialog, 'spinbutton', exact('videoEffectParamTemperature'))).toHaveValue('100');
	await expect(named(dialog, 'spinbutton', exact('videoEffectParamExposure'))).toHaveValue('-1');
	expect(await observe()).toEqual(saved); await keyboard(named(dialog, 'button', words.close).last()); await expect(dialog).toHaveCount(0);
	expect(workers.length).toBeGreaterThanOrEqual(3); expect(assetRequests.length).toBeGreaterThan(0);
	for (const url of workers) { expect(new URL(url).origin).toBe(new URL(page.url()).origin); expect(new URL(url).pathname).toMatch(/\/assets\/libraw-worker-v1-[^/]+\.js$/u); }
	expect(errors).toEqual([]);

	function exact(key) { return `${words.shared.videoEffectExactValue}: ${words.shared[key]}`; }
	async function number(key, value) { const control = named(dialog, 'spinbutton', exact(key)); await control.fill(value); await control.press('Enter'); await expect(control).toHaveValue(value); }
	async function menu(label) { const control = app.getByRole('navigation').getByText(label, { exact: true }); await keyboard(control); }
	async function openDevelop() { await menu(copy.photoFileMenu); await menu(copy.photoPhotoMenu); await keyboard(named(app, 'button', photoDevelopMenuLabel(locale))); }
	async function keyboard(control) { await expect(control).toBeEnabled(); await control.focus(); await page.keyboard.press('Enter'); }
	function observe() { return page.evaluate(async ({ pathname, photoId }) => (await import(new URL(pathname, location.href).href)).readRawImportCustodyCurrentV1(photoId), { pathname: PROGRAM, photoId }); }
	function expectOriginal(value) { expect(value.bytes).toEqual([...originalBytes]); expect(value.original.sha256).toBe(sha256); expect(value.original.byteLength).toBe(originalBytes.length);
		expect(value.photo.original.contentSha256).toBe(sha256); expect(value.photo.original.byteLength).toBe(originalBytes.length); expect(value.photo.original.width).toBe(32); expect(value.photo.original.height).toBe(32); }
});

// Independent final SDR display oracle: source-native words normalize once to
// Float32. WB(+100) has exact gains[2,1,.5], then exposure(-1) halves each
// channel, with Float32 storage after each effect. Quantization occurs once
// here, after those deep stages; no production renderer/encoder is called.
function displayOracle(words, changed) {
	return words.map((sample, index) => {
		if (index % 4 === 3) return 255;
		let value = sample / 65535;
		if (changed) { value = Math.fround(value); value = Math.fround(value * [2, 1, .5][index % 4]); value = Math.fround(value * .5); }
		value = Math.max(0, Math.min(1, value));
		return Math.round(255 * (value <= .0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - .055));
	});
}
function plane(canvas) { return canvas.evaluate(node => [node.width, node.height, ...(node.width && node.height ? node.getContext('2d').getImageData(0, 0, node.width, node.height).data : [])]); }
function named(root, role, name) { return root.getByRole(role, { name, exact: true }); }
