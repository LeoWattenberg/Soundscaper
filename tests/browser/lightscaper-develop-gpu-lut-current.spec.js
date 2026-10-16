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
	'GPU LUT UI conformance requires pinned software Chromium or actual Firefox capability/fallback.');
const PROGRAM = '/__lightscaper_develop_gpu_lut_current.js';
const CUBE = Buffer.from(`LUT_3D_SIZE 2\n${Array.from({ length: 8 }, () => '-0.125 0.25 1.5').join('\n')}\n`);
const SHA = createHash('sha256').update(CUBE).digest('hex');
const REFERENCE = { storageKey: `lut-sha256:${SHA}`, sha256: SHA, byteLength: CUBE.length, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
const LUT = Array.from({ length: 1024 }, () => [0, 137, 255, 255]).flat(), AFTER = Array.from({ length: 1024 }, () => [0, 188, 255, 255]).flat();
const BITS = [...new Uint32Array(Float32Array.from(Array.from({ length: 1024 }, () => [-.25, .5, 3, 1]).flat()).buffer)];
let fixture, program, manifest;
test.beforeAll(async () => {
	fixture = await hdrMergeBrowserFixtureCurrentV1();
	manifest = JSON.parse(await readFile(new URL('../../config/lightscaper-libraw-runtime-manifest.json', import.meta.url), 'utf8'));
	expect(fixture.wasm.byteLength).toBe(manifest.runtime.byteLength); expect(createHash('sha256').update(fixture.wasm).digest('hex')).toBe(manifest.runtime.sha256);
	program = await compileNativeImageHandoffScript('develop-gpu-lut-current.js', fileURLToPath(new URL('./helpers/lightscaper-develop-gpu-lut-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});

for (const locale of ['en', 'de']) test(`${locale}: real RAW and immutable cube import execute accepted GPU LUT preview and retain saved Original/resource custody`, async ({ page, browserName }) => {
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
	const initial = await custody(); originalUnchanged(initial); const before = display(fixture.words[0]);
	await observe('start');
	try {
		await keyboard(card); await photoAction(photoDevelopMenuLabel(locale), true);
		const dialog = named(page, 'dialog', `${words.title}: ${source.name}`), preview = dialog.locator('[data-photo-develop-preview]');
		await painted(before); await add('cube-lut-profile-v1');
		await dialog.getByLabel(words.shared.videoEffectCubeLutImport, { exact: true }).setInputFiles({ name: 'Native signed HDR.cube', mimeType: 'text/plain', buffer: CUBE });
		await painted(LUT); await add('tone-ladder-v1');
		const exposure = named(dialog, 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectParamExposure}`);
		await editLightscaperDevelopNumberCurrentV1(exposure, '1', () => expect(preview).toHaveAttribute('data-state', 'ready')); await expect(exposure).toHaveValue('1'); await painted(AFTER);
		expect((await observation()).attempts).toBe(0); expect(await custody()).toEqual(initial);
		const lut = await lutCustody(); expect(lut.reference).toEqual(REFERENCE); expect(lut.bytes).toEqual([...CUBE]);
		await observe('stop');
		const qualified = await helper('qualifyGpuLutPhotoCurrentV1', { words: initial.native.words, reference: REFERENCE });
		expect(qualified.callbacks).toBe(1); expect(qualified.sourceUnchanged).toBe(true); expect(qualified.outputRetired).toBe(true); expect(qualified.bits).toEqual(BITS);
		if (browserName === 'chromium') expect(qualified.backend, qualified.reason).toBe('webgl2');
		else if (qualified.backend === 'cpu') expect(qualified.reason.length).toBeGreaterThan(0);
		await observe('start'); await rendererMenu(); const choice = named(page, 'dialog', renderer.title);
		await expect(named(choice, 'combobox', renderer.renderer)).toHaveValue('cpu'); await named(choice, 'combobox', renderer.renderer).selectOption('gpu-preferred');
		await keyboard(named(choice, 'button', renderer.apply)); await expect(choice).toHaveCount(0); await painted(AFTER); nativeAfter(await observation());
		expect(await custody()).toEqual(initial); expect(await lutCustody()).toEqual(lut);
		await keyboard(named(dialog, 'button', words.save)); await expect(dialog.locator('[data-photo-develop-ack]')).toBeVisible();
		await expect(named(dialog, 'button', words.save)).toBeDisabled(); await painted(AFTER);
		const saved = await custody(); originalUnchanged(saved); expect(saved.photo.revision).toBe(initial.photo.revision + 1);
		const recipe = active(saved.photo).develop;
		expect(recipe.effects).toHaveLength(2); expect(recipe.effects[0]).toMatchObject({ type: 'cube-lut-profile-v1', enabled: true, params: { lut: REFERENCE } });
		expect(recipe.effects[1]).toMatchObject({ type: 'tone-ladder-v1', enabled: true, params: { exposure: 1 } });
		expect(recipe.processVersion).toBe(2);
		expect({ ...recipe, effects: active(initial.photo).develop.effects, processVersion: active(initial.photo).develop.processVersion }).toEqual(active(initial.photo).develop);
		expect(active(saved.photo).workspace.cursor).toBe(1); expect(active(saved.photo).workspace.entries).toHaveLength(2);
		await observe('reset'); await resolution('full'); await painted(AFTER); nativeAfter(await observation()); await expect(named(dialog, 'region', words.imageViewport)).toBeVisible();
		await observe('reset'); await resolution('proxy'); await painted(AFTER); nativeAfter(await observation()); await expect(named(dialog, 'region', words.imageViewport)).toHaveCount(0);
		expect(await custody()).toEqual(saved); expect(await lutCustody()).toEqual(lut);
		await close(); await observe('stop'); await page.reload(); await expect(app).toBeVisible(); await library();
		expect(await custody()).toEqual(saved); expect(await lutCustody()).toEqual(lut);
		await observe('start'); await keyboard(card); await photoAction(photoDevelopMenuLabel(locale), true); await painted(AFTER);
		await rendererMenu(); const reopened = named(page, 'dialog', renderer.title); await expect(named(reopened, 'combobox', renderer.renderer)).toHaveValue('cpu');
		await keyboard(named(reopened, 'button', renderer.close).last()); await expect(reopened).toHaveCount(0); await painted(AFTER);
		expect((await observation()).attempts).toBe(0); expect(await custody()).toEqual(saved); expect(await lutCustody()).toEqual(lut); await close(); expect(errors).toEqual([]);
		expect(workers.length).toBeGreaterThan(0);
		for (const url of workers) { expect(new URL(url).origin).toBe(new URL(page.url()).origin); expect(new URL(url).pathname).toMatch(/\/assets\/libraw-worker-v1-[^/]+\.js$/u); }

		async function add(type) { await named(dialog, 'combobox', words.choose).selectOption(type); await keyboard(named(dialog, 'button', words.add));
			await expect(preview).toHaveAttribute('data-state', 'ready'); }
		async function painted(expected) { await expect(preview).toHaveAttribute('data-state', 'ready'); await expect.poll(() => plane(named(dialog, 'img', words.before))).toEqual([32, 32, ...before]);
			await expect.poll(() => plane(named(dialog, 'img', words.after))).toEqual([32, 32, ...expected]); await expect(dialog.getByRole('alert')).toHaveCount(0); }
		async function settingsMenu() { const summary = dialog.locator('summary').filter({ hasText: new RegExp(`^${escape(settings.menu)}$`, 'u') });
			if (!await summary.evaluate(node => node.parentElement.open)) await keyboard(summary); }
		async function rendererMenu() { await settingsMenu(); await keyboard(named(dialog, 'button', renderer.menu)); }
		async function resolution(value) { await settingsMenu(); await keyboard(named(dialog, 'button', value === 'full' ? words.fullResolution : words.fitResolution));
			await expect(dialog.locator('[data-resolution]')).toHaveAttribute('data-resolution', value); }
		async function close() { await keyboard(named(dialog.locator('.lightscaper-develop-actions'), 'button', words.close)); await expect(dialog).toHaveCount(0); }
		function nativeAfter(value) {
			expect(value.aliveHandles).toBe(0); expect(value.readbacksRetired).toBe(true); expect(value.uploadBackingsRetired).toBe(true);
			for (const kind of Object.keys(value.created)) expect(value.deleted[kind], kind).toBe(value.created[kind]);
			const reads = value.readbacks.filter(read => read.passes.map(pass => pass.kind).join(',') === '8,2');
			if (qualified.backend === 'webgl2') {
				expect(reads.length).toBeGreaterThan(0); for (const read of reads) expect(read.bits).toEqual(BITS);
				expect(value.uploads.some(upload => upload.width === 2 && upload.height === 2 && upload.depth === 2 && upload.floating)).toBe(true);
				if (test.info().project.name === 'lightscaper-software-gpu') for (const context of value.contexts) expect(context.renderer).toContain('SwiftShader');
			} else expect(reads).toEqual([]);
		}
	} finally { await observe('stop'); }

	function originalUnchanged(value) { expect(value.bytes).toEqual([...original]); expect(value.original.sha256).toBe(source.sha256);
		expect(value.native.words).toEqual(fixture.words[0]); expect(value.native.rawFlip).toBe(6); expect(value.photo.original.mimeType).toBe('image/x-adobe-dng');
		if (value !== initial) { expect(value.original).toEqual(initial.original); expect(value.namespace).toBe(initial.namespace); expect(value.photo.original).toEqual(initial.photo.original); } }
	function custody() { return helper('readGpuLutPhotoCustodyCurrentV1', photoId); }
	function lutCustody() { return helper('readGpuLutCustodyCurrentV1', REFERENCE); }
	function observe(action) { return helper(`${action}GpuLutObservationCurrentV1`); }
	function observation() { return helper('readGpuLutObservationCurrentV1'); }
	function helper(method, value) { return page.evaluate(async ({ path, method, value }) => (await import(path))[method](value), { path: PROGRAM, method, value }); }
	async function photoMenu(label) { const summary = app.getByRole('navigation').getByText(label, { exact: true }); if (!await summary.locator('..').evaluate(node => node.open)) await keyboard(summary); }
	async function photoAction(label, nested = false) { await photoMenu(copy.photoFileMenu); if (nested) await photoMenu(copy.photoPhotoMenu); await keyboard(named(app, 'button', label)); }
	async function library() { const target = app.locator('[data-photo-library]'); if (!await target.isVisible()) { await photoMenu(copy.photoViewMenu); await keyboard(named(app, 'button', copy.photoShowLibrary)); }
		await expect(target).toHaveAttribute('aria-busy', 'false'); }
});

function display(words) { return words.map((n, at) => { if (at % 4 === 3) return 255; const value = Math.fround(n / 65535);
	return Math.round((value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055) * 255); }); }
function active(photo) { const value = photo.versions.find(version => version.id === photo.activeVersionId); expect(value).toBeTruthy(); return value; }
function plane(canvas) { return canvas.evaluate(node => [node.width, node.height, ...node.getContext('2d').getImageData(0, 0, node.width, node.height).data]); }
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(control) { await expect(control).toBeEnabled(); await control.focus(); await control.press('Enter'); }
function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
