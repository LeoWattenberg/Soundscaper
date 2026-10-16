/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoDevelopSettingsCopy } from '../../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopRepairSpotsCopy } from '../../src/common/i18n/lightscaper-develop-repair-spots-copy.ts';
import { photoDevelopPreviewRendererCopy } from '../../src/common/i18n/lightscaper-develop-preview-renderer-copy.ts';
import { hdrMergeBrowserFixtureCurrentV1 } from './helpers/lightscaper-hdr-merge-current-fixture.ts';
import { editLightscaperDevelopNumberCurrentV1 } from './helpers/lightscaper-develop-numeric-keyboard-current.ts';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { expect, test } from './helpers/browser-coverage-fixture.js';

test.skip(({ browserName }) => test.info().project.name !== 'lightscaper-software-gpu' && browserName !== 'firefox',
	'Native repair UI requires pinned software Chromium or the actual Firefox GPU project.');
const PROGRAM = '/__lightscaper_develop_gpu_repair_current.js';
let fixture, program, manifest;
test.beforeAll(async () => {
	fixture = await hdrMergeBrowserFixtureCurrentV1();
	manifest = JSON.parse(await readFile(new URL('../../config/lightscaper-libraw-runtime-manifest.json', import.meta.url), 'utf8'));
	expect(fixture.wasm.byteLength).toBe(manifest.runtime.byteLength); expect(createHash('sha256').update(fixture.wasm).digest('hex')).toBe(manifest.runtime.sha256);
	program = await compileNativeImageHandoffScript('develop-gpu-repair-current.js', fileURLToPath(new URL('./helpers/lightscaper-develop-gpu-repair-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});

for (const locale of ['en', 'de']) test(`${locale}: actual RAW Clone then Heal run through GPU opt-in, Full Fit, Save and CPU-default reopen with unchanged Original`, async ({ page, browserName }) => {
	test.setTimeout(300_000); expect(test.info().config.workers).toBe(1); expect(test.info().retry).toBe(0); expect(test.info().project.retries).toBe(0);
	const copy = bundledLightscaperEditorCopyForLocale(locale), words = photoDevelopCopy(locale), settings = photoDevelopSettingsCopy(locale, 'current3');
	const repairs = photoDevelopRepairSpotsCopy(locale), renderer = photoDevelopPreviewRendererCopy(locale), source = fixture.sources[0], original = Buffer.from(source.bytes), errors = [], workers = [];
	page.on('pageerror', error => { errors.push(error.message); }); page.on('worker', worker => { if (worker.url().includes('libraw-worker-v1')) workers.push(worker.url()); });
	await page.route(manifest.runtime.url, route => route.fulfill({ status: 200, headers: {
		'content-type': 'application/wasm', 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin',
	}, body: Buffer.from(fixture.wasm) }));
	await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	await page.goto(resolveBrowserProductTestUrl(`/lightscaper/${locale}/`));
	const app = named(page, 'region', 'Lightscaper'); await expect(app).toBeVisible(); await photoAction(copy.photoImportPhotos);
	const importer = named(page, 'dialog', copy.photoImportPhotos);
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: source.name, mimeType: 'image/x-adobe-dng', buffer: original });
	await keyboard(named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0); await library();
	const card = app.locator('[data-photo-id]'); await expect(card).toHaveCount(1); const photoId = await card.getAttribute('data-photo-id'); expect(photoId).toBeTruthy();
	const initial = await custody(); immutable(initial); const expected = await helper('gpuRepairWordsReferenceCurrentV1', initial.native.words), spots = await helper('gpuRepairUiSpotsCurrentV1');
	expect(expected.after).not.toEqual(expected.cloned); expect(expected.after).not.toEqual(expected.before);
	await observe('start');
	try {
		await keyboard(card); await photoAction(photoDevelopMenuLabel(locale), true);
		const dialog = named(page, 'dialog', `${words.title}: ${source.name}`), preview = dialog.locator('[data-photo-develop-preview]');
		await painted(expected.before); await expect(named(page, 'dialog', repairs.title)).toHaveCount(0);
		await repairMenu(); let author = named(page, 'dialog', repairs.title); await repairReady(author);
		await expect(named(author, 'checkbox', repairs.visualize)).not.toBeChecked(); await authorSpot(author, spots[0]);
		await keyboard(named(author, 'button', repairs.apply)); await expect(author).toHaveCount(0); await painted(expected.cloned); expect(await custody()).toEqual(initial);
		await repairMenu(); author = named(page, 'dialog', repairs.title); await repairReady(author);
		await named(author, 'combobox', repairs.spot).selectOption(''); await authorSpot(author, spots[1]);
		await keyboard(named(author, 'button', repairs.apply)); await expect(author).toHaveCount(0); await painted(expected.after);
		expect((await observation()).attempts).toBe(0); expect(await custody()).toEqual(initial);
		await rendererMenu(); let choice = named(page, 'dialog', renderer.title); await expect(named(choice, 'combobox', renderer.renderer)).toHaveValue('cpu');
		await named(choice, 'combobox', renderer.renderer).selectOption('gpu-preferred'); await keyboard(named(choice, 'button', renderer.apply)); await expect(choice).toHaveCount(0);
		await painted(expected.after, true); nativeAfter(await observation()); expect(await custody()).toEqual(initial);
		await keyboard(named(dialog, 'button', words.save)); await expect(dialog.locator('[data-photo-develop-ack]')).toBeVisible(); await expect(named(dialog, 'button', words.save)).toBeDisabled();
		await painted(expected.after, true); const saved = await custody(); immutable(saved); expect(saved.photo.revision).toBe(initial.photo.revision + 1);
		const recipe = active(saved.photo).develop, originalRecipe = active(initial.photo).develop;
		expect(recipe.repairs.schemaVersion).toBe(1); expect(recipe.repairs.spots).toHaveLength(2);
		const expectedSpots = recipe.repairs.spots.map((actual, index) => ({ ...spots[index], id: actual.id }));
		expect(recipe).toEqual({ ...originalRecipe, processVersion: Math.max(3, originalRecipe.processVersion), repairs: { schemaVersion: 1, spots: expectedSpots } });
		expect(new Set(recipe.repairs.spots.map(spot => spot.id)).size).toBe(2);
		expect(active(saved.photo).workspace.cursor).toBe(1); expect(active(saved.photo).workspace.entries).toHaveLength(2);
		await observe('stop');
		// UI exposes no backend receipt. This separate genuine broker call uses
		// the actual saved recipe and custody words after UI tracking retires.
		const qualified = await helper('qualifyGpuRepairSavedWordsCurrentV1', { words: initial.native.words, develop: recipe });
		expect(qualified.backend).toBe('webgl2'); expect(qualified.calls).toBe(1); expect(qualified.actualReadback).toBe(true); expect(qualified.handlesAtDelivery).toBeGreaterThan(0);
		expect(qualified.sourceUnchanged).toBe(true); expect(qualified.outputRetired).toBe(true); expect(qualified.inputRetired).toBe(true);
		expect(qualified.sourceBits).toEqual(expected.sourceBits); expect(qualified.expected).toEqual(expected.bits); nativeValues(qualified.bits); nativeAfter(qualified.observation);
		await observe('start'); await resolution('full'); await painted(expected.after, true); nativeAfter(await observation()); await expect(named(dialog, 'region', words.imageViewport)).toBeVisible();
		await observe('reset'); await resolution('proxy'); await painted(expected.after, true); nativeAfter(await observation()); await expect(named(dialog, 'region', words.imageViewport)).toHaveCount(0);
		await expect(named(dialog, 'button', words.save)).toBeDisabled(); expect(await custody()).toEqual(saved); await close(); await observe('stop');
		await page.reload(); await expect(app).toBeVisible(); await library(); expect(await custody()).toEqual(saved);
		await observe('start'); await keyboard(card); await photoAction(photoDevelopMenuLabel(locale), true); await painted(expected.after);
		await rendererMenu(); choice = named(page, 'dialog', renderer.title); await expect(named(choice, 'combobox', renderer.renderer)).toHaveValue('cpu');
		await keyboard(named(choice, 'button', renderer.close).last()); await expect(choice).toHaveCount(0); await painted(expected.after);
		await repairMenu(); author = named(page, 'dialog', repairs.title); await repairReady(author);
		const options = await named(author, 'combobox', repairs.spot).locator('option').allTextContents(); expect(options).toEqual([repairs.newSpot, `1: ${repairs.clone}`, `2: ${repairs.heal}`]);
		await keyboard(named(author, 'button', repairs.close).last()); await expect(author).toHaveCount(0); await painted(expected.after);
		expect((await observation()).attempts).toBe(0); expect(await custody()).toEqual(saved); await close(); expect(errors).toEqual([]); expect(workers.length).toBeGreaterThan(0);
		for (const url of workers) { expect(new URL(url).origin).toBe(new URL(page.url()).origin); expect(new URL(url).pathname).toMatch(/\/assets\/libraw-worker-v1-[^/]+\.js$/u); }

		async function authorSpot(target, value) { await named(target, 'combobox', repairs.mode).selectOption(value.mode);
			for (const [key, number] of [['targetX', value.target.x], ['targetY', value.target.y], ['sourceX', value.source.x], ['sourceY', value.source.y], ['radius', value.radius], ['feather', value.feather], ['opacity', value.opacity]]) {
				const control = named(target, 'spinbutton', repairs[key]); await editLightscaperDevelopNumberCurrentV1(control, number); await expect(control).toHaveValue(String(number));
			}
			await keyboard(named(target, 'button', repairs.add)); await expect(named(target, 'combobox', repairs.spot)).not.toHaveValue(''); await expect(target.getByRole('alert')).toHaveCount(0); }
		async function repairReady(target) { await expect(target).toBeVisible(); await expect(target.locator('[data-photo-repair-original]')).toHaveAttribute('data-state', 'ready'); }
		async function repairMenu() { await expect(preview).toHaveAttribute('data-state', 'ready'); await settingsMenu(); await keyboard(named(dialog, 'button', repairs.menu)); }
		async function settingsMenu() { const summary = dialog.locator('summary').filter({ hasText: new RegExp(`^${escape(settings.menu)}$`, 'u') }); if (!await summary.evaluate(node => node.parentElement.open)) await keyboard(summary); }
		async function rendererMenu() { await settingsMenu(); await keyboard(named(dialog, 'button', renderer.menu)); }
		async function resolution(value) { await settingsMenu(); await keyboard(named(dialog, 'button', value === 'full' ? words.fullResolution : words.fitResolution)); await expect(dialog.locator('[data-resolution]')).toHaveAttribute('data-resolution', value); }
		async function close() { await keyboard(named(dialog.locator('.lightscaper-develop-actions'), 'button', words.close)); await expect(dialog).toHaveCount(0); }
		async function painted(values, approximate = false) { await expect(preview).toHaveAttribute('data-state', 'ready');
			await expect.poll(() => plane(named(dialog, 'img', words.before))).toEqual([32, 32, ...expected.before]);
			if (!approximate) await expect.poll(() => plane(named(dialog, 'img', words.after))).toEqual([32, 32, ...values]);
			else await expect.poll(async () => { const output = await plane(named(dialog, 'img', words.after)); return output.length === 4098 && output[0] === 32 && output[1] === 32
				&& values.every((n, at) => at % 4 === 3 ? output[at + 2] === n : Math.abs(output[at + 2] - n) <= 1); }).toBe(true);
			await expect(dialog.getByRole('alert')).toHaveCount(0); }
		function nativeValues(actual) { expect(actual).toHaveLength(expected.bits.length); const values = new Float32Array(Uint32Array.from(expected.bits).buffer), mismatches = [];
			for (let at = 0; at < actual.length; at++) { const x = Math.floor(at / 4) % 32, y = Math.floor(at / 128), copied = x < 23 || x > 25 || y < 23 || y > 25;
				const exact = copied || at % 4 === 3 || values[at] === 0 || Math.abs(values[at]) < 2 ** -60;
				const mismatch = exact ? actual[at] !== expected.bits[at] : Math.abs(ordered(actual[at]) - ordered(expected.bits[at])) > 8;
				if (mismatch && mismatches.length < 16) mismatches.push({ at, expected: expected.bits[at], actual: actual[at], exact }); }
			expect(mismatches, 'Exact copied/alpha/zero/tiny words and8ULP reconstructed native RGB').toEqual([]); }
		function nativeAfter(value) { expect(value.attempts).toBeGreaterThan(0); expect(value.aliveHandles).toBe(0); expect(value.readbacksRetired).toBe(true); expect(value.visibleStatusScratchRetired).toBe(true); expect(value.uploadsRetired).toBe(true);
			for (const kind of Object.keys(value.created)) expect(value.deleted[kind], kind).toBe(value.created[kind]);
			expect(value.readbacks.length).toBeGreaterThan(0); for (const read of value.readbacks) { expect([read.width, read.height]).toEqual([32, 32]); expect(read.clone).toBe(1); expect(read.healBlend).toBe(1); expect(read.jacobi).toBe(64); nativeValues(read.bits); }
			for (const context of value.contexts) { expect(context.native).toBe(true); expect(context.sourceUploads).toBe(1); expect(context.sources).toEqual([expected.sourceBits]);
				if (browserName === 'chromium') expect(context.renderer).toContain('SwiftShader'); }
		}
	} finally { await observe('stop'); }
	function immutable(value) { expect(value.bytes).toEqual([...original]); expect(value.original.sha256).toBe(source.sha256); expect(value.native.words).toEqual(fixture.words[0]); expect(value.native.rawFlip).toBe(6);
		if (value !== initial) { expect(value.original).toEqual(initial.original); expect(value.namespace).toBe(initial.namespace); expect(value.photo.original).toEqual(initial.photo.original); } }
	function custody() { return helper('readGpuRepairPhotoCustodyCurrentV1', photoId); }
	function observe(action) { return helper(`${action}GpuRepairUiObservationCurrentV1`); }
	function observation() { return helper('readGpuRepairUiObservationCurrentV1'); }
	function helper(method, value) { return page.evaluate(async ({ path, method, value }) => (await import(path))[method](value), { path: PROGRAM, method, value }); }
	async function photoMenu(label) { const summary = app.getByRole('navigation').getByText(label, { exact: true }); if (!await summary.locator('..').evaluate(node => node.open)) await keyboard(summary); }
	async function photoAction(label, nested = false) { await photoMenu(copy.photoFileMenu); if (nested) await photoMenu(copy.photoPhotoMenu); await keyboard(named(app, 'button', label)); }
	async function library() { const target = app.locator('[data-photo-library]'); if (!await target.isVisible()) { await photoMenu(copy.photoViewMenu); await keyboard(named(app, 'button', copy.photoShowLibrary)); } await expect(target).toHaveAttribute('aria-busy', 'false'); }
});
function active(photo) { const version = photo.versions.find(value => value.id === photo.activeVersionId); expect(version).toBeTruthy(); return version; }
function ordered(word) { return word & 0x80000000 ? 0x80000000 - (word & 0x7fffffff) : 0x80000000 + word; }
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
function plane(canvas) { return canvas.evaluate(node => [node.width, node.height, ...node.getContext('2d').getImageData(0, 0, node.width, node.height).data]); }
async function keyboard(control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await control.press('Enter'); }
function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
