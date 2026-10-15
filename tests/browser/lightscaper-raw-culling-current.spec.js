/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoRawPreviewSourceCopy } from '../../src/common/i18n/lightscaper-photo-raw-preview-copy.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';

test.use({ browserCoverage: false });
const PROGRAM = '/__lightscaper_raw_culling_reference.js', NAME = 'Camera lens cap.CRW';
const CAMERA = 'lightscaper.raw-culling.camera-embedded.rgba8-contain-nearest', NEUTRAL = 'lightscaper.original-preview.rgba8-nearest';
let manifest, original, jpeg, rawFlip, wasm, program, oracle;
test.beforeAll(async () => {
	manifest = JSON.parse(await readFile(new URL('../../config/lightscaper-libraw-runtime-manifest.json', import.meta.url), 'utf8'));
	const fixtures = JSON.parse(await readFile(new URL('../../config/lightscaper-raw-fixtures.json', import.meta.url), 'utf8'));
	const pinned = fixtures.fixtures.find(value => value.id === 'canon-d60-lens-cap'); expect(pinned).toBeTruthy();
	original = await readFile(new URL(`../../vendor/lightscaper-raw-fixtures/${pinned.fileName}`, import.meta.url));
	expect(original.length).toBe(pinned.byteLength); expect(digest(original)).toBe(pinned.sha256);
	wasm = await readFile(new URL(`../../${manifest.runtime.path}`, import.meta.url));
	expect(wasm.length).toBe(manifest.runtime.byteLength); expect(digest(wasm)).toBe(manifest.runtime.sha256);
	const native = new WebAssembly.Instance(await WebAssembly.compile(wasm), { env: { emscripten_notify_memory_growth() {} },
		wasi_snapshot_preview1: { fd_read: () => 8, fd_close: () => 8, fd_write: () => 8, fd_seek: () => 8 } });
	const api = native.exports; api._initialize();
	try {
		expect(api.raw_abi_version()).toBe(1); const pointer = api.raw_input_alloc(original.length); expect(pointer).toBeGreaterThan(0);
		new Uint8Array(api.memory.buffer, pointer, original.length).set(original);
		expect(api.raw_open()).toBe(0); rawFlip = api.raw_flip(); expect(rawFlip).toBe(0);
		expect(api.raw_preview()).toBe(0); expect(api.raw_preview_type()).toBe(1);
		expect([api.raw_preview_width(), api.raw_preview_height(), api.raw_preview_bits()]).toEqual([2048, 1360, 8]);
		jpeg = Buffer.from(new Uint8Array(api.memory.buffer, api.raw_preview_ptr(), api.raw_preview_bytes()));
		expect(api.raw_decode()).toBe(0); expect([api.raw_output_width(), api.raw_output_height(), api.raw_output_channels(), api.raw_output_bits()]).toEqual([3088, 2056, 3, 16]);
		const words = new Uint16Array(api.memory.buffer, api.raw_output_ptr(), api.raw_output_bytes() / 2);
		oracle = { thumbnail: nativeDisplay(words, 512, false), before: nativeDisplay(words, 2048, false),
			identity: nativeDisplay(words, 2048, true), exposed: nativeDisplay(words, 2048, true, 2) };
	} finally { try { api.raw_destroy(); } finally { new Uint8Array(api.memory.buffer).fill(0); } }
	program = await compileNativeImageHandoffScript('raw-culling-reference.js', fileURLToPath(new URL('./helpers/lightscaper-raw-culling-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});
test.afterAll(() => { original?.fill(0); jpeg?.fill(0); wasm?.fill(0); });

for (const locale of ['en', 'de']) test(`${locale}: actual camera preview culling and durable cache stay separate from native RAW Develop`, async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'This production RAW workflow qualifies Chromium and Firefox.'); test.setTimeout(180_000);
	const copy = bundledLightscaperEditorCopyForLocale(locale), source = photoRawPreviewSourceCopy(locale), words = photoDevelopCopy(locale);
	const workers = [], errors = [];
	page.on('pageerror', error => { errors.push(error.message); });
	page.on('worker', worker => { if (new URL(worker.url()).pathname.includes('libraw-worker-v1')) workers.push(worker.url()); });
	await page.route(manifest.runtime.url, route => route.fulfill({ status: 200, headers: {
		'content-type': 'application/wasm', 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin',
	}, body: wasm }));
	await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	await page.goto(resolveBrowserProductTestUrl(`/lightscaper/${locale}/`));
	const app = named(page, 'region', 'Lightscaper'); await expect(app).toBeVisible(); await expect(app.locator('canvas')).toHaveCount(0);
	await previewSourceMenu(); await expect(named(app, 'button', source.neutral)).toHaveAttribute('aria-pressed', 'true');
	await keyboard(named(app, 'button', source.neutral));
	await menu(copy.photoFileMenu); await keyboard(named(app, 'button', copy.photoImportPhotos));
	const importer = named(page, 'dialog', copy.photoImportPhotos);
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: NAME, mimeType: 'image/png', buffer: original });
	await keyboard(named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
	const library = app.locator('[data-photo-library]'), card = library.locator('[data-photo-id]');
	await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false'); await keyboard(card);
	const photoId = await card.getAttribute('data-photo-id'); expect(photoId).toBeTruthy(); const initial = await observe();
	expect(initial.original.sha256).toBe(digest(original)); expect(initial.original.byteLength).toBe(original.length); expect(initial.previews).toEqual([]);
	await chooseView(copy.photoShowFilmstrip); await expect(library).toHaveAttribute('data-photo-layout', 'filmstrip');
	await chooseView(copy.photoShowThumbnails); const thumbnail = named(card, 'img', NAME);
	await expect.poll(() => plane(thumbnail), { timeout: 60_000 }).toEqual(oracle.thumbnail);
	await chooseView(copy.photoShowLoupe); const loupe = named(app.locator('[data-photo-loupe]'), 'img', NAME);
	await expect.poll(() => plane(loupe), { timeout: 60_000 }).toEqual(oracle.before);
	const neutral = await observe(); expect(neutral.previews).toHaveLength(2); expect(neutral.previews.every(value => value.recipeId === NEUTRAL)).toBe(true);
	const camera = await page.evaluate(async ({ pathname, bytes, rawFlip }) => (await import(pathname)).rawCameraPreviewOracleCurrentV1(bytes, rawFlip),
		{ pathname: PROGRAM, bytes: [...jpeg], rawFlip });
	expect(camera[0]).not.toEqual(oracle.thumbnail); expect(camera[1]).not.toEqual(oracle.before);
	await chooseSource(source.camera);
	await expect.poll(() => plane(thumbnail), { timeout: 60_000 }).toEqual(camera[0]);
	await expect.poll(() => plane(loupe), { timeout: 60_000 }).toEqual(camera[1]);
	const both = await observe(); expect(both.previews).toHaveLength(4);
	for (const value of both.previews) {
		expect(value.originalMediaContentToken).toBe(initial.original.mediaContentToken);
		if (value.recipeId === CAMERA) { expect(value.decoderSha256).toBe(manifest.runtime.sha256); expect(value).toMatchObject(value.tier === 'thumbnail' ? camera[0] : camera[1]); }
		else { expect(value.recipeId).toBe(NEUTRAL); expect(value.decoderSha256).toBeNull(); }
	}
	const cachedWorkers = workers.length;
	await chooseSource(source.neutral); await expect.poll(() => plane(thumbnail)).toEqual(oracle.thumbnail); await expect.poll(() => plane(loupe)).toEqual(oracle.before);
	await chooseSource(source.camera); await expect.poll(() => plane(thumbnail)).toEqual(camera[0]); await expect.poll(() => plane(loupe)).toEqual(camera[1]);
	expect(workers.length).toBe(cachedWorkers); expect((await observe()).previews).toEqual(both.previews);
	await card.focus(); await card.press('5'); await expect(library).toHaveAttribute('aria-busy', 'false');
	await menu(copy.photoFileMenu); await menu(copy.photoPhotoMenu); await keyboard(named(app, 'button', `${copy.photoFlag}: ${copy.photoPick}`));
	await expect(library).toHaveAttribute('aria-busy', 'false'); const culled = await observe();
	expect(culled.photo.rating).toBe(5); expect(culled.photo.flag).toBe('pick'); expect(culled.original).toEqual(initial.original); expect(culled.previews).toEqual(both.previews);
	await menu(copy.photoFileMenu); await menu(copy.photoPhotoMenu); await keyboard(named(app, 'button', photoDevelopMenuLabel(locale)));
	const develop = named(page, 'dialog', `${words.title}: ${NAME}`), preview = develop.locator('[data-photo-develop-preview]');
	await expect(preview).toHaveAttribute('data-state', 'ready', { timeout: 90_000 });
	await expect.poll(() => plane(named(develop, 'img', words.before))).toEqual(oracle.before);
	await expect.poll(() => plane(named(develop, 'img', words.after))).toEqual(oracle.identity);
	await named(develop, 'combobox', words.choose).selectOption('tone-ladder-v1'); await keyboard(named(develop, 'button', words.add));
	const exposure = named(develop, 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectParamExposure}`);
	await exposure.fill('1'); await exposure.press('Enter'); await expect(exposure).toHaveValue('1');
	await expect(preview).toHaveAttribute('data-state', 'ready', { timeout: 90_000 });
	await expect.poll(() => plane(named(develop, 'img', words.after)), { timeout: 60_000 }).toEqual(oracle.exposed);
	expect(workers.length).toBeGreaterThan(cachedWorkers);
	await keyboard(named(develop, 'button', words.save)); await expect(develop.locator('[data-photo-develop-ack]')).toBeVisible();
	await expect(named(develop, 'button', words.save)).toBeDisabled(); const saved = await observe();
	expect(saved.original).toEqual(initial.original); expect(saved.previews).toEqual(both.previews);
	const recipe = saved.photo.versions.find(value => value.id === saved.photo.activeVersionId).develop;
	expect(recipe.effects.map(value => [value.type, value.params.exposure])).toEqual([['tone-ladder-v1', 1]]);
	await keyboard(named(develop, 'button', words.close).last()); await expect(develop).toHaveCount(0);
	await page.reload(); await expect(app).toBeVisible(); await previewSourceMenu();
	await expect(named(app, 'button', source.neutral)).toHaveAttribute('aria-pressed', 'true');
	await keyboard(named(app, 'button', source.neutral));
	await chooseView(copy.photoShowLibrary); await expect(card).toHaveCount(1); await chooseSource(source.camera);
	const workersBeforeHit = workers.length; await chooseView(copy.photoShowThumbnails);
	await expect.poll(() => plane(thumbnail)).toEqual(camera[0]); expect(workers.length).toBe(workersBeforeHit);
	const reopened = await observe(); expect(reopened.photo).toEqual(saved.photo); expect(reopened.original).toEqual(initial.original); expect(reopened.previews).toEqual(both.previews);
	for (const url of workers) { expect(new URL(url).origin).toBe(new URL(page.url()).origin); expect(new URL(url).pathname).toMatch(/\/assets\/libraw-worker-v1-[^/]+\.js$/u); }
	expect(errors).toEqual([]);

	async function menu(label) { await keyboard(app.getByRole('navigation').getByText(label, { exact: true })); }
	async function chooseView(label) { await menu(copy.photoViewMenu); await keyboard(named(app, 'button', label)); }
	async function previewSourceMenu() { await menu(copy.photoViewMenu); await menu(source.menu); }
	async function chooseSource(label) { await previewSourceMenu(); await keyboard(named(app, 'button', label)); }
	async function keyboard(control) { await expect(control).toBeEnabled(); await control.focus(); await page.keyboard.press('Enter'); }
	function observe() { return page.evaluate(async ({ pathname, photoId }) => (await import(pathname)).readRawCullingCustodyCurrentV1(photoId), { pathname: PROGRAM, photoId }); }
});

// Source-native RGB16 words feed only this independent oracle. Direct nearest
// coordinates sample the native sensor extent, then Float32 storage/exposure
// (After only) and a single final SDR transfer. No production renderer is used.
function nativeDisplay(words, maximum, working, gain = 1) {
	const width = maximum, height = Math.round(2056 * maximum / 3088), output = new Uint8Array(width * height * 4);
	try {
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
			const from = (Math.floor(y * 2056 / height) * 3088 + Math.floor(x * 3088 / width)) * 3, to = (y * width + x) * 4;
			for (let channel = 0; channel < 3; channel++) {
				let value = words[from + channel] / 65535;
				if (working) value = Math.fround(Math.fround(value) * gain);
				value = Math.max(0, Math.min(1, value)); output[to + channel] = Math.round(255 * (value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055));
			}
			output[to + 3] = 255;
		}
		return { width, height, sha256: digest(output) };
	} finally { output.fill(0); }
}
async function plane(canvas) {
	return canvas.evaluate(async node => {
		if (!node.width || !node.height) return null;
		const pixels = node.getContext('2d', { alpha: true, colorSpace: 'srgb' }).getImageData(0, 0, node.width, node.height).data;
		try { return { width: node.width, height: node.height, sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))].map(value => value.toString(16).padStart(2, '0')).join('') }; }
		finally { pixels.fill(0); }
	});
}
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function named(root, role, name) { return root.getByRole(role, { name, exact: true }); }
