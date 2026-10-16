/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoDevelopSettingsCopy } from '../../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopPreviewRendererCopy } from '../../src/common/i18n/lightscaper-develop-preview-renderer-copy.ts';
import { videoEffectDefinitionV2 } from '../../src/common/editor/video-effects-v2.ts';
import { hdrMergeBrowserFixtureCurrentV1 } from './helpers/lightscaper-hdr-merge-current-fixture.ts';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { expect, test } from './helpers/browser-coverage-fixture.js';

test.skip(({ browserName }) => test.info().project.name !== 'lightscaper-software-gpu' && browserName !== 'firefox',
	'Color Preview UI requires pinned software Chromium or actual Firefox capability/fallback.');
const PROGRAM = '/__lightscaper_develop_gpu_colors_current.js', KINDS = [1, 2, 3, 5, 6, 6, 7, 4];
let fixture, program, manifest;
test.beforeAll(async () => {
	fixture = await hdrMergeBrowserFixtureCurrentV1();
	manifest = JSON.parse(await readFile(new URL('../../config/lightscaper-libraw-runtime-manifest.json', import.meta.url), 'utf8'));
	expect(fixture.wasm.byteLength).toBe(manifest.runtime.byteLength); expect(createHash('sha256').update(fixture.wasm).digest('hex')).toBe(manifest.runtime.sha256);
	program = await compileNativeImageHandoffScript('develop-gpu-colors-current.js', fileURLToPath(new URL('./helpers/lightscaper-develop-gpu-colors-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});

for (const locale of ['en', 'de']) test(`${locale}: real RAW all-color Develop executes GPU stages, saves and reloads without changing Original authority`, async ({ page, browserName }) => {
	test.setTimeout(300_000); expect(['chromium', 'firefox']).toContain(browserName);
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
	const initial = await custody(); expect(initial.native.words).toEqual(fixture.words[0]); expect(initial.native.rawFlip).toBe(6); unchanged(initial);
	const before = await reference([]), effects = authoredEffects(), expected = await reference(effects);
	expect(expected.bits).not.toEqual(before.bits);
	const qualification = await helper('qualifyGpuColorWordsCurrentV1', { words: initial.native.words, effects });
	expect(qualification.callbacks).toBe(1); expect(qualification.sourceUnchanged).toBe(true); expect(qualification.outputRetired).toBe(true);
	if (qualification.backend === 'cpu') {
		expect(typeof qualification.reason).toBe('string'); expect(qualification.reason.length).toBeGreaterThan(0);
		expect(qualification.bits).toEqual(expected.bits); expect(qualification.display).toEqual(expected.display);
		if (browserName === 'chromium') expect(qualification.reason).toBe('numeric-range');
	} else { expect(qualification.backend).toBe('webgl2'); assertNativeUlps(qualification.bits, expected.bits); }
	await observe('start');
	try {
		await keyboard(card); await photoAction(photoDevelopMenuLabel(locale), true);
		const dialog = named(page, 'dialog', `${words.title}: ${source.name}`), preview = dialog.locator('[data-photo-develop-preview]');
		await painted(before.display, true);
		// Author every family through the opted-in Develop controls while CPU is
		// selected. The later renderer switch must execute the complete stack.
		for (const effect of effects) {
			await named(dialog, 'combobox', words.choose).selectOption(effect.type); await keyboard(named(dialog, 'button', words.add));
			const row = dialog.locator(`[data-photo-develop-effect="${effect.type}"]`);
			if (effect.type === 'point-curves-v1') {
				await number(row, `${words.shared.videoEffectCurveMaster}: ${words.shared.videoEffectCurveOutput} 2`, '0.875');
			} else if (effect.type === 'color-wheels-v1') {
				await number(row, `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectWheelHighlights}: ${words.shared.videoEffectParamLuminance}`, '100');
			} else for (const [key, value] of Object.entries(effect.params)) {
				const descriptor = videoEffectDefinitionV2(effect.type).params[key];
				await number(row, `${words.shared.videoEffectExactValue}: ${words.shared[descriptor.labelKey] ?? descriptor.label}`, String(value));
			}
		}
		await painted(expected.display, true); expect((await observation()).attempts).toBe(0); expect(await custody()).toEqual(initial);
		await observe('reset'); await rendererMenu(); const choice = named(page, 'dialog', renderer.title);
		await expect(named(choice, 'combobox', renderer.renderer)).toHaveValue('cpu'); await named(choice, 'combobox', renderer.renderer).selectOption('gpu-preferred');
		await keyboard(named(choice, 'button', renderer.apply)); await expect(choice).toHaveCount(0); await painted(expected.display); nativeAfter(await observation());
		expect(await custody()).toEqual(initial);
		await keyboard(named(dialog, 'button', words.save)); await expect(dialog.locator('[data-photo-develop-ack]')).toBeVisible();
		await expect(named(dialog, 'button', words.save)).toBeDisabled(); await painted(expected.display);
		const saved = await custody(); unchanged(saved); expect(saved.photo.revision).toBe(initial.photo.revision + 1);
		const recipe = active(saved.photo).develop;
		expect(recipe.effects.map(effect => effect.type)).toEqual(effects.map(effect => effect.type));
		for (let n = 0; n < effects.length; n++) expect(recipe.effects[n]).toMatchObject({ type: effects[n].type, enabled: true, params: effects[n].params });
		expect({ ...recipe, effects: active(initial.photo).develop.effects }).toEqual(active(initial.photo).develop);
		expect(active(saved.photo).workspace.cursor).toBe(1); expect(active(saved.photo).workspace.entries).toHaveLength(2);
		await observe('reset'); await resolution('full'); await painted(expected.display); nativeAfter(await observation());
		await expect(named(dialog, 'region', words.imageViewport)).toBeVisible();
		await observe('reset'); await resolution('proxy'); await painted(expected.display); nativeAfter(await observation());
		await expect(named(dialog, 'region', words.imageViewport)).toHaveCount(0); expect(await custody()).toEqual(saved);
		await close(); await observe('stop'); await page.reload(); await expect(app).toBeVisible(); await library(); expect(await custody()).toEqual(saved);
		await observe('start'); await keyboard(card); await photoAction(photoDevelopMenuLabel(locale), true); await painted(expected.display, true);
		await rendererMenu(); const reopened = named(page, 'dialog', renderer.title); await expect(named(reopened, 'combobox', renderer.renderer)).toHaveValue('cpu');
		await keyboard(named(reopened, 'button', renderer.close).last()); await expect(reopened).toHaveCount(0); await painted(expected.display, true);
		expect((await observation()).attempts).toBe(0); expect(await custody()).toEqual(saved); await close();
		expect(errors).toEqual([]); expect(workers.length).toBeGreaterThan(0);
		for (const url of workers) { expect(new URL(url).origin).toBe(new URL(page.url()).origin); expect(new URL(url).pathname).toMatch(/\/assets\/libraw-worker-v1-[^/]+\.js$/u); }

		async function number(scope, label, value) { const input = named(scope, 'spinbutton', label); await input.fill(value); await input.press('Enter'); await expect(input).toHaveValue(value); }
		async function painted(after, exact = qualification.backend === 'cpu') {
			await expect(preview).toHaveAttribute('data-state', 'ready');
			await expect.poll(() => plane(named(dialog, 'img', words.before))).toEqual([32, 32, ...before.display]);
			await expect.poll(async () => closeBytes(await plane(named(dialog, 'img', words.after)), [32, 32, ...after], exact ? 0 : 1)).toBe(true);
			await expect(dialog.getByRole('alert')).toHaveCount(0);
		}
		async function settingsMenu() { const summary = dialog.locator('summary').filter({ hasText: new RegExp(`^${escape(settings.menu)}$`, 'u') });
			if (!await summary.evaluate(node => node.parentElement.open)) await keyboard(summary); }
		async function rendererMenu() { await settingsMenu(); await keyboard(named(dialog, 'button', renderer.menu)); }
		async function resolution(value) { await settingsMenu(); await keyboard(named(dialog, 'button', value === 'full' ? words.fullResolution : words.fitResolution));
			await expect(dialog.locator('[data-resolution]')).toHaveAttribute('data-resolution', value); }
		async function close() { await keyboard(named(dialog.locator('.lightscaper-develop-actions'), 'button', words.close)); await expect(dialog).toHaveCount(0); }
	} finally { await observe('stop'); }

	function nativeAfter(value) {
		expect(value.aliveHandles).toBe(0); expect(value.readbacksRetired).toBe(true);
		for (const kind of Object.keys(value.created)) expect(value.deleted[kind], kind).toBe(value.created[kind]);
		const reads = value.readbacks.filter(read => read.passes.map(pass => pass.kind).join(',') === KINDS.join(','));
		if (browserName === 'chromium' || value.normalFloatSupported) {
			expect(reads.length).toBeGreaterThan(0); expect(value.floatUploads).toBeGreaterThan(0); expect(value.floatTargets).toBeGreaterThan(0);
			// A raw GPU attempt may be rejected before delivery. The real broker
			// qualification above proves exact whole-CPU output for this corpus;
			// that case also requires exact CPU pixels in the actual UI. Apply
			// the delivery budget only when the corpus actually qualifies for GL.
			if (qualification.backend === 'webgl2') for (const read of reads) assertNativeUlps(read.bits, expected.bits);
			if (test.info().project.name === 'lightscaper-software-gpu') for (const context of value.contexts) expect(context.renderer).toContain('SwiftShader');
		} else expect(reads).toEqual([]);
	}
	function unchanged(value) {
		expect(value.bytes).toEqual([...original]); expect(value.original.sha256).toBe(source.sha256); expect(value.native.words).toEqual(fixture.words[0]);
		expect(value.photo.original.contentSha256).toBe(source.sha256); expect(value.photo.original.mimeType).toBe('image/x-adobe-dng');
		if (value !== initial) { expect(value.original).toEqual(initial.original); expect(value.namespace).toBe(initial.namespace); expect(value.photo.original).toEqual(initial.photo.original); }
	}
	function custody() { return helper('readGpuPreviewPhotoCustodyCurrentV1', photoId); }
	function reference(effects) { return helper('nativeColorWordsReferenceCurrentV1', { words: fixture.words[0], effects }); }
	function observe(action) { return helper(`${action}GpuPreviewObservationCurrentV1`); }
	function observation() { return helper('readGpuPreviewObservationCurrentV1'); }
	function helper(method, value) { return page.evaluate(async ({ path, method, value }) => (await import(path))[method](value), { path: PROGRAM, method, value }); }
	async function photoMenu(label) { const summary = app.getByRole('navigation').getByText(label, { exact: true }); if (!await summary.locator('..').evaluate(node => node.open)) await keyboard(summary); }
	async function photoAction(label, nested = false) { await photoMenu(copy.photoFileMenu); if (nested) await photoMenu(copy.photoPhotoMenu); await keyboard(named(app, 'button', label)); }
	async function library() { const target = app.locator('[data-photo-library]'); if (!await target.isVisible()) { await photoMenu(copy.photoViewMenu); await keyboard(named(app, 'button', copy.photoShowLibrary)); }
		await expect(target).toHaveAttribute('aria-busy', 'false'); }
});

function authoredEffects() { return [effect('white-balance-v1', { temperature: 100 }), effect('tone-ladder-v1', { exposure: -1 }),
	effect('chroma-v1', { saturation: 10, vibrance: 5 }), effect('hsl-mixer-v1', { redLuminance: 5, blueSaturation: -10 }),
	effect('point-curves-v1', { master: [{ x: 0, y: 0 }, { x: 1, y: .875 }] }), effect('parametric-curves-v1', { masterShadows: 10 }),
	effect('color-wheels-v1', { highlightsLuminance: 100 }), effect('black-white-mix-v1', { blue: 10 })]; }
function effect(type, params) { return { id: `oracle-${type}`, type, enabled: true, params }; }
function assertNativeUlps(actual, expected) {
	expect(actual.length).toBe(expected.length);
	for (let at = 0; at < expected.length; at++) {
		const n = expected[at], value = new Float32Array(Uint32Array.of(n).buffer)[0];
		if (at % 4 === 3 || value === 0 || Math.abs(value) < 2 ** -100) expect(actual[at], `exact native sample${at}`).toBe(n);
		else expect(Math.abs(ordered(actual[at]) - ordered(n)), `native8ULP sample${at}`).toBeLessThanOrEqual(8);
	}
}
function ordered(bits) { return bits & 0x80000000 ? 0x80000000 - (bits & 0x7fffffff) : 0x80000000 + bits; }
function closeBytes(actual, expected, tolerance) { return actual.length === expected.length && actual.every((n, at) =>
	at < 2 || (at - 2) % 4 === 3 ? n === expected[at] : Math.abs(n - expected[at]) <= tolerance); }
function active(photo) { const value = photo.versions.find(version => version.id === photo.activeVersionId); expect(value).toBeTruthy(); return value; }
function plane(canvas) { return canvas.evaluate(node => [node.width, node.height, ...node.getContext('2d').getImageData(0, 0, node.width, node.height).data]); }
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(control) { await expect(control).toBeEnabled(); await control.focus(); await control.press('Enter'); }
function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
