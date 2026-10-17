/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoDevelopSettingsCopy } from '../../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';

test.use({ browserCoverage: false });
const PROGRAM = '/__lightscaper_native_proxy_reference.js', NAME = 'Native proxy lens cap.CRW';
const WIDTH = 3088, HEIGHT = 2056, PROXY_WIDTH = 2048, PROXY_HEIGHT = Math.round(HEIGHT * PROXY_WIDTH / WIDTH);
let manifest, original, wasm, program, oracle;

test.beforeAll(async () => {
	test.setTimeout(180_000);
	manifest = JSON.parse(await readFile(new URL('../../config/lightscaper-libraw-runtime-manifest.json', import.meta.url), 'utf8'));
	const fixtures = JSON.parse(await readFile(new URL('../../config/lightscaper-raw-fixtures.json', import.meta.url), 'utf8'));
	const pin = fixtures.fixtures.find(value => value.id === 'canon-d60-lens-cap'); expect(pin).toBeTruthy();
	original = await readFile(new URL(`../../vendor/lightscaper-raw-fixtures/${pin.fileName}`, import.meta.url));
	expect(original.length).toBe(pin.byteLength); expect(digest(original)).toBe(pin.sha256);
	wasm = await readFile(new URL(`../../${manifest.runtime.path}`, import.meta.url));
	expect(wasm.length).toBe(manifest.runtime.byteLength); expect(digest(wasm)).toBe(manifest.runtime.sha256);
	const native = new WebAssembly.Instance(await WebAssembly.compile(wasm), { env: { emscripten_notify_memory_growth() {} },
		wasi_snapshot_preview1: { fd_read: () => 8, fd_close: () => 8, fd_write: () => 8, fd_seek: () => 8 } });
	const api = native.exports; api._initialize();
	try {
		expect(api.raw_abi_version()).toBe(1); const pointer = api.raw_input_alloc(original.length); expect(pointer).toBeGreaterThan(0);
		new Uint8Array(api.memory.buffer, pointer, original.length).set(original);
		expect(api.raw_open()).toBe(0); expect(api.raw_flip()).toBe(0); expect(api.raw_decode()).toBe(0);
		expect([api.raw_output_width(), api.raw_output_height(), api.raw_output_channels(), api.raw_output_bits()]).toEqual([WIDTH, HEIGHT, 3, 16]);
		const words = new Uint16Array(api.memory.buffer, api.raw_output_ptr(), api.raw_output_bytes() / 2);
		const proxy = sharpenOracle(words, PROXY_WIDTH, PROXY_HEIGHT), full = sharpenOracle(words, WIDTH, HEIGHT);
		try {
			const counter = fittedHash(full.pixels, WIDTH, HEIGHT, PROXY_WIDTH, PROXY_HEIGHT);
			const byteSource = sharpenOracle(words, PROXY_WIDTH, PROXY_HEIGHT, true);
			try {
				oracle = { proxy: proxy.facts, full: full.facts, beforeProxy: originalDisplay(words, PROXY_WIDTH, PROXY_HEIGHT),
					beforeFull: originalDisplay(words, WIDTH, HEIGHT), fullThenFit: counter, byteSource: byteSource.facts.plane.sha256 };
			} finally { byteSource.pixels.fill(0); }
			expect(oracle.proxy.plane.sha256).not.toBe(oracle.fullThenFit);
			expect(oracle.proxy.plane.sha256).not.toBe(oracle.byteSource);
		} finally { proxy.pixels.fill(0); full.pixels.fill(0); }
	} finally { try { api.raw_destroy(); } finally { new Uint8Array(api.memory.buffer).fill(0); } }
	program = await compileNativeImageHandoffScript('native-proxy-reference.js', fileURLToPath(new URL('./helpers/lightscaper-native-proxy-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});
test.afterAll(() => { original?.fill(0); wasm?.fill(0); });

for (const locale of ['en', 'de']) test(`${locale}: RAW Develop evaluates a native-depth proxy before sharpening and joins Full, replacement and reload`, async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'The production native RAW storage workflow qualifies Chromium and Firefox.'); test.setTimeout(300_000);
	const copy = bundledLightscaperEditorCopyForLocale(locale), words = photoDevelopCopy(locale), settings = photoDevelopSettingsCopy(locale, 'current3');
	const errors = [], workers = [], timings = [];
	page.on('pageerror', error => { errors.push(error.message); });
	page.on('worker', worker => { if (new URL(worker.url()).pathname.includes('libraw-worker-v1')) workers.push(worker.url()); });
	await page.route(manifest.runtime.url, route => route.fulfill({ status: 200, headers: {
		'content-type': 'application/wasm', 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin',
	}, body: wasm }));
	await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	await page.goto(resolveBrowserProductTestUrl(`/lightscaper/${locale}/`));
	const app = named(page, 'region', 'Lightscaper'); await expect(app).toBeVisible();
	await menu(copy.photoFileMenu); await keyboard(named(app, 'button', copy.photoImportPhotos));
	const importer = named(page, 'dialog', copy.photoImportPhotos);
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: NAME, mimeType: 'image/png', buffer: original });
	await keyboard(named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
	const library = app.locator('[data-photo-library]'), card = library.locator('[data-photo-id]');
	await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false'); await keyboard(card);
	const photoId = await card.getAttribute('data-photo-id'); expect(photoId).toBeTruthy();
	const initial = await observe(); expect(initial.original.sha256).toBe(digest(original)); expect(initial.previews).toEqual([]);
	await open();
	const dialog = named(page, 'dialog', `${words.title}: ${NAME}`), preview = dialog.locator('[data-photo-develop-preview]');
	const history = named(dialog, 'combobox', words.history), amount = named(dialog, 'spinbutton', exact('videoEffectDetailSharpenAmount'));
	await expect(preview).toHaveAttribute('data-state', 'ready', { timeout: 90_000 }); await expect(history).toHaveValue('0');
	await expect.poll(() => plane(named(dialog, 'img', words.before)), { timeout: 60_000 }).toEqual(oracle.beforeProxy);
	await named(dialog, 'combobox', words.choose).selectOption('detail-sharpen-v1'); await keyboard(named(dialog, 'button', words.add));
	await amount.fill('50'); await amount.press('Enter'); await expect(amount).toHaveValue('50');
	await expect(named(dialog, 'spinbutton', exact('videoEffectDetailSharpenThreshold'))).toHaveValue('0');
	await validate('proxy'); await expect(history).toHaveValue('0');
	await keyboard(named(dialog, 'button', words.save)); await expect(dialog.locator('[data-photo-develop-ack]')).toContainText(words.acknowledged);
	await expect(named(dialog, 'button', words.save)).toBeDisabled(); await expect(history).toHaveValue('1'); await validate('proxy');
	const saved = await observe(); assertCustody(saved, initial); assertSaved(initial.photo, saved.photo);
	await resolution('full'); await validate('full'); await expect(history).toHaveValue('1');
	const viewport = named(dialog, 'region', words.imageViewport); await expect(viewport).toBeVisible();
	await expect.poll(() => named(dialog, 'img', words.after).evaluate(canvas => ({ width: canvas.getBoundingClientRect().width, height: canvas.getBoundingClientRect().height })))
		.toEqual({ width: WIDTH, height: HEIGHT });
	await resolution('proxy'); await validate('proxy'); await expect(named(dialog, 'region', words.imageViewport)).toHaveCount(0);
	expect(await observe()).toEqual(saved);

	// Replace a pending Full presentation with Fit. Native ownership stays with
	// the real presenter; the observer only watches trusted menu events/DOM.
	await settingsMenu(); await keyboard(named(dialog, 'button', words.fullResolution));
	await expect(preview).toHaveAttribute('data-state', 'pending');
	await keyboard(named(dialog, 'button', words.fitResolution)); await validate('proxy');
	await expect(history).toHaveValue('1'); expect(await observe()).toEqual(saved);

	// Close during another genuine Full render, then open a fresh dialog owner.
	await helper('armNativeProxyRetirementCurrentV1', words.close);
	await settingsMenu(); await keyboard(named(dialog, 'button', words.fullResolution));
	await expect(preview).toHaveAttribute('data-state', 'pending');
	await keyboard(named(dialog.locator('.lightscaper-develop-actions'), 'button', words.close)); await expect(dialog).toHaveCount(0);
	await open(); await validate('proxy'); await expect(amount).toHaveValue('50'); await expect(history).toHaveValue('1');
	expect(await helper('readNativeProxyRetirementCurrentV1')).toEqual({ pendingAtClose: true, retired: true, latePublications: 0 });
	expect(await observe()).toEqual(saved);
	await keyboard(named(dialog.locator('.lightscaper-develop-actions'), 'button', words.close)); await expect(dialog).toHaveCount(0);
	await page.reload(); await expect(app).toBeVisible(); await menu(copy.photoViewMenu); await keyboard(named(app, 'button', copy.photoShowLibrary));
	await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false'); await keyboard(card); await open();
	await validate('proxy'); await expect(amount).toHaveValue('50'); await expect(history).toHaveValue('1');
	await settingsMenu(); await expect(named(dialog, 'button', words.fitResolution)).toHaveAttribute('aria-pressed', 'true');
	expect(await observe()).toEqual(saved); await expect(dialog.getByRole('alert')).toHaveCount(0);
	await keyboard(named(dialog.locator('.lightscaper-develop-actions'), 'button', words.close)); await expect(dialog).toHaveCount(0);
	expect(workers.length).toBeGreaterThan(0);
	for (const url of workers) { expect(new URL(url).origin).toBe(new URL(page.url()).origin); expect(new URL(url).pathname).toMatch(/\/assets\/libraw-worker-v1-[^/]+\.js$/u); }
	expect(errors).toEqual([]);
	await test.info().attach('native-proxy-observation', { body: JSON.stringify({ locale, browserName, source: [WIDTH, HEIGHT], proxy: [PROXY_WIDTH, PROXY_HEIGHT],
		proxyHistogramSamples: oracle.proxy.histogram.sampledPixels, fullHistogramSamples: oracle.full.histogram.sampledPixels,
		proxySha256: oracle.proxy.plane.sha256, fullThenFitSha256: oracle.fullThenFit, byteSourceSha256: oracle.byteSource,
		timings, timingPolicy: 'Diagnostic trusted resolution gesture to current ready plus one animation frame; no RAW latency gate.' }), contentType: 'application/json' });

	async function menu(label) { await keyboard(app.getByRole('navigation').getByText(label, { exact: true })); }
	async function open() { await menu(copy.photoFileMenu); await menu(copy.photoPhotoMenu); await keyboard(named(app, 'button', photoDevelopMenuLabel(locale))); }
	async function keyboard(control) { await expect(control).toBeEnabled(); await control.focus(); await page.keyboard.press('Enter'); }
	async function settingsMenu() {
		const summary = dialog.locator('summary').filter({ hasText: new RegExp(`^${escape(settings.menu)}$`, 'u') });
		if (!await summary.evaluate(element => element.parentElement.open)) await keyboard(summary);
	}
	async function resolution(value) {
		await settingsMenu(); const label = value === 'full' ? words.fullResolution : words.fitResolution;
		await helper('armNativeProxyTimingCurrentV1', label, value === 'full' ? WIDTH : PROXY_WIDTH, value === 'full' ? HEIGHT : PROXY_HEIGHT);
		await keyboard(named(dialog, 'button', label)); await validate(value);
		await expect.poll(async () => (await helper('readNativeProxyTimingCurrentV1'))?.presentedAtMs ?? null).not.toBeNull();
		const measured = await helper('readNativeProxyTimingCurrentV1');
		expect(measured.trusted).toBe(true); expect(measured.pendingObserved).toBe(true);
		expect(measured.readyAtMs).toBeGreaterThanOrEqual(measured.inputAtMs); expect(measured.presentedAtMs).toBeGreaterThanOrEqual(measured.readyAtMs);
		timings.push({ resolution: value, ...measured });
	}
	async function validate(resolution) {
		await expect(preview).toHaveAttribute('data-state', 'ready', { timeout: 90_000 });
		await expect(dialog.locator('[data-resolution]')).toHaveAttribute('data-resolution', resolution);
		await expect.poll(() => plane(named(dialog, 'img', words.after)), { timeout: 90_000 }).toEqual(oracle[resolution].plane);
		await expect.poll(() => plane(named(dialog, 'img', words.before)), { timeout: 60_000 }).toEqual(resolution === 'full' ? oracle.beforeFull : oracle.beforeProxy);
		await histogram(dialog, words, locale, oracle[resolution].histogram);
	}
	function exact(key) { return `${words.shared.videoEffectExactValue}: ${words.shared[key]}`; }
	function observe() { return helper('readNativeProxyCustodyCurrentV1', photoId); }
	function helper(method, ...args) { return page.evaluate(async ({ pathname, method, args }) => (await import(pathname))[method](...args), { pathname: PROGRAM, method, args }); }
});

// Independent native RGB16 oracle: exact nearest source coordinates precede
// Float32 normalization and continuous 3x3 binomial sharpening. Only the final
// display conversion quantizes to8bit. No production imaging owner is called.
function sharpenOracle(words, width, height, byteSource = false) {
	const pixels = new Uint8Array(width * height * 4), encoded = new Float64Array(65536), linear = new Float32Array(65536);
	for (let word = 0; word < 65536; word++) {
		linear[word] = byteSource ? Math.fround(decode(Math.round(encode(word / 65535) * 255) / 255)) : Math.fround(word / 65535);
		encoded[word] = encode(linear[word]);
	}
	const xs = Int32Array.from({ length: width }, (_, x) => Math.floor(x * WIDTH / width));
	const ys = Int32Array.from({ length: height }, (_, y) => Math.floor(y * HEIGHT / height));
	try {
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
			const from = (ys[y] * WIDTH + xs[x]) * 3, to = (y * width + x) * 4;
			for (let channel = 0; channel < 3; channel++) {
				const word = words[from + channel], center = encoded[word]; let sum = 0;
				for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
					const sx = xs[Math.max(0, Math.min(width - 1, x + dx))], sy = ys[Math.max(0, Math.min(height - 1, y + dy))];
					const weight = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
					sum += weight * encoded[words[(sy * WIDTH + sx) * 3 + channel]];
				}
				const sharpened = center + (center - sum / 16) * .5;
				const developed = sharpened === center ? linear[word] : Math.fround(decode(sharpened));
				pixels[to + channel] = Math.round(255 * encode(Math.max(0, Math.min(1, developed))));
			}
			pixels[to + 3] = 255;
		}
		return { pixels, facts: { plane: { width, height, sha256: digest(pixels) }, histogram: histogramFacts(pixels) } };
	} catch (error) { pixels.fill(0); throw error; }
	finally { encoded.fill(0); linear.fill(0); xs.fill(0); ys.fill(0); }
}
function originalDisplay(words, width, height) {
	const pixels = new Uint8Array(width * height * 4), scale = 1 / 65535;
	try {
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
			const from = (Math.floor(y * HEIGHT / height) * WIDTH + Math.floor(x * WIDTH / width)) * 3, to = (y * width + x) * 4;
			for (let channel = 0; channel < 3; channel++) pixels[to + channel] = Math.round(255 * encode(words[from + channel] * scale));
			pixels[to + 3] = 255;
		}
		return { width, height, sha256: digest(pixels) };
	} finally { pixels.fill(0); }
}
function fittedHash(source, sourceWidth, sourceHeight, width, height) {
	const pixels = new Uint8Array(width * height * 4);
	try {
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
			const from = (Math.floor(y * sourceHeight / height) * sourceWidth + Math.floor(x * sourceWidth / width)) * 4;
			pixels.set(source.subarray(from, from + 4), (y * width + x) * 4);
		}
		return digest(pixels);
	} finally { pixels.fill(0); }
}
function histogramFacts(pixels) {
	const bins = { red: Array(256).fill(0), green: Array(256).fill(0), blue: Array(256).fill(0) }; let low = 0, high = 0;
	for (let i = 0; i < pixels.length; i += 4) {
		bins.red[pixels[i]]++; bins.green[pixels[i + 1]]++; bins.blue[pixels[i + 2]]++;
		if (pixels[i] === 0 || pixels[i + 1] === 0 || pixels[i + 2] === 0) low++;
		if (pixels[i] === 255 || pixels[i + 1] === 255 || pixels[i + 2] === 255) high++;
	}
	return { bins, sampledPixels: pixels.length / 4, lowClippedPixels: low, highClippedPixels: high };
}
async function histogram(dialog, words, locale, expected) {
	const svg = named(dialog, 'img', `${words.histogram}: ${words.after}`), maximum = Math.max(1, ...expected.bins.red, ...expected.bins.green, ...expected.bins.blue);
	const points = ['red', 'green', 'blue'].map(channel => ({ channel, points: expected.bins[channel].map((count, index) => `${index},${100 - count / maximum * 100}`).join(' ') }));
	await expect.poll(() => svg.evaluate(node => [...node.querySelectorAll('polyline')].map(line => ({ channel: line.getAttribute('stroke'), points: line.getAttribute('points') })))).toEqual(points);
	const number = new Intl.NumberFormat(locale);
	await expect.poll(() => svg.evaluate(node => [...node.parentElement.querySelectorAll('dl > *')].map(row => row.textContent))).toEqual(
		[words.samples, number.format(expected.sampledPixels), words.low, number.format(expected.lowClippedPixels), words.high, number.format(expected.highClippedPixels)]);
}
async function plane(canvas) {
	return canvas.evaluate(async node => {
		if (!node.width || !node.height) return null;
		const pixels = node.getContext('2d', { alpha: true, colorSpace: 'srgb' }).getImageData(0, 0, node.width, node.height).data;
		try { return { width: node.width, height: node.height, sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))].map(value => value.toString(16).padStart(2, '0')).join('') }; }
		finally { pixels.fill(0); }
	});
}
function assertCustody(value, initial) { expect(value.original).toEqual(initial.original); expect(value.namespace).toBe(initial.namespace); expect(value.previews).toEqual(initial.previews); }
function assertSaved(initial, saved) {
	expect(saved.revision).toBe(initial.revision + 1);
	expect({ ...saved, revision: initial.revision, versions: initial.versions }).toEqual(initial);
	const version = saved.versions.find(value => value.id === saved.activeVersionId), before = initial.versions.find(value => value.id === initial.activeVersionId);
	expect(version.develop.effects.map(({ type, enabled, params }) => ({ type, enabled, params }))).toEqual([{ type: 'detail-sharpen-v1', enabled: true, params: { amount: 50, threshold: 0 } }]);
	expect(version.develop.geometry).toEqual(before.develop.geometry); expect(version.develop.processVersion).toBe(before.develop.processVersion);
	expect(version.workspace.cursor).toBe(1); expect(version.workspace.entries).toHaveLength(2); expect(version.workspace.snapshots).toEqual([]);
}
function encode(value) { const n = Math.abs(value); return Math.sign(value) * (n <= .0031308 ? n * 12.92 : 1.055 * n ** (1 / 2.4) - .055); }
function decode(value) { const n = Math.abs(value); return Math.sign(value) * (n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4); }
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function named(root, role, name) { return root.getByRole(role, { name, exact: true }); }
function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
