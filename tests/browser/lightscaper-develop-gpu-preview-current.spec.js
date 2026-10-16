/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoDevelopSettingsCopy } from '../../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopPreviewRendererCopy } from '../../src/common/i18n/lightscaper-develop-preview-renderer-copy.ts';
import { photoDevelopLocalAdjustmentsCopy } from '../../src/common/i18n/lightscaper-develop-local-adjustments-copy.ts';
import { withImageDevelopLinearCurrentV1 } from '../../src/common/editor/imaging/image-develop-linear-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../../src/common/editor/imaging/image-develop-state-v2.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { hdrMergeBrowserFixtureCurrentV1 } from './helpers/lightscaper-hdr-merge-current-fixture.ts';
import { editLightscaperDevelopNumberCurrentV1 } from './helpers/lightscaper-develop-numeric-keyboard-current.ts';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { expect, test } from './helpers/browser-coverage-fixture.js';

test.skip(({ browserName }) => test.info().project.name !== 'lightscaper-software-gpu' && browserName !== 'firefox',
	'GPU Preview UI conformance requires pinned software Chromium or actual Firefox capability/fallback.');
const PROGRAM = '/__lightscaper_develop_gpu_preview_current.js';
let fixture, program, manifest;
test.beforeAll(async () => {
	fixture = await hdrMergeBrowserFixtureCurrentV1();
	manifest = JSON.parse(await readFile(new URL('../../config/lightscaper-libraw-runtime-manifest.json', import.meta.url), 'utf8'));
	expect(fixture.wasm.byteLength).toBe(manifest.runtime.byteLength); expect(createHash('sha256').update(fixture.wasm).digest('hex')).toBe(manifest.runtime.sha256);
	program = await compileNativeImageHandoffScript('develop-gpu-preview-current.js', fileURLToPath(new URL('./helpers/lightscaper-develop-gpu-preview-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});

// Actual Current Photo UI integration for admitted native WB/tone. One
// active mask binding proves that
// this choice falls back for the whole authored stack rather than omitting it.
for (const locale of ['en', 'de']) test(`${locale}: opt-in GPU Develop preview executes real native globals and keeps renderer choice outside saved RAW recipes`, async ({ page, browserName }) => {
	expect(['chromium', 'firefox']).toContain(browserName); test.setTimeout(240_000);
	const copy = bundledLightscaperEditorCopyForLocale(locale), words = photoDevelopCopy(locale), settings = photoDevelopSettingsCopy(locale, 'current3'), renderer = photoDevelopPreviewRendererCopy(locale);
	const source = fixture.sources[0], original = Buffer.from(source.bytes), words16 = fixture.words[0], errors = [], workerUrls = [];
	const beforePixels = display(words16.map((n, at) => at % 4 === 3 ? 1 : n / 65535));
	const native = developWords(words16), expectedBits = floatBits(native), expectedPixels = display(native), texturePixels = display(await texture(native));
	expect(native.some((n, at) => at % 4 === 0 && n > .5)).toBe(true);
	page.on('pageerror', error => { errors.push(error.message); });
	page.on('worker', worker => { if (new URL(worker.url()).pathname.includes('libraw-worker-v1')) workerUrls.push(worker.url()); });
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
	const initial = await custody(); originalUnchanged(initial); expect(initial.native.rawFlip).toBe(6); expect(initial.native.words).toEqual(words16);
	await observe('start');
	try {
		await keyboard(card); await photoAction(photoDevelopMenuLabel(locale), true);
		const dialog = named(page, 'dialog', `${words.title}: ${source.name}`), preview = dialog.locator('[data-photo-develop-preview]');
		await painted(beforePixels); await openRenderer();
		let choice = named(page, 'dialog', renderer.title); await expect(named(choice, 'combobox', renderer.renderer)).toHaveValue('cpu');
		await keyboard(named(choice, 'button', renderer.apply)); await expect(choice).toHaveCount(0); await painted(beforePixels);
		await add('white-balance-v1'); await number('videoEffectParamTemperature', '100');
		await add('tone-ladder-v1'); await number('videoEffectParamExposure', '-1'); await painted(expectedPixels);
		const cpu = await observation(); expect(cpu.readbacks).toEqual([]); expect(cpu.attempts).toBe(0); expect(await custody()).toEqual(initial);
		await observe('reset'); await openRenderer(); choice = named(page, 'dialog', renderer.title);
		await expect(named(choice, 'combobox', renderer.renderer)).toHaveValue('cpu'); await named(choice, 'combobox', renderer.renderer).selectOption('gpu-preferred');
		await keyboard(named(choice, 'button', renderer.apply)); await expect(choice).toHaveCount(0); await painted(expectedPixels);
		assertNativeAfter(await observation()); expect(await custody()).toEqual(initial);
		await keyboard(named(dialog, 'button', words.save)); await expect(dialog.locator('[data-photo-develop-ack]')).toBeVisible(); await expect(named(dialog, 'button', words.save)).toBeDisabled();
		await painted(expectedPixels); const saved = await custody(); originalUnchanged(saved); expect(saved.photo.revision).toBe(initial.photo.revision + 1);
		const savedRecipe = active(saved.photo).develop;
		expect(savedRecipe.effects.map(effect => [effect.type, effect.enabled])).toEqual([['white-balance-v1', true], ['tone-ladder-v1', true]]);
		expect(savedRecipe.effects[0].params.temperature).toBe(100); expect(savedRecipe.effects[1].params.exposure).toBe(-1);
		expect({ ...savedRecipe, effects: active(initial.photo).develop.effects }).toEqual(active(initial.photo).develop);
		expect(active(saved.photo).workspace.cursor).toBe(1); expect(active(saved.photo).workspace.entries).toHaveLength(2);
		await resolution('full'); await painted(expectedPixels); await expect(named(dialog, 'region', words.imageViewport)).toBeVisible();
		assertNativeAfter(await observation()); await observe('reset');
		await resolution('proxy'); await painted(expectedPixels); await expect(named(dialog, 'region', words.imageViewport)).toHaveCount(0);
		assertNativeAfter(await observation()); expect(await custody()).toEqual(saved);
		// Mask bindings still require the CPU. A real bound spatial
		// correction appears in After through whole CPU
		// fallback; any native Before copy is not counted as After execution.
		await add('texture-v1'); await number('videoEffectTextureAmount', '25');
		const local = photoDevelopLocalAdjustmentsCopy(locale); await settingsMenu(); await keyboard(named(dialog, 'button', local.menu));
		const gradient = named(page, 'dialog', local.title); await expect(gradient).toBeVisible();
		for (const [label, value] of [[local.startX, '0'], [local.startY, '0'], [local.endX, '1'], [local.endY, '0']]) {
			const control = named(gradient, 'spinbutton', label); await control.focus(); await expect(control).toBeFocused();
			await control.press('ControlOrMeta+A'); for (const character of value) await control.press(character); await control.press('Tab'); await expect(control).toHaveValue(value);
		}
		const binding = named(gradient, 'checkbox', `${local.bind}: ${words.shared.videoEffectTexture} (3)`);
		await binding.focus(); await expect(binding).toBeFocused(); await binding.press('Space'); await expect(binding).toBeChecked();
		await keyboard(named(gradient, 'button', local.apply)); await expect(gradient).toHaveCount(0); await painted(texturePixels);
		await observe('reset'); await resolution('full'); await painted(texturePixels);
		const fallback = await observation(); expect(fallback.readbacks.filter(read => read.passes.some(pass => pass.kind === 1 || pass.kind === 2))).toEqual([]); retired(fallback);
		expect(await custody()).toEqual(saved); await keyboard(named(dialog, 'button', words.save)); await expect(named(dialog, 'button', words.save)).toBeDisabled(); await painted(texturePixels);
		const savedSpatial = await custody(); originalUnchanged(savedSpatial); expect(savedSpatial.photo.revision).toBe(initial.photo.revision + 2);
		expect(active(savedSpatial.photo).develop.effects.slice(0, 2)).toEqual(savedRecipe.effects);
		expect(active(savedSpatial.photo).develop.effects[2]).toMatchObject({ type: 'texture-v1', enabled: true, params: { amount: 25 } });
		const maskedRecipe = active(savedSpatial.photo).develop; expect(maskedRecipe.masks).toHaveLength(1);
		expect(maskedRecipe.masks[0].nodes).toEqual([{ id: maskedRecipe.masks[0].outputNodeId, kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }]);
		expect(maskedRecipe.maskBindings).toEqual([{ maskId: maskedRecipe.masks[0].id, effectId: maskedRecipe.effects[2].id }]);
		expect({ ...maskedRecipe, effects: savedRecipe.effects, masks: savedRecipe.masks, maskBindings: savedRecipe.maskBindings }).toEqual(savedRecipe);
		await openRenderer(); choice = named(page, 'dialog', renderer.title); await expect(named(choice, 'combobox', renderer.renderer)).toHaveValue('gpu-preferred');
		await keyboard(named(choice, 'button', renderer.close).last()); await expect(choice).toHaveCount(0); await painted(texturePixels); expect(await custody()).toEqual(savedSpatial);
		await close(); await observe('stop'); await page.reload(); await expect(app).toBeVisible(); await library(); expect(await custody()).toEqual(savedSpatial);
		await observe('start'); await keyboard(card); await photoAction(photoDevelopMenuLabel(locale), true); await painted(texturePixels);
		await openRenderer(); choice = named(page, 'dialog', renderer.title); await expect(named(choice, 'combobox', renderer.renderer)).toHaveValue('cpu');
		await keyboard(named(choice, 'button', renderer.close).last()); await expect(choice).toHaveCount(0); await painted(texturePixels);
		const reopened = await observation(); expect(reopened.attempts).toBe(0); expect(reopened.readbacks).toEqual([]); expect(await custody()).toEqual(savedSpatial);
		await close(); expect(errors).toEqual([]); expect(workerUrls.length).toBeGreaterThan(0);
		for (const url of workerUrls) { expect(new URL(url).origin).toBe(new URL(page.url()).origin); expect(new URL(url).pathname).toMatch(/\/assets\/libraw-worker-v1-[^/]+\.js$/u); }

		async function add(type) { await named(dialog, 'combobox', words.choose).selectOption(type); await keyboard(named(dialog, 'button', words.add));
			await expect(preview).toHaveAttribute('data-state', 'ready'); }
		async function number(key, value) { const input = named(dialog, 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared[key]}`);
			await editLightscaperDevelopNumberCurrentV1(input, value, () => expect(preview).toHaveAttribute('data-state', 'ready')); await expect(input).toHaveValue(value); }
		async function painted(expected) {
			await expect(preview).toHaveAttribute('data-state', 'ready'); await expect.poll(() => plane(named(dialog, 'img', words.before))).toEqual([32, 32, ...beforePixels]);
			await expect.poll(() => plane(named(dialog, 'img', words.after))).toEqual([32, 32, ...expected]); await expect(dialog.getByRole('alert')).toHaveCount(0);
		}
		async function settingsMenu() { const summary = dialog.locator('summary').filter({ hasText: new RegExp(`^${escape(settings.menu)}$`, 'u') });
			if (!await summary.evaluate(node => node.parentElement.open)) await keyboard(summary); }
		async function openRenderer() { await settingsMenu(); await keyboard(named(dialog, 'button', renderer.menu)); }
		async function resolution(value) { await settingsMenu(); await keyboard(named(dialog, 'button', value === 'full' ? words.fullResolution : words.fitResolution));
			await expect(dialog.locator('[data-resolution]')).toHaveAttribute('data-resolution', value); }
		async function close() { await keyboard(named(dialog.locator('.lightscaper-develop-actions'), 'button', words.close)); await expect(dialog).toHaveCount(0); }
	} finally { await observe('stop'); }

	function assertNativeAfter(value) {
		retired(value); expect(value.attempts).toBeGreaterThan(0);
		const developed = value.readbacks.filter(read => read.passes.some(pass => pass.kind === 1) && read.passes.some(pass => pass.kind === 2));
		if (browserName === 'chromium' || value.normalFloatSupported) {
			expect(developed.length).toBeGreaterThan(0); expect(value.floatUploads).toBeGreaterThan(0); expect(value.floatTargets).toBeGreaterThan(0);
			for (const read of developed) {
				expect(read.passes.map(pass => pass.kind)).toEqual([1, 2]); expect(read.passes[0].params0.slice(0, 3)).toEqual([2, 1, .5]); expect(read.passes[1].params0[0]).toBe(.5);
				expect(read.bits).toEqual(expectedBits);
			}
			if (test.info().project.name === 'lightscaper-software-gpu') for (const context of value.contexts) expect(context.renderer).toContain('SwiftShader');
		} else expect(developed).toEqual([]);
	}
	function originalUnchanged(value) { expect(value.bytes).toEqual([...original]); expect(value.original.sha256).toBe(source.sha256); expect(value.original.byteLength).toBe(original.length);
		expect(value.photo.original.contentSha256).toBe(source.sha256); expect(value.photo.original.mimeType).toBe('image/x-adobe-dng'); expect(value.native.words).toEqual(words16);
		expect(value.native.descriptor).toEqual({ schemaVersion: 1, width: 32, height: 32, sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' });
		if (value !== initial) { expect(value.original).toEqual(initial.original); expect(value.namespace).toBe(initial.namespace); expect(value.photo.original).toEqual(initial.photo.original); }
	}
	async function photoMenu(label) { const summary = app.getByRole('navigation').getByText(label, { exact: true }); if (!await summary.locator('..').evaluate(node => node.open)) await keyboard(summary); }
	async function photoAction(label, nested = false) { await photoMenu(copy.photoFileMenu); if (nested) await photoMenu(copy.photoPhotoMenu); await keyboard(named(app, 'button', label)); }
	async function library() { const target = app.locator('[data-photo-library]'); if (!await target.isVisible()) { await photoMenu(copy.photoViewMenu); await keyboard(named(app, 'button', copy.photoShowLibrary)); }
		await expect(target).toHaveAttribute('aria-busy', 'false'); }
	function custody() { return helper('readGpuPreviewPhotoCustodyCurrentV1', photoId); }
	function observe(action) { return helper(`${action}GpuPreviewObservationCurrentV1`); }
	function observation() { return helper('readGpuPreviewObservationCurrentV1'); }
	function helper(method, value) { return page.evaluate(async ({ path, method, value }) => (await import(path))[method](value), { path: PROGRAM, method, value }); }
});

function retired(value) { expect(value.aliveHandles).toBe(0); expect(value.readbacksRetired).toBe(true); expect(value.contexts.every(context => context.native)).toBe(true);
	for (const kind of Object.keys(value.created)) expect(value.deleted[kind], kind).toBe(value.created[kind]); }
function developWords(words) { return words.map((sample, at) => {
	if (at % 4 === 3) return 1;
	const captured = Math.fround(sample / 65535), balanced = Math.fround(captured * [2, 1, .5][at % 4]); return Math.fround(balanced * .5);
}); }
async function texture(values) {
	// Start with the independently computed, per-stage-rounded WB/tone
	// values above. Only the existing CPU masked Texture stage supplies this spatial
	// reference; no application renderer or browser observer is substituted.
	const pixels = Float32Array.from(values), frame = { descriptor: { schemaVersion: 1, width: 32, height: 32,
		sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' }, pixels };
	try { return await withImageDevelopLinearCurrentV1({ frame, develop: { ...defaultImageDevelopStateV2(), effects: [
		{ id: 'texture-reference', type: 'texture-v1', enabled: true, params: { amount: 25 } },
	], masks: [{ schemaVersion: 1, id: 'local', kind: 'mask', inputs: [], nodes: [{ id: 'gradient', kind: 'linear-gradient',
		start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }], outputNodeId: 'gradient' }], maskBindings: [{ maskId: 'local', effectId: 'texture-reference' }],
	} }, output => [...output.pixels], PHOTO_DEVELOP_LINEAR_LIMITS_V1); }
	finally { pixels.fill(0); }
}
function display(values) { return values.map((value, at) => { if (at % 4 === 3) return 255;
	const n = Math.max(0, Math.min(1, value)); return Math.round(255 * (n <= .0031308 ? n * 12.92 : 1.055 * n ** (1 / 2.4) - .055)); }); }
function floatBits(values) { return [...new Uint32Array(Float32Array.from(values).buffer)]; }
function active(photo) { const version = photo.versions.find(value => value.id === photo.activeVersionId); expect(version).toBeTruthy(); return version; }
function plane(canvas) { return canvas.evaluate(node => [node.width, node.height, ...(node.width && node.height ? node.getContext('2d').getImageData(0, 0, node.width, node.height).data : [])]); }
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(control) { await expect(control).toBeEnabled(); await control.focus(); await control.press('Enter'); }
function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
