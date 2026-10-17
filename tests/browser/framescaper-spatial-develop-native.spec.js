/* SPDX-License-Identifier: AGPL-3.0-only */

import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { EDITOR_ENGLISH_COPY, EDITOR_GERMAN_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { NOISE_PNG_BASE64, NOISE_SOURCE, NOISE_PARAMS, NOISE_PIXELS } from './helpers/lightscaper-noise-reference.ts';
import { GRAIN_PNG_BASE64, GRAIN_SOURCE, GRAIN_PARAMS, GRAIN_PIXELS } from './helpers/lightscaper-grain-reference.ts';
import { TEXTURE_PNG_BASE64, TEXTURE_SOURCE, TEXTURE_PARAMS, TEXTURE_PIXELS } from './helpers/lightscaper-texture-reference.ts';
import { DEHAZE_PNG_BASE64, DEHAZE_SOURCE, DEHAZE_PARAMS, DEHAZE_PIXELS } from './helpers/lightscaper-dehaze-reference.ts';

// Every case serves a test-only shader/export witness; it is excluded from portable coverage.
test.use({ browserCoverage: false });

const MODULE = '/__framescaper_authored_spatial_native.js';
const ENTRY = new URL('../helpers/framescaper-global-export-fixture.ts', import.meta.url);
const ROUTES = { en: { file: 'File', edit: 'Edit', copy: EDITOR_ENGLISH_COPY },
	de: { file: 'Datei', edit: 'Bearbeiten', copy: EDITOR_GERMAN_COPY } };
const WEBKIT_AV_IMPORT_DEFERRED = 'Playwright WebKit rejects the IndexedDB Blob write that persists an imported A/V source.';

// Literal pre-encode goldens include the declared encoded-sRGB -> linear
// UNORM8 -> encoded-sRGB composition rounding. No production transfer/kernel
// calculates these expected bytes, and no lossy codec equality is asserted.
const CASES = [
	{ type: 'noise-reduction-v1', label: 'videoEffectNoiseReduction', native: 'qualifyNoiseNativeV1', linked: 'noiseProgramLinked', code: 30,
		png: NOISE_PNG_BASE64, source: NOISE_SOURCE, params: NOISE_PARAMS, pixels: NOISE_PIXELS,
		controls: [['luminance', 'videoEffectNoiseLuminance'], ['luminanceDetail', 'videoEffectNoiseLuminanceDetail'],
			['luminanceContrast', 'videoEffectNoiseLuminanceContrast'], ['color', 'videoEffectNoiseColor'],
			['colorDetail', 'videoEffectNoiseColorDetail'], ['colorSmoothness', 'videoEffectNoiseColorSmoothness']],
		preEncode: [13,46,71,255,79,129,169,255,126,131,119,255,226,207,50,255] },
	{ type: 'grain-v1', label: 'videoEffectGrain', native: 'qualifyGrainNativeV1', linked: 'grainProgramLinked', code: 31,
		png: GRAIN_PNG_BASE64, source: GRAIN_SOURCE, params: GRAIN_PARAMS, pixels: GRAIN_PIXELS,
		controls: [['amount', 'videoEffectGrainAmount'], ['size', 'videoEffectGrainSize'],
			['roughness', 'videoEffectGrainRoughness'], ['seed', 'videoEffectGrainSeed']],
		preEncode: [0,28,64,255,64,128,192,255,124,124,124,255,252,221,13,255] },
	{ type: 'texture-v1', label: 'videoEffectTexture', native: 'qualifyTextureNativeV1', linked: 'textureProgramLinked', code: 32,
		png: TEXTURE_PNG_BASE64, source: TEXTURE_SOURCE, params: TEXTURE_PARAMS, pixels: TEXTURE_PIXELS,
		controls: [['amount', 'videoEffectTextureAmount']],
		preEncode: [0,28,64,255,64,128,192,255,129,129,129,255,255,225,13,255] },
	{ type: 'dehaze-v1', label: 'videoEffectDehaze', native: 'qualifyDehazeNativeV1', linked: 'dehazeProgramLinked', code: 33,
		png: DEHAZE_PNG_BASE64, source: DEHAZE_SOURCE, params: DEHAZE_PARAMS, pixels: DEHAZE_PIXELS,
		controls: [['amount', 'videoEffectDehazeAmount']],
		preEncode: [46,81,117,255,117,151,186,255,151,151,151,255,221,186,81,255] },
];

for (const [locale, route] of Object.entries(ROUTES)) for (const fixture of CASES) {
	test(`${locale}: Frame menus persist ${fixture.type} for native shader and selected pre-encode literal-source parity`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', WEBKIT_AV_IMPORT_DEFERRED);
		const { copy } = route, errors = collectClientErrors(page);
		await installNativeWitness(page);
		let editor = await bootEditor(page, `/framescaper/embed/${locale}/`);
		await expect(editor.getByRole('checkbox', { name: copy[fixture.label], exact: true })).toHaveCount(0);
		await importFiles(editor, [createDeterministicAvFixture('spatial-authored-source.webm')]);
		await chooseCommandAction(page, editor, route.file, copy.saveProject);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const projectId = await editor.getAttribute('data-project-id'); expect(projectId).toBeTruthy();
		const original = await readProject(page, projectId), video = original.clips.find(clip => clip.kind === 'video');
		expect(video).toBeTruthy();
		const clip = editor.locator(`[data-track-lane] [data-clip-id="${video.id}"][data-clip-kind="video"][role="group"]`);
		await expect(clip).toHaveCount(1);
		await key(clip);
		await expect(clip.locator('.clip-display')).toHaveClass(/\bclip-display--selected\b/u);
		await chooseNestedCommandAction(page, editor, route.edit, [copy.clipBoundaries, copy.clipPropertiesCommand]);
		const rack = editor.locator('[data-workspace-panel="clip-properties"] [data-video-effect-rack]');
		await expect(rack).toBeVisible();
		await chooseEffectByKeyboard(page, rack.getByRole('group', { name: copy.chooseEffect, exact: true }), copy[fixture.label]);
		await key(rack.getByRole('button', { name: copy.addEffect, exact: true }));
		await expect(rack.getByRole('checkbox', { name: copy[fixture.label], exact: true })).toBeChecked();
		for (const [parameter, label] of fixture.controls) {
			const control = rack.getByRole('spinbutton', { name: `${copy.videoEffectExactValue}: ${copy[label]}`, exact: true });
			await control.fill(String(fixture.params[parameter])); await control.press('Enter');
			await expect(control).toHaveValue(String(fixture.params[parameter]));
		}
		await chooseCommandAction(page, editor, route.file, copy.saveProject);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const saved = await readProject(page, projectId), effects = saved.clips.find(clip => clip.id === video.id).videoEffects;
		expect(effects).toEqual([{ id: expect.any(String), type: fixture.type, enabled: true, params: fixture.params }]);
		expect(saved.sources).toEqual(original.sources);
		await assertNativeRecipe(page, fixture, effects);
		await page.reload(); editor = page.locator('[data-audio-editor]');
		await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
		await expect(editor).toHaveAttribute('data-project-id', projectId);
		const reopened = await readProject(page, projectId);
		expect(reopened).toEqual(saved);
		await assertNativeRecipe(page, fixture, reopened.clips.find(clip => clip.id === video.id).videoEffects);
		expect(errors).toEqual([]);
	});
}

async function key(control) {
	await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await control.press('Enter');
}

async function chooseEffectByKeyboard(page, group, label) {
	const button = group.getByRole('button'); await key(button);
	const listbox = page.getByRole('listbox'); await expect(listbox).toBeVisible(); await expect(listbox).toBeFocused();
	const options = listbox.getByRole('option'), names = await options.allTextContents(), targetIndex = names.indexOf(label);
	expect(targetIndex).toBeGreaterThanOrEqual(0);
	const target = options.nth(targetIndex), targetId = await target.getAttribute('id'); expect(targetId).toBeTruthy();
	// The maintained portal bridges arrows and Enter; Home is not implemented.
	// Repeated ArrowUp clamps at the first role=option entry.
	for (let step = 0; step < names.length; step++) await listbox.press('ArrowUp');
	for (let step = 0; step < targetIndex; step++) await listbox.press('ArrowDown');
	await expect(listbox).toHaveAttribute('aria-activedescendant', targetId);
	await listbox.press('Enter'); await expect(listbox).toBeHidden(); await expect(button).toContainText(label);
}

async function assertNativeRecipe(page, fixture, effects) {
	// The persisted controls are rendered on the independent literal source;
	// this is not a claim about exporting the imported A/V clip's original.
	const result = await page.evaluate(async ({ path, native, effects, source, png }) => {
		const witness = await import(new URL(path, location.href).href);
		return { shader: await witness[native]({ source, height: 2, params: effects[0].params, mode: 'target' }),
			selected: await witness.qualifyAuthoredSpatialExportNativeV1({ effects, png }) };
	}, { path: MODULE, native: fixture.native, effects, source: fixture.source, png: [...Buffer.from(fixture.png, 'base64')] });
	expect(result.shader.pixels).toEqual(fixture.pixels); expect(result.shader.cpuPixels).toEqual(fixture.pixels);
	expect(result.shader[fixture.linked]).toBe(true); expect(result.shader.passCodes).toEqual([fixture.code]);
	expect(result.shader.nativeWebgl2).toBe(true); expect(result.shader.nativeReadbacks).toBe(1); expect(result.shader.glError).toBe(0);
	expect(result.shader.source).toEqual(fixture.source); expect(result.shader.before).toEqual(fixture.source);
	expect(result.selected.nativeCanvasCapture).toBe(true); expect(result.selected.captured).toEqual([fixture.source]);
	expect(result.selected.effects).toEqual(effects); expect(result.selected.pixels).toEqual(fixture.preEncode);
	expect(result.selected.consumedNodeIds.length).toBeGreaterThan(0);
}

async function installNativeWitness(page) {
	const entries = ['noise', 'grain', 'texture', 'dehaze'].map(name => {
		const path = fileURLToPath(new URL(`./helpers/lightscaper-${name}-reference.ts`, import.meta.url));
		return `export { qualify${name[0].toUpperCase()}${name.slice(1)}NativeV1 } from ${JSON.stringify(path)};`;
	});
	const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('.', ENTRY)), contents:
		`export { qualifyAuthoredSpatialExportNativeV1 } from ${JSON.stringify(fileURLToPath(ENTRY))};\n${entries.join('\n')}` },
		bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent' });
	await page.context().route(`**${MODULE}`, route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text,
		headers: { 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' } }));
}

/** Native read-only project observation; never seeds or edits the store. */
async function readProject(page, projectId) {
	return page.evaluate(({ databaseName, projectId }) => new Promise((resolve, reject) => {
		const open = indexedDB.open(databaseName);
		open.onerror = () => reject(open.error);
		open.onsuccess = () => {
			const database = open.result, request = database.transaction('projects').objectStore('projects').get(projectId);
			request.onerror = () => { database.close(); reject(request.error); };
			request.onsuccess = () => { database.close();
				if (!request.result) reject(new Error('The authored Frame project is not durably saved.'));
				else resolve(request.result);
			};
		};
	}), { databaseName: FRAMESCAPER_DATABASE_NAME, projectId });
}
