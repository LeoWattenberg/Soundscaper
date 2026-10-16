/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoDevelopSettingsCopy } from '../../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopPreviewRendererCopy } from '../../src/common/i18n/lightscaper-develop-preview-renderer-copy.ts';
import { hdrMergeBrowserFixtureCurrentV1 } from './helpers/lightscaper-hdr-merge-current-fixture.ts';
import { editLightscaperDevelopNumberCurrentV1 } from './helpers/lightscaper-develop-numeric-keyboard-current.ts';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { expect, test } from './helpers/browser-coverage-fixture.js';

test.skip(({ browserName }) => test.info().project.name !== 'lightscaper-software-gpu' && browserName !== 'firefox',
	'Optics Preview UI requires pinned software Chromium or actual Firefox capability/fallback.');
const PROGRAM = '/__lightscaper_develop_gpu_optics_current.js';
let fixture, program, manifest;
test.beforeAll(async () => {
	fixture = await hdrMergeBrowserFixtureCurrentV1();
	manifest = JSON.parse(await readFile(new URL('../../config/lightscaper-libraw-runtime-manifest.json', import.meta.url), 'utf8'));
	expect(fixture.wasm.byteLength).toBe(manifest.runtime.byteLength); expect(createHash('sha256').update(fixture.wasm).digest('hex')).toBe(manifest.runtime.sha256);
	program = await compileNativeImageHandoffScript('develop-gpu-optics-current.js', fileURLToPath(new URL('./helpers/lightscaper-develop-gpu-optics-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});

for (const locale of ['en', 'de']) test(`${locale}: real RAW optics menus retain native order through GPU preference, proxy Full Save and reopen`, async ({ page, browserName }) => {
	test.setTimeout(300_000);
	const copy = bundledLightscaperEditorCopyForLocale(locale), words = photoDevelopCopy(locale), settings = photoDevelopSettingsCopy(locale, 'current3');
	const renderer = photoDevelopPreviewRendererCopy(locale), source = fixture.sources[0], original = Buffer.from(source.bytes), errors = [], workers = [];
	page.on('pageerror', error => { errors.push(error.message); }); page.on('worker', worker => { if (worker.url().includes('libraw-worker-v1')) workers.push(worker.url()); });
	await page.route(manifest.runtime.url, route => route.fulfill({ status: 200, headers: {
		'content-type': 'application/wasm', 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin',
	}, body: Buffer.from(fixture.wasm) }));
	await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	await page.goto(resolveBrowserProductTestUrl(`/lightscaper/${locale}/`));
	const app = named(page, 'region', 'Lightscaper'); await expect(app).toBeVisible(); await photoAction(copy.photoImportPhotos);
	const importer = named(page, 'dialog', copy.photoImportPhotos);
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: source.name, mimeType: 'image/png', buffer: original });
	await keyboard(named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0); await library();
	const card = app.locator('[data-photo-id]'); await expect(card).toHaveCount(1); const photoId = await card.getAttribute('data-photo-id'); expect(photoId).toBeTruthy();
	const initial = await custody(); immutable(initial); const expected = await helper('gpuOpticsWordsReferenceCurrentV1', initial.native.words);
	await observe('start');
	try {
		await keyboard(card); await photoAction(photoDevelopMenuLabel(locale), true);
		const dialog = named(page, 'dialog', `${words.title}: ${source.name}`), preview = dialog.locator('[data-photo-develop-preview]');
		await painted(expected.before); await add('lens-distortion-v1');
		const lens = group('videoEffectLensDistortion'); await numeric(lens, 'videoEffectLensDistortionAmount', '45', 'Escape'); await painted(expected.before);
		await numeric(lens, 'videoEffectLensDistortionAmount', '-100');
		await add('chromatic-aberration-v1'); const ca = group('videoEffectChromaticAberration');
		await numeric(ca, 'videoEffectChromaticAberrationRed', '-100'); await numeric(ca, 'videoEffectChromaticAberrationBlue', '-100');
		await add('defringe-v1'); const fringe = group('videoEffectDefringe');
		await numeric(fringe, 'videoEffectDefringePurple', '75'); await numeric(fringe, 'videoEffectDefringeGreen', '50'); await numeric(fringe, 'videoEffectDefringeEdgeThreshold', '0');
		await add('optical-vignette-v1'); await numeric(group('videoEffectOpticalVignette'), 'videoEffectOpticalVignetteAmount', '50');
		await painted(expected.after); expect((await observation()).attempts).toBe(0); expect(await custody()).toEqual(initial);
		await keyboard(named(dialog, 'button', words.save)); await expect(dialog.locator('[data-photo-develop-ack]')).toBeVisible(); await expect(named(dialog, 'button', words.save)).toBeDisabled();
		await painted(expected.after); const saved = await custody(); immutable(saved); expect(saved.photo.revision).toBe(initial.photo.revision + 1);
		const recipe = active(saved.photo).develop, authored = await helper('gpuOpticsAuthoredEffectsCurrentV1');
		expect(recipe.effects.map(({ type, enabled, params }) => ({ type, enabled, params }))).toEqual(authored.map(({ type, enabled, params }) => ({ type, enabled, params })));
		expect({ ...recipe, effects: active(initial.photo).develop.effects }).toEqual(active(initial.photo).develop);
		expect(active(saved.photo).workspace.cursor).toBe(1); expect(active(saved.photo).workspace.entries).toHaveLength(2); expect((await observation()).attempts).toBe(0);
		await observe('stop');
		const qualified = await helper('qualifyGpuOpticsWordsCurrentV1', { words: initial.native.words, develop: recipe });
		expect(qualified.rejected).toBe(false); expect(qualified.callbacks).toBe(1); expect(qualified.outputRetired).toBe(true); expect(qualified.sourceBits).toEqual(expected.sourceBits); expect(qualified.expected.bits).toEqual(expected.bits);
		if (qualified.backend === 'cpu') { expect(typeof qualified.reason).toBe('string'); if (browserName === 'chromium') expect(qualified.reason).toBe('numeric-range'); expect(qualified.bits).toEqual(expected.bits); }
		else nativeValues(qualified.bits, expected.bits);
		await observe('start'); await rendererMenu(); const choice = named(page, 'dialog', renderer.title);
		await expect(named(choice, 'combobox', renderer.renderer)).toHaveValue('cpu'); await named(choice, 'combobox', renderer.renderer).selectOption('gpu-preferred');
		await keyboard(named(choice, 'button', renderer.apply)); await expect(choice).toHaveCount(0); await painted(expected.after, qualified.backend === 'webgl2'); nativeAfter(await observation()); expect(await custody()).toEqual(saved);
		await observe('reset'); await resolution('full'); await painted(expected.after, qualified.backend === 'webgl2'); nativeAfter(await observation()); await expect(named(dialog, 'region', words.imageViewport)).toBeVisible();
		await observe('reset'); await resolution('proxy'); await painted(expected.after, qualified.backend === 'webgl2'); nativeAfter(await observation()); await expect(named(dialog, 'region', words.imageViewport)).toHaveCount(0);
		expect(await custody()).toEqual(saved); await close(); await observe('stop');
		await page.reload(); await expect(app).toBeVisible(); await library(); expect(await custody()).toEqual(saved);
		await observe('start'); await keyboard(card); await photoAction(photoDevelopMenuLabel(locale), true); await painted(expected.after);
		await rendererMenu(); const reopened = named(page, 'dialog', renderer.title); await expect(named(reopened, 'combobox', renderer.renderer)).toHaveValue('cpu');
		await keyboard(named(reopened, 'button', renderer.close).last()); await expect(reopened).toHaveCount(0); await painted(expected.after);
		expect((await observation()).attempts).toBe(0); expect(await custody()).toEqual(saved); await close(); expect(errors).toEqual([]); expect(workers.length).toBeGreaterThan(0);
		for (const url of workers) { expect(new URL(url).origin).toBe(new URL(page.url()).origin); expect(new URL(url).pathname).toMatch(/\/assets\/libraw-worker-v1-[^/]+\.js$/u); }

		async function add(type) { await named(dialog, 'combobox', words.choose).selectOption(type); await keyboard(named(dialog, 'button', words.add)); }
		function group(key) { return named(dialog, 'group', words.shared[key]); }
		async function numeric(scope, key, value, action = 'Enter') { const control = named(scope, 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared[key]}`);
			if (action === 'Escape') { await control.focus(); await expect(control).toBeFocused(); await control.press('ControlOrMeta+A'); for (const character of value) await control.press(character); await control.press('Escape'); }
			else await editLightscaperDevelopNumberCurrentV1(control, value);
			await expect(control).toHaveValue(action === 'Escape' ? '0' : value); }
		async function painted(pixels, approximate = false) { await expect(preview).toHaveAttribute('data-state', 'ready');
			await expect.poll(() => plane(named(dialog, 'img', words.before))).toEqual([32, 32, ...expected.before]);
			if (!approximate) await expect.poll(() => plane(named(dialog, 'img', words.after))).toEqual([32, 32, ...pixels]);
			else await expect.poll(async () => { const output = await plane(named(dialog, 'img', words.after));
				return output.length === pixels.length + 2 && output[0] === 32 && output[1] === 32 && pixels.every((n, at) => at % 4 === 3 ? output[at + 2] === n : Math.abs(output[at + 2] - n) <= 1); }).toBe(true);
			await expect(dialog.getByRole('alert')).toHaveCount(0); }
		async function settingsMenu() { const summary = dialog.locator('summary').filter({ hasText: new RegExp(`^${escape(settings.menu)}$`, 'u') }); if (!await summary.evaluate(node => node.parentElement.open)) await keyboard(summary); }
		async function rendererMenu() { await settingsMenu(); await keyboard(named(dialog, 'button', renderer.menu)); }
		async function resolution(value) { await settingsMenu(); await keyboard(named(dialog, 'button', value === 'full' ? words.fullResolution : words.fitResolution)); await expect(dialog.locator('[data-resolution]')).toHaveAttribute('data-resolution', value); }
		async function close() { await keyboard(named(dialog.locator('.lightscaper-develop-actions'), 'button', words.close)); await expect(dialog).toHaveCount(0); }
		function nativeAfter(value) {
			expect(value.aliveHandles).toBe(0); expect(value.readbacksRetired).toBe(true); expect(value.uploadBackingsRetired).toBe(true); expect(value.changingReadbacksRetired).toBe(true); expect(value.opticsReadbacksRetired).toBe(true);
			for (const kind of Object.keys(value.created)) expect(value.deleted[kind], kind).toBe(value.created[kind]);
			if (qualified.backend === 'webgl2' || value.normalFloatSupported) {
				expect(value.opticsPrograms).toBeGreaterThan(0); expect(value.readbacks.length).toBeGreaterThan(0);
				for (const read of value.readbacks) { expect([read.width, read.height]).toEqual([32, 32]); expect(read.passes.map(pass => [pass.kind, ...pass.extent])).toEqual([[10, 32, 32], [11, 32, 32], [12, 32, 32], [13, 32, 32]]);
					// Rejected raw readbacks are attempts, never accepted native output.
					if (qualified.backend === 'webgl2') nativeValues(read.bits, expected.bits); }
				expect(value.sourceUploads.some(source => source.every((n, at) => n === expected.sourceBits[at]))).toBe(true);
				if (test.info().project.name === 'lightscaper-software-gpu') for (const context of value.contexts) expect(context.renderer).toContain('SwiftShader');
			} else expect(value.readbacks).toEqual([]);
		}
	} finally { await observe('stop'); }
	function immutable(value) { expect(value.bytes).toEqual([...original]); expect(value.original.sha256).toBe(source.sha256); expect(value.native.words).toEqual(fixture.words[0]); expect(value.native.rawFlip).toBe(6);
		if (value !== initial) { expect(value.original).toEqual(initial.original); expect(value.namespace).toBe(initial.namespace); expect(value.photo.original).toEqual(initial.photo.original); } }
	function custody() { return helper('readGpuOpticsPhotoCustodyCurrentV1', photoId); }
	function observe(action) { return helper(`${action}GpuOpticsUiObservationCurrentV1`); }
	function observation() { return helper('readGpuOpticsUiObservationCurrentV1'); }
	function helper(method, value) { return page.evaluate(async ({ path, method, value }) => (await import(path))[method](value), { path: PROGRAM, method, value }); }
	async function photoMenu(label) { const summary = app.getByRole('navigation').getByText(label, { exact: true }); if (!await summary.locator('..').evaluate(node => node.open)) await keyboard(summary); }
	async function photoAction(label, nested = false) { await photoMenu(copy.photoFileMenu); if (nested) await photoMenu(copy.photoPhotoMenu); await keyboard(named(app, 'button', label)); }
	async function library() { const target = app.locator('[data-photo-library]'); if (!await target.isVisible()) { await photoMenu(copy.photoViewMenu); await keyboard(named(app, 'button', copy.photoShowLibrary)); } await expect(target).toHaveAttribute('aria-busy', 'false'); }
});
// The authored lens/CA stack reconstructs nonlocal samples; same-index
// Original equality cannot establish a copied ancestor in its final output.
function nativeValues(actual, expected) { expect(actual).toHaveLength(expected.length); const values = new Float32Array(Uint32Array.from(expected).buffer);
	for (let at = 0; at < expected.length; at++) { if (at % 4 === 3 || values[at] === 0 || Math.abs(values[at]) < 2 ** -60) expect(actual[at], `exact native sample${at}`).toBe(expected[at]);
		else expect(Math.abs(ordered(actual[at]) - ordered(expected[at])), `8ULP native sample${at}`).toBeLessThanOrEqual(8); } }
function ordered(bits) { return bits & 0x80000000 ? 0x80000000 - (bits & 0x7fffffff) : 0x80000000 + bits; }
function active(photo) { const value = photo.versions.find(version => version.id === photo.activeVersionId); expect(value).toBeTruthy(); return value; }
function plane(canvas) { return canvas.evaluate(node => [node.width, node.height, ...node.getContext('2d').getImageData(0, 0, node.width, node.height).data]); }
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(control) { await expect(control).toBeEnabled(); await control.focus(); await control.press('Enter'); }
function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
