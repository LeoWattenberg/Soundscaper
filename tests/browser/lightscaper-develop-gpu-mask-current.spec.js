/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoDevelopSettingsCopy } from '../../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopPreviewRendererCopy } from '../../src/common/i18n/lightscaper-develop-preview-renderer-copy.ts';
import { photoDevelopBrushMaskCopy } from '../../src/common/i18n/lightscaper-develop-brush-mask-copy.ts';
import { photoDevelopMaskManagementCopy } from '../../src/common/i18n/lightscaper-develop-mask-management-copy.ts';
import { photoDevelopLocalAdjustmentsCopy } from '../../src/common/i18n/lightscaper-develop-local-adjustments-copy.ts';
import { hdrMergeBrowserFixtureCurrentV1 } from './helpers/lightscaper-hdr-merge-current-fixture.ts';
import { editLightscaperDevelopNumberCurrentV1 } from './helpers/lightscaper-develop-numeric-keyboard-current.ts';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { expect, test } from './helpers/browser-coverage-fixture.js';

// Product workflows retain ordinary browser coverage. Native component specs
// separately own timing-sensitive capability/fault/cancellation qualification.
test.skip(({ browserName }) => test.info().project.name !== 'lightscaper-software-gpu' && browserName !== 'firefox',
	'Masked GPU preview requires pinned software Chromium or the actual Firefox GPU project.');
const PROGRAM = '/__lightscaper_develop_gpu_mask_current.js';
let fixture, program, manifest;
test.beforeAll(async () => {
	fixture = await hdrMergeBrowserFixtureCurrentV1();
	manifest = JSON.parse(await readFile(new URL('../../config/lightscaper-libraw-runtime-manifest.json', import.meta.url), 'utf8'));
	expect(fixture.wasm.byteLength).toBe(manifest.runtime.byteLength); expect(createHash('sha256').update(fixture.wasm).digest('hex')).toBe(manifest.runtime.sha256);
	program = await compileNativeImageHandoffScript('develop-gpu-mask-current.js', fileURLToPath(new URL('./helpers/lightscaper-develop-gpu-mask-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});

for (const locale of ['en', 'de']) test(`${locale}: installed brush and selected GPU overlay survive changing crop extent, Full/Fit, Save and reopen`, async ({ page }) => {
	test.setTimeout(300_000); expect(test.info().config.workers).toBe(1); expect(test.info().retry).toBe(0); expect(test.info().project.retries).toBe(0);
	const copy = bundledLightscaperEditorCopyForLocale(locale), words = photoDevelopCopy(locale), settings = photoDevelopSettingsCopy(locale, 'current3');
	const renderer = photoDevelopPreviewRendererCopy(locale), brush = photoDevelopBrushMaskCopy(locale), manager = photoDevelopMaskManagementCopy(locale);
	const maskWords = photoDevelopLocalAdjustmentsCopy(locale), source = fixture.sources[0], original = Buffer.from(source.bytes), errors = [], workers = [];
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
	const initial = await custody(); immutable(initial); expect(initial.bodies).toEqual([]);
	const plain = await reference(false), cropped = await reference(true), params = await helper('gpuMaskAuthoredEffectParamsCurrentV1');
	expect(cropped.coverage).toEqual([...Array(8 * 8).fill(255), ...Array(8 * 8).fill(0)]);
	await observe('start');
	try {
		await keyboard(card); await photoAction(photoDevelopMenuLabel(locale), true);
		const dialog = named(page, 'dialog', `${words.title}: ${source.name}`), preview = dialog.locator('[data-photo-develop-preview]');
		await ready(); await expect.poll(() => plane(named(dialog, 'img', words.before))).toEqual([32, 32, ...plain.before]);
		await add('tone-ladder-v1'); await numeric('videoEffectParamExposure', '-1');
		await settingsMenu(); await keyboard(named(dialog, 'button', brush.menu));
		const author = named(page, 'dialog', brush.title), grid = named(author, 'img', brush.grid);
		const brushReady = async () => { await expect(grid).toHaveAttribute('data-state', 'ready'); };
		await brushReady();
		for (const [key, value] of [['width', '4'], ['height', '4']]) await editLightscaperDevelopNumberCurrentV1(named(author, 'spinbutton', brush[key]), value, brushReady);
		await keyboard(named(author, 'button', brush.create)); await brushReady();
		for (const [key, value] of [['radius', '.25'], ['hardness', '1'], ['opacity', '1'], ['x', '.375'], ['y', '.375']]) {
			await editLightscaperDevelopNumberCurrentV1(named(author, 'spinbutton', brush[key]), value, brushReady);
		}
		await keyboard(named(author, 'button', brush.stamp)); await brushReady();
		await expect.poll(async () => (await plane(grid)).slice(2).filter((_, at) => at % 4 === 3)).toEqual(plain.body.slice(16));
		await toggle(named(author, 'checkbox', `${brush.bind}: ${words.shared.videoEffectToneLadder} (1)`));
		await toggle(named(author, 'checkbox', brush.showOverlay));
		const effectId = await named(author, 'combobox', brush.overlayEffect).locator('option').evaluateAll(options => options.find(option => option.value)?.value);
		expect(effectId).toBeTruthy(); await named(author, 'combobox', brush.overlayEffect).selectOption(effectId);
		await keyboard(named(author, 'button', brush.apply)); await expect(author).toHaveCount(0); await painted(plain, false); await overlay(plain);
		expect((await observation()).attempts).toBe(0); const first = await save(); bodyCustody(first); immutable(first);
		const firstRecipe = active(first.photo).develop, graph = firstRecipe.masks[0];
		expect(firstRecipe.maskBindings).toEqual([{ effectId, maskId: graph.id }]); expect(firstRecipe.effects).toHaveLength(1);
		expect(firstRecipe.effects[0]).toMatchObject({ type: 'tone-ladder-v1', enabled: true, params: { exposure: -1, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 } });
		expect(firstRecipe.effects[0].params).toEqual(params.tone);
		expect(graph.nodes).toEqual([{ id: graph.outputNodeId, kind: 'alpha', inputName: 'paint' }]);
		await observe('stop'); await accepted(first, plain); await observe('start');
		await rendererMenu(); const choice = named(page, 'dialog', renderer.title);
		await expect(named(choice, 'combobox', renderer.renderer)).toHaveValue('cpu'); await named(choice, 'combobox', renderer.renderer).selectOption('gpu-preferred');
		await keyboard(named(choice, 'button', renderer.apply)); await expect(choice).toHaveCount(0); await painted(plain, true); await overlay(plain); nativeMask(await observation(), plain, false);
		expect(await custody()).toEqual(first);

		// Author the suffix while CPU is explicitly selected, so the saved recipe
		// comparison and independent broker acceptance do not inherit GPU policy.
		await rendererMenu(); await named(choice, 'combobox', renderer.renderer).selectOption('cpu'); await keyboard(named(choice, 'button', renderer.apply)); await expect(choice).toHaveCount(0); await painted(plain, false);
		await add('develop-geometry-v1');
		for (const [key, value] of [['CropWidth', '.5'], ['CropHeight', '.25'], ['CropX', '.25'], ['CropY', '0'], ['GeometryRotation', '90']]) await numeric(`videoEffectParam${key}`, value);
		await named(dialog, 'combobox', `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectParamFlipHorizontal}`).selectOption('1');
			await painted(cropped, false); await expect(dialog.locator('[data-photo-develop-mask-overlay]')).toHaveCount(0);
			await selectOverlay(); await overlay(cropped); const saved = await save(); bodyCustody(saved); immutable(saved);
		const recipe = active(saved.photo).develop; expect(recipe.effects.map(effect => effect.type)).toEqual(['tone-ladder-v1', 'develop-geometry-v1']);
		expect(recipe.effects[0]).toEqual(firstRecipe.effects[0]); expect(recipe.masks).toEqual(firstRecipe.masks); expect(recipe.maskBindings).toEqual(firstRecipe.maskBindings);
		expect(recipe.effects[1]).toMatchObject({ enabled: true, params: { cropX: .25, cropY: 0, cropWidth: .5, cropHeight: .25, rotationDegrees: 90, flipHorizontal: 1 } });
		expect(recipe.effects[1].params).toEqual(params.geometry);
		expect(recipe).not.toHaveProperty('maskOverlay'); expect(recipe).not.toHaveProperty('previewRenderer'); expect(recipe).not.toHaveProperty('execution');
		expect(saved.bodies).toEqual(first.bodies); expect(saved.resourceRecords).toEqual(first.resourceRecords);
		await observe('stop'); await accepted(saved, cropped); await observe('start');
		await rendererMenu(); await named(choice, 'combobox', renderer.renderer).selectOption('gpu-preferred'); await keyboard(named(choice, 'button', renderer.apply)); await expect(choice).toHaveCount(0);
		await painted(cropped, true); await overlay(cropped); nativeMask(await observation(), cropped, true);
		for (const value of ['full', 'proxy']) { await observe('reset'); await settingsMenu(); await keyboard(named(dialog, 'button', value === 'full' ? words.fullResolution : words.fitResolution));
			await expect(dialog.locator('[data-resolution]')).toHaveAttribute('data-resolution', value); await painted(cropped, true); await overlay(cropped); nativeMask(await observation(), cropped, true); expect(await custody()).toEqual(saved); }
		await close(); await observe('stop'); await page.reload(); await expect(app).toBeVisible(); await library(); expect(await custody()).toEqual(saved);
		await observe('start'); await keyboard(card); await photoAction(photoDevelopMenuLabel(locale), true); await painted(cropped, false);
		await expect(dialog.locator('[data-photo-develop-mask-overlay]')).toHaveCount(0); await rendererMenu();
		await expect(named(choice, 'combobox', renderer.renderer)).toHaveValue('cpu'); await keyboard(named(choice, 'button', renderer.close).last()); await expect(choice).toHaveCount(0); await ready();
		await settingsMenu(); await keyboard(named(dialog, 'button', brush.menu));
		await named(author, 'combobox', brush.mask).selectOption(graph.id); await brushReady();
		await expect(named(author, 'spinbutton', brush.width)).toHaveValue('4'); await expect(named(author, 'spinbutton', brush.width)).toBeDisabled();
		await expect.poll(async () => (await plane(grid)).slice(2).filter((_, at) => at % 4 === 3)).toEqual(plain.body.slice(16));
		const retainedGrid = await grid.elementHandle(); expect(retainedGrid).toBeTruthy();
		try { await keyboard(named(author, 'button', brush.close).last()); await expect(author).toHaveCount(0);
			await expect.poll(() => retainedGrid.evaluate(node => [node.width, node.height])).toEqual([0, 0]);
		} finally { await retainedGrid.dispose(); }
		await painted(cropped, false); expect(await custody()).toEqual(saved);
			await selectOverlay();
		await painted(cropped, false); await overlay(cropped); expect((await observation()).attempts).toBe(0); expect(await custody()).toEqual(saved);
		await close(); expect(errors).toEqual([]); expect(workers.length).toBeGreaterThan(0);
		for (const url of workers) { expect(new URL(url).origin).toBe(new URL(page.url()).origin); expect(new URL(url).pathname).toMatch(/\/assets\/libraw-worker-v1-[^/]+\.js$/u); }

		async function ready() { await expect(preview).toHaveAttribute('data-state', 'ready'); }
			async function selectOverlay() {
				await settingsMenu(); await keyboard(named(dialog, 'button', manager.menu)); const manage = named(page, 'dialog', manager.title);
				await named(manage, 'combobox', manager.mask).selectOption(graph.id); await toggle(named(manage, 'checkbox', manager.showOverlay));
				await named(manage, 'combobox', manager.overlayEffect).selectOption(effectId); await keyboard(named(manage, 'button', manager.apply)); await expect(manage).toHaveCount(0);
			}
		async function add(type) { await ready(); await named(dialog, 'combobox', words.choose).selectOption(type); await keyboard(named(dialog, 'button', words.add)); await ready(); }
		async function numeric(key, value) { const control = named(dialog, 'spinbutton', `${words.shared.videoEffectExactValue}: ${words.shared[key]}`);
			await editLightscaperDevelopNumberCurrentV1(control, value, ready); await expect(control).toHaveValue(String(Number(value))); }
		async function painted(expected, approximate) { await ready(); await expect(dialog.getByRole('alert')).toHaveCount(0);
			await expect.poll(() => plane(named(dialog, 'img', words.before))).toEqual([32, 32, ...plain.before]);
			if (!approximate) await expect.poll(() => plane(named(dialog, 'img', words.after))).toEqual([expected.width, expected.height, ...expected.after]);
			else await expect.poll(async () => { const read = await plane(named(dialog, 'img', words.after)); return read[0] === expected.width && read[1] === expected.height && read.length === expected.after.length + 2
				&& expected.after.every((n, at) => at % 4 === 3 ? read[at + 2] === n : Math.abs(read[at + 2] - n) <= 1); }).toBe(true); }
		async function overlay(expected) { const canvas = named(dialog, 'img', maskWords.maskOverlay); await expect(canvas).toHaveAttribute('data-state', 'ready');
			await expect.poll(async () => { const read = await plane(canvas); return [read[0], read[1], ...read.slice(2).filter((_, at) => at % 4 === 3)]; }).toEqual([expected.width, expected.height, ...expected.coverage]);
			expect(await canvas.boundingBox()).toEqual(await named(dialog, 'img', words.after).boundingBox()); }
		async function save() { await ready(); await keyboard(named(dialog, 'button', words.save)); await expect(dialog.locator('[data-photo-develop-ack]')).toBeVisible(); await expect(named(dialog, 'button', words.save)).toBeDisabled(); await ready(); return custody(); }
		async function settingsMenu() { await ready(); const summary = dialog.locator('summary').filter({ hasText: new RegExp(`^${escape(settings.menu)}$`, 'u') }); if (!await summary.evaluate(node => node.parentElement.open)) await keyboard(summary); }
		async function rendererMenu() { await settingsMenu(); await keyboard(named(dialog, 'button', renderer.menu)); }
		async function close() { await ready(); const canvases = await preview.locator('canvas').elementHandles();
			try { await keyboard(named(dialog.locator('.lightscaper-develop-actions'), 'button', words.close)); await expect(dialog).toHaveCount(0);
				for (const canvas of canvases) await expect.poll(() => canvas.evaluate(node => [node.width, node.height])).toEqual([0, 0]);
			} finally { await Promise.all(canvases.map(canvas => canvas.dispose())); } }
	} finally { await observe('stop'); }
	function immutable(value) { expect(value.bytes).toEqual([...original]); expect(value.original.sha256).toBe(source.sha256); expect(value.native.words).toEqual(fixture.words[0]); expect(value.native.rawFlip).toBe(6);
		if (value !== initial) { expect(value.original).toEqual(initial.original); expect(value.namespace).toBe(initial.namespace); expect(value.photo.original).toEqual(initial.photo.original); } }
	function bodyCustody(value) { expect(value.bodies).toHaveLength(1); expect(value.bodies[0].bytes).toEqual(plain.body);
		const hash = createHash('sha256').update(Buffer.from(plain.body)).digest('hex'); expect(value.bodies[0].reference).toEqual({ storageKey: `brush-mask-v1:4:4:${hash}`, sha256: hash, width: 4, height: 4, byteLength: 32 }); }
	async function accepted(saved, expected) { const result = await helper('qualifyGpuMaskWordsCurrentV1', { words: initial.native.words, develop: active(saved.photo).develop, bodies: saved.bodies });
		expect(result.backend).toBe('webgl2'); expect(result.callbacks).toBe(1); expect(result.reads).toBeGreaterThan(0); expect(result.activeAtDelivery).toBe(0);
		expect([result.descriptor.width, result.descriptor.height]).toEqual([expected.width, expected.height]); nativeValues(result.bits, expected.bits, expected.coverage);
		expect(result.coverage).toEqual(expected.coverage); expect(result.overlay).toEqual({ ...active(saved.photo).develop.maskBindings[0], width: expected.width, height: expected.height });
		expect(result.sourceBits).toEqual(expected.sourceBits); expect(result.sourceRetired).toBe(true); expect(result.outputRetired).toBe(true); expect(result.overlayRetired).toBe(true); }
	function nativeMask(value, expected, suffix) { expect(value.aliveHandles).toBe(0); expect(value.nativeMaskBuffersRetired).toBe(true); expect(value.spatialReadbacksRetired).toBe(true);
		expect(value.integerDeletes).toBeGreaterThan(0); expect(value.deletesBeforeClear).toBe(0); expect(value.deletesBeforeFinish).toBe(0);
		expect(value.maskDraws.some(draw => draw.program === 'node' && draw.kind === 7 && draw.width === 32 && draw.height === 32)).toBe(true);
		expect(value.maskDraws.some(draw => draw.program === 'blend' && draw.width === 32 && draw.height === 32)).toBe(true);
		const reads = value.maskedFloatReads.filter(read => read.width === expected.width && read.height === expected.height && read.draws.some(draw => draw.program === 'blend'));
		expect(reads.length).toBeGreaterThan(0); for (const read of reads) nativeValues(read.bits, expected.bits, expected.coverage);
		integerPlanes(value.integerReads, expected);
		if (suffix) expect(value.maskDraws.some(draw => draw.program === 'overlay' && draw.kind === 1 && draw.width === 8 && draw.height === 16)).toBe(true);
		expect(value.sourceUploads.some(read => read.every((n, at) => n === expected.sourceBits[at]))).toBe(true);
		const browserName = page.context().browser()?.browserType().name();
		if (browserName === 'chromium') for (const context of value.contexts) expect(context.renderer).toContain('SwiftShader'); }
	function reference(suffix) { return helper('gpuMaskWordsReferenceCurrentV1', { words: initial.native.words, suffix }); }
	function custody() { return helper('readGpuMaskPhotoCustodyCurrentV1', photoId); }
	function observe(action) { return helper(`${action}GpuMaskUiObservationCurrentV1`); }
	function observation() { return helper('readGpuMaskUiObservationCurrentV1'); }
	function helper(method, value) { return page.evaluate(async ({ path, method, value }) => (await import(path))[method](value), { path: PROGRAM, method, value }); }
	async function photoMenu(label) { const summary = app.getByRole('navigation').getByText(label, { exact: true }); if (!await summary.locator('..').evaluate(node => node.open)) await keyboard(summary); }
	async function photoAction(label, nested = false) { await photoMenu(copy.photoFileMenu); if (nested) await photoMenu(copy.photoPhotoMenu); await keyboard(named(app, 'button', label)); }
	async function library() { const target = app.locator('[data-photo-library]'); if (!await target.isVisible()) { await photoMenu(copy.photoViewMenu); await keyboard(named(app, 'button', copy.photoShowLibrary)); } await expect(target).toHaveAttribute('aria-busy', 'false'); }
});

// Verify complete native planes from actual ordered row/chunk reads. Target
// identity and content version prevent mixing separate attempts or reused banks.
function integerPlanes(reads, expected) {
	const stripes = reads.filter(read => read.internalFormat === 'r8ui' && read.targetWidth === expected.width && read.targetHeight === expected.height);
	expect(stripes.length).toBeGreaterThan(0); let cursor = 0, completed = 0, identity;
	for (const read of stripes) {
		const key = [read.context, read.target, read.version];
		for (const part of key) { expect(Number.isSafeInteger(part)).toBe(true); expect(part).toBeGreaterThan(0); }
		if (cursor === 0) identity = key;
		expect(key, 'A native plane must retain one actual context/target/content identity.').toEqual(identity);
		expect(read.format).toBe('rgba-integer'); expect(read.type).toBe('unsigned-int');
		const x = cursor % expected.width, y = Math.floor(cursor / expected.width), count = Math.min(4096, expected.width - x);
		expect([read.x, read.y, read.width, read.height], 'Native stripes must cover every row/chunk once in order.').toEqual([x, y, count, 1]);
		expect(read.coverage, `Exact native coverage stripe at ${x},${y}`).toEqual(expected.coverage.slice(cursor, cursor + count));
		cursor += count;
		if (cursor === expected.width * expected.height) { completed++; cursor = 0; }
	}
	expect(cursor, 'A partial native coverage plane cannot satisfy qualification.').toBe(0);
	expect(completed).toBeGreaterThan(0);
}

function nativeValues(actual, expected, coverage) { expect(actual).toHaveLength(expected.length); const values = new Float32Array(Uint32Array.from(expected).buffer);
	for (let at = 0; at < expected.length; at++) { if (coverage[Math.floor(at / 4)] === 0 || at % 4 === 3 || values[at] === 0 || Math.abs(values[at]) < 2 ** -60) expect(actual[at], `exact native sample${at}`).toBe(expected[at]);
		else expect(Math.abs(ordered(actual[at]) - ordered(expected[at])), `8ULP native sample${at}`).toBeLessThanOrEqual(8); } }
function ordered(value) { return value & 0x80000000 ? 0x80000000 - (value & 0x7fffffff) : 0x80000000 + value; }
function active(photo) { const version = photo.versions.find(version => version.id === photo.activeVersionId); expect(version).toBeTruthy(); return version; }
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
function plane(canvas) { return canvas.evaluate(node => [node.width, node.height, ...node.getContext('2d').getImageData(0, 0, node.width, node.height).data]); }
async function keyboard(control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await control.press('Enter'); }
async function toggle(control) { await expect(control).not.toBeChecked(); await control.focus(); await expect(control).toBeFocused(); await control.press('Space'); await expect(control).toBeChecked(); }
function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
