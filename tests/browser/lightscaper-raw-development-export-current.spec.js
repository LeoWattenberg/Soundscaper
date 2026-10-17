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
import { photoDevelopRepairSpotsCopy } from '../../src/common/i18n/lightscaper-develop-repair-spots-copy.ts';
import { photoDevelopRawDevelopmentCopy } from '../../src/common/i18n/lightscaper-raw-development-copy.ts';
import { photoPngExportCopy } from '../../src/common/i18n/lightscaper-photo-png-export-copy.ts';
import { photoPngExportMenuLabel } from '../../src/common/i18n/lightscaper-photo-png-export-menu-copy.ts';
import { photoRasterDepthCopy } from '../../src/common/i18n/lightscaper-photo-raster-depth-copy.ts';
import { rawRecoveryDngFixtureV1 } from '../helpers/lightscaper-raw-recovery-dng-current-fixture.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';

test.use({ browserCoverage: false });
const PROGRAM = '/__lightscaper_raw_development_export_custody.js', NAME = 'Recovered native output.dng';
let program;
const binaries = [];
test.beforeAll(async () => {
	for (const name of ['lightscaper-libraw-runtime-manifest.json', 'lightscaper-libraw-recovery-runtime-manifest.json']) {
		const manifest = JSON.parse(await readFile(new URL(`../../config/${name}`, import.meta.url), 'utf8'));
		const bytes = await readFile(new URL(`../../${manifest.runtime.path}`, import.meta.url));
		expect(bytes.length).toBe(manifest.runtime.byteLength); expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.runtime.sha256);
		binaries.push({ url: manifest.runtime.url, bytes });
	}
	// This existing observer reads native custody and invokes the pinned C ABI.
	// It never publishes a Photo, supplies an app frame, or replaces a renderer.
	program = await compileNativeImageHandoffScript('raw-development-export-custody.js', fileURLToPath(new URL('./helpers/lightscaper-raw-development-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});

for (const locale of ['en', 'de']) test(`${locale}: saved RAW Headroom and Recovery export exact native PNG16 and retain Original custody after reload`, async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'This native RAW export workflow qualifies Chromium and Firefox.'); test.setTimeout(240_000);
	const copy = bundledLightscaperEditorCopyForLocale(locale), develop = photoDevelopCopy(locale), settings = photoDevelopSettingsCopy(locale, 'current3');
	const raw = photoDevelopRawDevelopmentCopy(locale), repairs = photoDevelopRepairSpotsCopy(locale), png = photoPngExportCopy(locale), depth = photoRasterDepthCopy(locale);
	const errors = [], workers = [], downloads = [];
	const original = Buffer.from(rawRecoveryDngFixtureV1({ orientation: 6 }).bytes), digest = createHash('sha256').update(original).digest('hex');
	page.on('pageerror', error => { errors.push(error.message); }); page.on('download', download => { downloads.push(download); });
	page.on('worker', worker => { if (new URL(worker.url()).pathname.includes('libraw-worker-v')) workers.push(worker.url()); });
	// Choose the real browser download destination; all native writers, codecs,
	// selected Sessions, Original readers and production workers remain intact.
	await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
	for (const binary of binaries) await page.route(binary.url, route => route.fulfill({ status: 200, headers: {
		'content-type': 'application/wasm', 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin',
	}, body: binary.bytes }));
	await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	await page.goto(resolveBrowserProductTestUrl(`/lightscaper/${locale}/`));
	const app = named(page, 'region', 'Lightscaper'); await expect(app).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(copy.photoFileMenu); await keyboard(named(app, 'button', copy.photoImportPhotos));
	const importer = named(page, 'dialog', copy.photoImportPhotos);
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: NAME, mimeType: 'image/png', buffer: original });
	await keyboard(named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
	const library = named(app, 'region', bundledSiteCopyForLocale(locale).workspacePhoto), card = app.getByRole('button', { name: /^Recovered native output\.dng/u });
	await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false'); await keyboard(card);
	const photoId = await card.getAttribute('data-photo-id'); expect(photoId).toBeTruthy();
	const initial = await observe(); immutable(initial);
	const expected = Object.fromEntries(['headroom', 'recovery'].map(mode => {
		const native = initial.native[mode];
		expect(native.descriptor).toEqual({ schemaVersion: 1, width: 96, height: 128, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' });
		expect(native.rawFlip).toBe(6); expect(native.samples.some((value, index) => index % 4 !== 3 && value > 1)).toBe(true);
		return [mode, nativeExportOracle(native.samples)];
	}));
	expect(initial.native.headroom.exposureScale).toBe(initial.native.recovery.exposureScale);
	expect(expected.headroom.word).not.toEqual(expected.recovery.word);
	const canonical = nativeExportOracle(Float32Array.from(initial.native.canonical.words, value => value / 65535));
	expect(expected.recovery.word).not.toEqual(canonical.word);
	let saved = initial, recoveryPng;
	for (const mode of ['headroom', 'recovery']) {
		await openDevelop(); const editing = named(page, 'dialog', `${develop.title}: ${NAME}`);
		await expect(editing.locator('[data-photo-develop-preview]')).toHaveAttribute('data-state', 'ready');
		const processing = await openProcessing(editing); await named(processing, 'combobox', raw.mode).selectOption(mode);
		await keyboard(named(processing, 'button', raw.apply)); await expect(processing).toHaveCount(0);
		if (mode === 'headroom') {
			await named(editing, 'combobox', develop.choose).selectOption('tone-ladder-v1'); await keyboard(named(editing, 'button', develop.add));
			const exposure = named(editing, 'spinbutton', `${develop.shared.videoEffectExactValue}: ${develop.shared.videoEffectParamExposure}`);
			await exposure.fill('-1'); await exposure.press('Enter'); await expect(exposure).toHaveValue('-1');
			await settingsMenu(editing); await keyboard(named(editing, 'button', repairs.menu)); const repair = named(page, 'dialog', repairs.title);
			await expect(named(repair, 'img', repairs.original)).toHaveAttribute('data-state', 'ready');
			await named(repair, 'combobox', repairs.mode).selectOption('clone');
			// Native orientation6 maps sensor donor(12,40) and target(72,40)
			// to upright(55,12)/(55,72). Radius0.24 covers one center only.
			for (const [field, value] of Object.entries({ targetX: 55.5 / 96, targetY: 72.5 / 128, sourceX: 55.5 / 96,
				sourceY: 12.5 / 128, radius: .0025, feather: 0, opacity: 1 })) await named(repair, 'spinbutton', repairs[field]).fill(String(value));
			await keyboard(named(repair, 'button', repairs.add)); await keyboard(named(repair, 'button', repairs.apply)); await expect(repair).toHaveCount(0);
		}
		await expect(editing.locator('[data-photo-develop-preview]')).toHaveAttribute('data-state', 'ready');
		await expect.poll(() => plane(named(editing, 'img', develop.after))).toEqual([96, 128, ...expected[mode].byte]);
		expect(await observe()).toEqual(saved);
		await keyboard(named(editing, 'button', develop.save)); await expect(editing.locator('[data-photo-develop-ack]')).toBeVisible();
		await expect(named(editing, 'button', develop.save)).toBeDisabled();
		const committed = await observe(); immutable(committed); unchanged(committed, initial); expect(committed.photo.revision).toBe(saved.photo.revision + 1);
		const recipe = active(committed.photo).develop; expect(recipe.processVersion).toBe(4); expect(recipe.rawDevelopment).toEqual({ schemaVersion: 1, mode });
		expect(recipe.repairs.spots).toHaveLength(1); expect(recipe.repairs.spots[0]).toMatchObject({ mode: 'clone', target: { x: 55.5 / 96, y: 72.5 / 128 }, source: { x: 55.5 / 96, y: 12.5 / 128 } });
		expect(recipe.effects.map(effect => [effect.type, effect.params.exposure])).toEqual([['tone-ladder-v1', -1]]);
		saved = committed; await close(editing, develop);
		const output = await openExport(); await named(output, 'combobox', depth.label).selectOption('16');
		if (mode === 'recovery') await checkbox(named(output, 'checkbox', png.sidecar));
		await saveExport(output, mode === 'headroom' ? 1 : 3);
		const bytes = await downloaded(mode === 'headroom' ? 0 : 1), decoded = readPng16(bytes);
		expect(decoded).toEqual({ width: 96, height: 128, samples: expected[mode].word });
		expect(decoded.samples.some((value, index) => index % 4 !== 3 && value % 257 !== 0)).toBe(true);
		if (mode === 'recovery') {
			recoveryPng = bytes; const sidecarBytes = await downloaded(2); expect(sidecarBytes.length).toBeLessThan(2_097_152);
			const sidecar = JSON.parse(sidecarBytes.toString('utf8'));
			expect(sidecar).toMatchObject({ schemaFamily: 'lightscaper', schemaVersion: 2, photoSchemaVersion: 3,
				binding: { photoId, revision: saved.photo.revision, activeVersionId: saved.photo.activeVersionId }, version: { develop: recipe } });
			expect(sidecar.original.contentSha256).toBe(digest); expect(sidecar.original.byteLength).toBe(original.length);
			expect(downloads[2].suggestedFilename()).toBe('Recovered native output.png.lightscaper.json');
		}
		expect(await observe()).toEqual(saved); await close(output, png);
	}
	await page.reload(); await expect(app).toBeVisible(); await menu(copy.photoViewMenu); await keyboard(named(app, 'button', copy.photoShowLibrary));
	await expect(card).toHaveCount(1); await keyboard(card); expect(await observe()).toEqual(saved);
	await openDevelop(); const editing = named(page, 'dialog', `${develop.title}: ${NAME}`);
	await expect(editing.locator('[data-photo-develop-preview]')).toHaveAttribute('data-state', 'ready');
	await expect.poll(() => plane(named(editing, 'img', develop.after))).toEqual([96, 128, ...expected.recovery.byte]);
	const processing = await openProcessing(editing); await expect(named(processing, 'combobox', raw.mode)).toHaveValue('recovery'); await close(processing, raw); await close(editing, develop);
	const output = await openExport(); await named(output, 'combobox', depth.label).selectOption('16'); await saveExport(output, 4);
	expect(await downloaded(3)).toEqual(recoveryPng); expect(readPng16(await downloaded(3)).samples).toEqual(expected.recovery.word);
	expect(await observe()).toEqual(saved); await close(output, png);
	expect(downloads.map(download => download.suggestedFilename())).toEqual(['Recovered native output.png', 'Recovered native output.png', 'Recovered native output.png.lightscaper.json', 'Recovered native output.png']);
	for (const version of [1, 2]) expect(workers.some(url => new URL(url).pathname.includes(`libraw-worker-v${version}-`))).toBe(true);
	for (const url of workers) { expect(new URL(url).origin).toBe(new URL(page.url()).origin); expect(new URL(url).pathname).toMatch(/\/assets\/libraw-worker-v[12]-[^/]+\.js$/u); }
	expect(errors).toEqual([]);

	async function keyboard(control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
	async function menu(label) { await keyboard(app.getByRole('navigation').getByText(label, { exact: true })); }
	async function openDevelop() { await menu(copy.photoFileMenu); await menu(copy.photoPhotoMenu); await keyboard(named(app, 'button', photoDevelopMenuLabel(locale))); }
	async function settingsMenu(dialog) { const summary = dialog.locator('summary').filter({ hasText: settings.menu });
		if (!await summary.locator('..').evaluate(details => details.open)) await keyboard(summary); }
	async function openProcessing(dialog) { await settingsMenu(dialog); await keyboard(named(dialog, 'button', raw.menu)); const processing = named(page, 'dialog', raw.title);
		await expect(named(processing, 'combobox', raw.mode)).toBeVisible(); return processing; }
	async function close(dialog, words) { await keyboard(named(dialog, 'button', words.close).last()); await expect(dialog).toHaveCount(0); }
	async function openExport() { await menu(copy.photoFileMenu); await keyboard(named(app, 'button', photoPngExportMenuLabel(locale))); const output = named(page, 'dialog', png.title);
		await expect(named(output, 'button', png.save)).toBeEnabled(); await expect(named(output, 'combobox', png.outputSize)).toHaveValue('original');
		await expect(named(output, 'combobox', png.metadata)).toHaveValue('strip'); await expect(named(output, 'checkbox', png.sidecar)).not.toBeChecked(); return output; }
	async function saveExport(dialog, count) { await keyboard(named(dialog, 'button', png.save));
		await expect(dialog.locator('[data-photo-png-export-receipt]')).toHaveAttribute('data-photo-png-export-status', 'download-started');
		await expect.poll(() => downloads.length).toBe(count); await expect(named(dialog, 'button', png.save)).toBeEnabled(); }
	async function checkbox(control) { await expect(control).not.toBeChecked(); await control.focus(); await page.keyboard.press('Space'); await expect(control).toBeChecked(); }
	async function downloaded(index) { const download = downloads[index]; expect(await download.failure()).toBeNull(); return readFile(await download.path()); }
	function observe() { return page.evaluate(async ({ pathname, photoId }) => (await import(new URL(pathname, location.href).href)).readRawDevelopmentCustodyCurrentV1(photoId), { pathname: PROGRAM, photoId }); }
	function immutable(value) { expect(value.bytes).toEqual([...original]); expect(value.original.sha256).toBe(digest); expect(value.original.byteLength).toBe(original.length);
		expect(value.photo.original.contentSha256).toBe(digest); expect(value.photo.original.mimeType).toBe('image/x-adobe-dng'); expect([value.photo.original.width, value.photo.original.height]).toEqual([96, 128]); }
});

function active(photo) { return photo.versions.find(version => version.id === photo.activeVersionId); }
function unchanged(value, baseline) { expect(value.original).toEqual(baseline.original); expect(value.photo.original).toEqual(baseline.photo.original);
	expect(value.bytes).toEqual(baseline.bytes); expect(value.native).toEqual(baseline.native); expect(value.namespace).toBe(baseline.namespace); }

/** Independent exact operations over the separately decoded native H1/H3
 * words. The native exposure scale is already applied. Clone precedes tone;
 * one Float32 write precedes the only sRGB clipping/quantization boundary. */
function nativeExportOracle(samples) {
	const repaired = Float32Array.from(samples), donor = (12 * 96 + 55) * 4, target = (72 * 96 + 55) * 4;
	for (let channel = 0; channel < 3; channel++) repaired[target + channel] = samples[donor + channel];
	const processed = Float32Array.from(repaired, (value, index) => index % 4 === 3 ? value : Math.fround(value * .5));
	const encoded = maximum => Array.from(processed, (value, index) => {
		const clamped = Math.max(0, Math.min(1, value));
		return Math.round(maximum * (index % 4 === 3 ? clamped : clamped <= .0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - .055));
	});
	return { byte: encoded(255), word: encoded(65535) };
}

/** Independent PNG CRC/container/zlib/filter decoder, bounded to this actual
 * native fixture. It imports no production image reader or output kernel. */
function readPng16(bytes) {
	expect(bytes.length).toBeLessThan(1_048_576); expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	const chunks = [], compressed = []; let at = 8;
	while (at < bytes.length) {
		expect(at + 12).toBeLessThanOrEqual(bytes.length); const size = bytes.readUInt32BE(at), end = at + size + 12;
		expect(end).toBeLessThanOrEqual(bytes.length); const type = bytes.toString('ascii', at + 4, at + 8), data = bytes.subarray(at + 8, end - 4);
		expect(bytes.readUInt32BE(end - 4)).toBe(crc32(bytes.subarray(at + 4, end - 4))); chunks.push({ type, data });
		if (type === 'IDAT') compressed.push(data); at = end;
	}
	expect(at).toBe(bytes.length); expect(chunks[0].type).toBe('IHDR'); expect(chunks.at(-1)).toEqual({ type: 'IEND', data: Buffer.alloc(0) });
	expect(chunks.filter(chunk => chunk.type === 'IHDR')).toHaveLength(1); expect(chunks.filter(chunk => chunk.type === 'sRGB').map(chunk => [...chunk.data])).toEqual([[0]]);
	for (const chunk of chunks) expect(['IHDR', 'sRGB', 'IDAT', 'IEND']).toContain(chunk.type);
	const header = chunks[0].data; expect(header.length).toBe(13); const width = header.readUInt32BE(0), height = header.readUInt32BE(4);
	expect([...header.subarray(8)]).toEqual([16, 6, 0, 0, 0]); expect([width, height]).toEqual([96, 128]);
	const pixelBytes = 8, rowBytes = width * pixelBytes, raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: (rowBytes + 1) * height });
	expect(raw.length).toBe((rowBytes + 1) * height); const decoded = Buffer.alloc(rowBytes * height);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (rowBytes + 1)]; expect(filter).toBeLessThanOrEqual(4);
		for (let x = 0; x < rowBytes; x++) {
			const left = x >= pixelBytes ? decoded[y * rowBytes + x - pixelBytes] : 0, above = y ? decoded[(y - 1) * rowBytes + x] : 0;
			const corner = y && x >= pixelBytes ? decoded[(y - 1) * rowBytes + x - pixelBytes] : 0;
			let prediction = 0;
			if (filter === 1) prediction = left; else if (filter === 2) prediction = above; else if (filter === 3) prediction = Math.floor((left + above) / 2);
			else if (filter === 4) { const estimate = left + above - corner, a = Math.abs(estimate - left), b = Math.abs(estimate - above), c = Math.abs(estimate - corner);
				prediction = a <= b && a <= c ? left : b <= c ? above : corner; }
			decoded[y * rowBytes + x] = (raw[y * (rowBytes + 1) + 1 + x] + prediction) & 255;
		}
	}
	return { width, height, samples: Array.from({ length: decoded.length / 2 }, (_, index) => decoded.readUInt16BE(index * 2)) };
}
function crc32(bytes) { let crc = 0xffffffff; for (const value of bytes) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function plane(canvas) { return canvas.evaluate(node => [node.width, node.height, ...(node.width && node.height ? node.getContext('2d').getImageData(0, 0, node.width, node.height).data : [])]); }
function named(root, role, name) { return root.getByRole(role, { name, exact: true }); }
