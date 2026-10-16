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
	'Geometry Preview UI requires pinned software Chromium or actual Firefox capability/fallback.');
const PROGRAM = '/__lightscaper_develop_gpu_geometry_current.js';
let fixture, program, manifest;
test.beforeAll(async () => {
	fixture = await hdrMergeBrowserFixtureCurrentV1();
	manifest = JSON.parse(await readFile(new URL('../../config/lightscaper-libraw-runtime-manifest.json', import.meta.url), 'utf8'));
	expect(fixture.wasm.byteLength).toBe(manifest.runtime.byteLength); expect(createHash('sha256').update(fixture.wasm).digest('hex')).toBe(manifest.runtime.sha256);
	program = await compileNativeImageHandoffScript('develop-gpu-geometry-current.js', fileURLToPath(new URL('./helpers/lightscaper-develop-gpu-geometry-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});

for (const locale of ['en', 'de']) test(`${locale}: RAW crop/rotation menus preserve native geometry through GPU preference, Full/Fit, Save and reload`, async ({ page, browserName }) => {
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
	const initial = await custody(); immutable(initial);
	const expected = await helper('gpuGeometryWordsReferenceCurrentV1', initial.native.words);
	await observe('start');
	try {
		await keyboard(card); await photoAction(photoDevelopMenuLabel(locale), true);
		const dialog = named(page, 'dialog', `${words.title}: ${source.name}`), preview = dialog.locator('[data-photo-develop-preview]');
		await painted(32, 32, expected.before); await named(dialog, 'combobox', words.choose).selectOption('develop-geometry-v1'); await keyboard(named(dialog, 'button', words.add));
		for (const [key, value] of [['CropWidth', '0.5'], ['CropHeight', '0.25'], ['CropX', '0.5'], ['CropY', '0.5'], ['GeometryRotation', '90']]) {
			const control = named(dialog, 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared[`videoEffectParam${key}`]}`);
			await editLightscaperDevelopNumberCurrentV1(control, value); await expect(control).toHaveValue(value);
		}
		await named(dialog, 'combobox', `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectParamFlipHorizontal}`).selectOption('1');
		await painted(8, 16, expected.after); expect((await observation()).attempts).toBe(0); expect(await custody()).toEqual(initial);
		await keyboard(named(dialog, 'button', words.save)); await expect(dialog.locator('[data-photo-develop-ack]')).toBeVisible(); await expect(named(dialog, 'button', words.save)).toBeDisabled();
		await painted(8, 16, expected.after); const saved = await custody(); immutable(saved); expect(saved.photo.revision).toBe(initial.photo.revision + 1);
		const recipe = active(saved.photo).develop; expect(recipe.effects).toHaveLength(1);
		expect(recipe.effects[0]).toMatchObject({ type: 'develop-geometry-v1', enabled: true, params: { cropX: .5, cropY: .5, cropWidth: .5, cropHeight: .25, rotationDegrees: 90, flipHorizontal: 1 } });
		expect({ ...recipe, effects: active(initial.photo).develop.effects }).toEqual(active(initial.photo).develop);
		expect(active(saved.photo).workspace.cursor).toBe(1); expect(active(saved.photo).workspace.entries).toHaveLength(2); expect((await observation()).attempts).toBe(0);
		await observe('stop');
		// The exact saved recipe and native words determine whether this driver
		// accepts GPU delivery. A rejected raw attempt never relaxes CPU pixels.
		const qualified = await helper('qualifyGpuGeometryWordsCurrentV1', { words: initial.native.words, develop: recipe });
		expect(qualified.rejected).toBe(false); expect(qualified.callbacks).toBe(1); expect(qualified.outputRetired).toBe(true); expect(qualified.sourceBits).toEqual(expected.sourceBits);
		expect(qualified.expected.bits).toEqual(expected.bits); expect(qualified.bits).toEqual(expected.bits); expect([qualified.descriptor.width, qualified.descriptor.height]).toEqual([8, 16]);
		if (qualified.backend === 'cpu') { expect(typeof qualified.reason).toBe('string'); if (browserName === 'chromium') expect(qualified.reason).toBe('numeric-range'); }
		await observe('start'); await rendererMenu(); const choice = named(page, 'dialog', renderer.title);
		await expect(named(choice, 'combobox', renderer.renderer)).toHaveValue('cpu'); await named(choice, 'combobox', renderer.renderer).selectOption('gpu-preferred');
		await keyboard(named(choice, 'button', renderer.apply)); await expect(choice).toHaveCount(0); await painted(8, 16, expected.after); nativeAfter(await observation()); expect(await custody()).toEqual(saved);
		await observe('reset'); await resolution('full'); await painted(8, 16, expected.after); nativeAfter(await observation()); await expect(named(dialog, 'region', words.imageViewport)).toBeVisible();
		await observe('reset'); await resolution('proxy'); await painted(8, 16, expected.after); nativeAfter(await observation()); await expect(named(dialog, 'region', words.imageViewport)).toHaveCount(0);
		expect(await custody()).toEqual(saved); await close(); await observe('stop');
		await page.reload(); await expect(app).toBeVisible(); await library(); expect(await custody()).toEqual(saved);
		await observe('start'); await keyboard(card); await photoAction(photoDevelopMenuLabel(locale), true); await painted(8, 16, expected.after);
		await rendererMenu(); const reopened = named(page, 'dialog', renderer.title); await expect(named(reopened, 'combobox', renderer.renderer)).toHaveValue('cpu');
		await keyboard(named(reopened, 'button', renderer.close).last()); await expect(reopened).toHaveCount(0); await painted(8, 16, expected.after);
		expect((await observation()).attempts).toBe(0); expect(await custody()).toEqual(saved); await close(); expect(errors).toEqual([]); expect(workers.length).toBeGreaterThan(0);
		for (const url of workers) { expect(new URL(url).origin).toBe(new URL(page.url()).origin); expect(new URL(url).pathname).toMatch(/\/assets\/libraw-worker-v1-[^/]+\.js$/u); }

		async function painted(width, height, pixels) { await expect(preview).toHaveAttribute('data-state', 'ready');
			await expect.poll(() => plane(named(dialog, 'img', words.before))).toEqual([32, 32, ...expected.before]);
			await expect.poll(() => plane(named(dialog, 'img', words.after))).toEqual([width, height, ...pixels]); await expect(dialog.getByRole('alert')).toHaveCount(0); }
		async function settingsMenu() { const summary = dialog.locator('summary').filter({ hasText: new RegExp(`^${escape(settings.menu)}$`, 'u') });
			if (!await summary.evaluate(node => node.parentElement.open)) await keyboard(summary); }
		async function rendererMenu() { await settingsMenu(); await keyboard(named(dialog, 'button', renderer.menu)); }
		async function resolution(value) { await settingsMenu(); await keyboard(named(dialog, 'button', value === 'full' ? words.fullResolution : words.fitResolution)); await expect(dialog.locator('[data-resolution]')).toHaveAttribute('data-resolution', value); }
		async function close() { await keyboard(named(dialog.locator('.lightscaper-develop-actions'), 'button', words.close)); await expect(dialog).toHaveCount(0); }
		function nativeAfter(value) {
			expect(value.aliveHandles).toBe(0); expect(value.readbacksRetired).toBe(true); expect(value.uploadBackingsRetired).toBe(true); expect(value.changingReadbacksRetired).toBe(true);
			for (const kind of Object.keys(value.created)) expect(value.deleted[kind], kind).toBe(value.created[kind]);
			if (qualified.backend === 'webgl2' || value.normalFloatSupported) {
				expect(value.geometryPrograms).toBeGreaterThan(0); const reads = value.readbacks.filter(read => read.width === 8 && read.height === 16); expect(reads.length).toBeGreaterThan(0);
				for (const read of reads) { expect(read.passes.map(pass => [pass.kind, pass.width, pass.height])).toEqual([[9, 8, 16]]);
					if (qualified.backend === 'webgl2') { expect(read.passes[0].integer).toBe(1); expect(read.bits).toEqual(expected.bits); } }
				expect(value.sourceUploads.some(source => source.every((n, at) => n === expected.sourceBits[at]))).toBe(true);
				if (test.info().project.name === 'lightscaper-software-gpu') for (const context of value.contexts) expect(context.renderer).toContain('SwiftShader');
			} else expect(value.readbacks).toEqual([]);
		}
	} finally { await observe('stop'); }

	function immutable(value) { expect(value.bytes).toEqual([...original]); expect(value.original.sha256).toBe(source.sha256); expect(value.native.words).toEqual(fixture.words[0]); expect(value.native.rawFlip).toBe(6);
		if (value !== initial) { expect(value.original).toEqual(initial.original); expect(value.namespace).toBe(initial.namespace); expect(value.photo.original).toEqual(initial.photo.original); } }
	function custody() { return helper('readGpuGeometryPhotoCustodyCurrentV1', photoId); }
	function observe(action) { return helper(`${action}GpuGeometryUiObservationCurrentV1`); }
	function observation() { return helper('readGpuGeometryUiObservationCurrentV1'); }
	function helper(method, value) { return page.evaluate(async ({ path, method, value }) => (await import(path))[method](value), { path: PROGRAM, method, value }); }
	async function photoMenu(label) { const summary = app.getByRole('navigation').getByText(label, { exact: true }); if (!await summary.locator('..').evaluate(node => node.open)) await keyboard(summary); }
	async function photoAction(label, nested = false) { await photoMenu(copy.photoFileMenu); if (nested) await photoMenu(copy.photoPhotoMenu); await keyboard(named(app, 'button', label)); }
	async function library() { const target = app.locator('[data-photo-library]'); if (!await target.isVisible()) { await photoMenu(copy.photoViewMenu); await keyboard(named(app, 'button', copy.photoShowLibrary)); } await expect(target).toHaveAttribute('aria-busy', 'false'); }
});
function active(photo) { const value = photo.versions.find(version => version.id === photo.activeVersionId); expect(value).toBeTruthy(); return value; }
function plane(canvas) { return canvas.evaluate(node => [node.width, node.height, ...node.getContext('2d').getImageData(0, 0, node.width, node.height).data]); }
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(control) { await expect(control).toBeEnabled(); await control.focus(); await control.press('Enter'); }
function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
