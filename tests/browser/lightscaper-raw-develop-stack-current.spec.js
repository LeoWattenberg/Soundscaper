/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { bundledSiteCopyForLocale } from '../../src/common/i18n/site-copy.js';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoDevelopSettingsCopy } from '../../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopRepairSpotsCopy } from '../../src/common/i18n/lightscaper-develop-repair-spots-copy.ts';
import { photoDevelopLocalAdjustmentsCopy } from '../../src/common/i18n/lightscaper-develop-local-adjustments-copy.ts';
import { rawDngFixtureV1 } from '../helpers/lightscaper-raw-dng-current-fixture.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';

test.use({ browserCoverage: false });
const PROGRAM = '/__lightscaper_raw_stack_custody.js', NAME = 'Native full stack.dng', locale = 'en';
const COVERAGE = [4, 12, 20, 28, 36, 44, 52, 60, 68, 76, 84, 92, 100, 108, 116, 124,
	131, 139, 147, 155, 163, 171, 179, 187, 195, 203, 211, 219, 227, 235, 243, 251];
let program, wasm, manifest;
test.beforeAll(async () => {
	manifest = JSON.parse(await readFile(new URL('../../config/lightscaper-libraw-runtime-manifest.json', import.meta.url), 'utf8'));
	wasm = await readFile(new URL(`../../${manifest.runtime.path}`, import.meta.url));
	expect(wasm.length).toBe(manifest.runtime.byteLength); expect(createHash('sha256').update(wasm).digest('hex')).toBe(manifest.runtime.sha256);
	program = await compileNativeImageHandoffScript('raw-stack-custody.js', fileURLToPath(new URL('./helpers/lightscaper-raw-import-current-reference.ts', import.meta.url)));
	expect(program.assets).toEqual([]);
});

test('actual RAW menus author native Clone, local tone, detail and rotated crop, then Save and reopen exact pixels', async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'This bounded native RAW stack qualifies Chromium and Firefox.'); test.setTimeout(180_000);
	const copy = bundledLightscaperEditorCopyForLocale(locale), words = photoDevelopCopy(locale), settings = photoDevelopSettingsCopy(locale, 'current3');
	const repair = photoDevelopRepairSpotsCopy(locale), gradient = photoDevelopLocalAdjustmentsCopy(locale), errors = [], workers = [];
	const originalBytes = Buffer.from(rawDngFixtureV1().bytes), digest = createHash('sha256').update(originalBytes).digest('hex');
	page.on('pageerror', error => { errors.push(error.message); });
	page.on('worker', worker => { if (new URL(worker.url()).pathname.includes('libraw-worker-v1')) workers.push(worker.url()); });
	await page.route(manifest.runtime.url, route => route.fulfill({ status: 200, headers: {
		'content-type': 'application/wasm', 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin',
	}, body: wasm }));
	await page.route(`**${PROGRAM}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	await page.goto(resolveBrowserProductTestUrl('/lightscaper/en/'));
	const app = named(page, 'region', 'Lightscaper'); await expect(app).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
	await menu(copy.photoFileMenu); await keyboard(named(app, 'button', copy.photoImportPhotos));
	const importer = named(page, 'dialog', copy.photoImportPhotos);
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: NAME, mimeType: 'image/png', buffer: originalBytes });
	await keyboard(named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
	const library = named(app, 'region', bundledSiteCopyForLocale(locale).workspacePhoto), card = app.getByRole('button', { name: /^Native full stack\.dng/u });
	await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false'); await keyboard(card);
	const photoId = await card.getAttribute('data-photo-id'); expect(photoId).toBeTruthy();
	const original = await observe(); immutable(original);
	expect(original.native.descriptor).toEqual({ schemaVersion: 1, width: 32, height: 32, sampleFormat: 'unorm16', primaries: 'srgb', transfer: 'linear' });
	const oracle = stackOracle(original.native.words), originalDisplay = display(original.native.words.map(value => value / 65535));
	await openDevelop(); const dialog = named(page, 'dialog', `${words.title}: ${NAME}`);
	const before = named(dialog, 'img', words.before), after = named(dialog, 'img', words.after), preview = dialog.locator('[data-photo-develop-preview]');
	await ready(); await expect.poll(() => plane(before)).toEqual([32, 32, ...originalDisplay]);
	await expect.poll(() => plane(after)).toEqual([32, 32, ...oracle.neutral]);

	await settingsMenu(); await keyboard(named(dialog, 'button', repair.menu)); const repairing = named(page, 'dialog', repair.title);
	const repairOriginal = named(repairing, 'img', repair.original); await expect(repairOriginal).toHaveAttribute('data-state', 'ready');
	await expect.poll(() => plane(repairOriginal)).toEqual([32, 32, ...originalDisplay]);
	await named(repairing, 'combobox', repair.mode).selectOption('clone');
	for (const [field, value] of Object.entries({ targetX: .765625, targetY: .640625, sourceX: .265625, sourceY: .640625, radius: .01, feather: 0, opacity: 1 })) {
		await named(repairing, 'spinbutton', repair[field]).fill(String(value));
	}
	await keyboard(named(repairing, 'button', repair.add)); await keyboard(named(repairing, 'button', repair.apply)); await expect(repairing).toHaveCount(0);
	await ready(); await expect.poll(() => plane(after)).toEqual([32, 32, ...oracle.cloned]);
	expect(oracle.cloned).not.toEqual(oracle.neutral); expect(await observe()).toEqual(original);

	await add('white-balance-v1'); await number('videoEffectParamTemperature', '100');
	await add('tone-ladder-v1'); await number('videoEffectParamExposure', '-1');
	await ready(); await expect.poll(() => plane(after)).toEqual([32, 32, ...oracle.global]);
	await settingsMenu(); await keyboard(named(dialog, 'button', gradient.menu)); const local = named(page, 'dialog', gradient.title);
	for (const [field, value] of [['startX', '0'], ['startY', '.5'], ['endX', '1'], ['endY', '.5']]) await named(local, 'spinbutton', gradient[field]).fill(value);
	const binding = named(local, 'checkbox', `${gradient.bind}: ${words.shared.videoEffectToneLadder} (2)`);
	await expect(binding).not.toBeChecked(); await binding.focus(); await page.keyboard.press('Space'); await expect(binding).toBeChecked();
	await expect(named(local, 'checkbox', gradient.showOverlay)).not.toBeChecked();
	await keyboard(named(local, 'button', gradient.apply)); await expect(local).toHaveCount(0);
	await ready(); await expect.poll(() => plane(after)).toEqual([32, 32, ...oracle.local]); expect(oracle.local).not.toEqual(oracle.global);

	await add('detail-sharpen-v1'); await number('videoEffectDetailSharpenAmount', '50'); await number('videoEffectDetailSharpenThreshold', '0');
	await ready(); await expect.poll(() => plane(after)).toEqual([32, 32, ...oracle.detail]); expect(oracle.detail).not.toEqual(oracle.local);
	await add('develop-geometry-v1');
	for (const [key, value] of [['CropWidth', '.5'], ['CropHeight', '.25'], ['CropX', '.5'], ['CropY', '.5'], ['GeometryRotation', '90']]) {
		await number(`videoEffectParam${key}`, value);
	}
	await ready(); await expect.poll(() => plane(after)).toEqual([8, 16, ...oracle.final]);
	await expect.poll(() => plane(before)).toEqual([32, 32, ...originalDisplay]); expect(await observe()).toEqual(original);
	await keyboard(named(dialog, 'button', words.save)); await expect(dialog.locator('[data-photo-develop-ack]')).toBeVisible();
	await expect(named(dialog, 'button', words.save)).toBeDisabled();
	const saved = await observe(); immutable(saved); expect(saved.photo.revision).toBe(original.photo.revision + 1);
	expect(saved.original).toEqual(original.original); expect(saved.photo.original).toEqual(original.photo.original); expect(saved.native).toEqual(original.native);
	expect(saved.photo.schemaVersion).toBe(3); const recipe = saved.photo.versions.find(version => version.id === saved.photo.activeVersionId).develop;
	expect(recipe.processVersion).toBe(3); expect(recipe.repairs.spots).toHaveLength(1);
	expect(recipe.repairs.spots[0]).toMatchObject({ mode: 'clone', enabled: true, target: { x: .765625, y: .640625 }, source: { x: .265625, y: .640625 }, radius: .01, feather: 0, opacity: 1 });
	expect(recipe.effects.map(effect => effect.type)).toEqual(['white-balance-v1', 'tone-ladder-v1', 'detail-sharpen-v1', 'develop-geometry-v1']);
	expect(recipe.effects.every(effect => effect.enabled)).toBe(true); expect(recipe.effects[0].params.temperature).toBe(100); expect(recipe.effects[1].params.exposure).toBe(-1);
	expect(recipe.effects[2].params).toEqual({ amount: 50, threshold: 0 });
	expect(recipe.effects[3].params).toMatchObject({ cropX: .5, cropY: .5, cropWidth: .5, cropHeight: .25, rotationDegrees: 90 });
	expect(recipe.maskBindings).toEqual([{ effectId: recipe.effects[1].id, maskId: recipe.masks[0].id }]);
	expect(recipe.masks).toHaveLength(1); expect(recipe.masks[0].inputs).toEqual([]); expect(recipe.masks[0].nodes).toHaveLength(1);
	expect(recipe.masks[0].nodes[0]).toMatchObject({ kind: 'linear-gradient', start: { x: 0, y: .5 }, end: { x: 1, y: .5 } });
	await close(); await page.reload(); await expect(app).toBeVisible(); await menu(copy.photoViewMenu); await keyboard(named(app, 'button', copy.photoShowLibrary));
	await expect(card).toHaveCount(1); await keyboard(card); await openDevelop(); await ready();
	await expect.poll(() => plane(before)).toEqual([32, 32, ...originalDisplay]); await expect.poll(() => plane(after)).toEqual([8, 16, ...oracle.final]);
	await expect(named(dialog, 'spinbutton', exact('videoEffectDetailSharpenAmount'))).toHaveValue('50');
	await expect(named(dialog, 'spinbutton', exact('videoEffectParamGeometryRotation'))).toHaveValue('90');
	expect(await observe()).toEqual(saved); await close();
	expect(workers.length).toBeGreaterThanOrEqual(3);
	for (const url of workers) { expect(new URL(url).origin).toBe(new URL(page.url()).origin); expect(new URL(url).pathname).toMatch(/\/assets\/libraw-worker-v1-[^/]+\.js$/u); }
	expect(errors).toEqual([]);

	function exact(key) { expect(words.shared[key]).toBeTruthy(); return `${words.shared.videoEffectExactValue}: ${words.shared[key]}`; }
	async function number(key, value) { const control = named(dialog, 'spinbutton', exact(key)); await control.fill(value); await control.press('Enter'); await expect(control).toHaveValue(String(Number(value))); }
	async function add(type) { await named(dialog, 'combobox', words.choose).selectOption(type); await keyboard(named(dialog, 'button', words.add)); }
	async function menu(label) { await keyboard(app.getByRole('navigation').getByText(label, { exact: true })); }
	async function settingsMenu() { const control = dialog.getByText(settings.menu, { exact: true }); if (!await control.locator('..').evaluate(details => details.open)) await keyboard(control); }
	async function openDevelop() { await menu(copy.photoFileMenu); await menu(copy.photoPhotoMenu); await keyboard(named(app, 'button', photoDevelopMenuLabel(locale))); }
	async function close() { await keyboard(named(dialog, 'button', words.close).last()); await expect(dialog).toHaveCount(0); }
	async function ready() { await expect(preview).toHaveAttribute('data-state', 'ready'); }
	async function keyboard(control) { await expect(control).toBeEnabled(); await control.focus(); await page.keyboard.press('Enter'); }
	function observe() { return page.evaluate(async ({ pathname, photoId }) => (await import(new URL(pathname, location.href).href)).readRawImportCustodyCurrentV1(photoId), { pathname: PROGRAM, photoId }); }
	function immutable(value) { expect(value.bytes).toEqual([...originalBytes]); expect(value.original.sha256).toBe(digest); expect(value.original.byteLength).toBe(originalBytes.length);
		expect(value.photo.original.contentSha256).toBe(digest); expect(value.photo.original.mimeType).toBe('image/x-adobe-dng'); }
});

/** Independent native-word oracle. Literal one-cell Clone, exact WB gains,
 * authored per-column coverage table, binomial-neighborhood mathematics and
 * integer clockwise pixel permutation; no production image kernel is imported. */
function stackOracle(words) {
	const neutral = Float32Array.from(words, value => value / 65535), cloned = neutral.slice();
	cloned.set(neutral.subarray((20 * 32 + 8) * 4, (20 * 32 + 8) * 4 + 3), (20 * 32 + 24) * 4);
	const balanced = cloned.map((value, index) => index % 4 === 3 ? value : value * [2, 1, .5][index % 4]);
	const global = balanced.map((value, index) => index % 4 === 3 ? value : value * .5);
	const local = balanced.map((value, index) => index % 4 === 3 ? value : value + COVERAGE[Math.floor(index / 4) % 32] / 255 * (global[index] - value));
	const detail = local.slice(), taps = [[-1, 1], [0, 2], [1, 1]];
	for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) for (let channel = 0; channel < 3; channel++) {
		let sum = 0;
		for (const [dy, wy] of taps) for (const [dx, wx] of taps) sum += wy * wx * encoded(local[(Math.max(0, Math.min(31, y + dy)) * 32 + Math.max(0, Math.min(31, x + dx))) * 4 + channel]);
		const index = (y * 32 + x) * 4 + channel, value = encoded(local[index]), delta = value - sum / 16;
		detail[index] = delta === 0 ? local[index] : linear(value + delta * .5);
	}
	const rotated = [];
	for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) rotated.push(...detail.subarray(((23 - x) * 32 + 16 + y) * 4, ((23 - x) * 32 + 16 + y) * 4 + 4));
	return { neutral: display(neutral), cloned: display(cloned), global: display(global), local: display(local), detail: display(detail), final: display(rotated) };
}
function encoded(value) { const magnitude = Math.abs(value); return Math.sign(value) * (magnitude <= .0031308 ? 12.92 * magnitude : 1.055 * magnitude ** (1 / 2.4) - .055); }
function linear(value) { const magnitude = Math.abs(value); return Math.sign(value) * (magnitude <= .04045 ? magnitude / 12.92 : ((magnitude + .055) / 1.055) ** 2.4); }
function display(pixels) { return Array.from(pixels, (value, index) => Math.round(255 * (index % 4 === 3 ? value : encoded(Math.max(0, Math.min(1, value)))))); }
function plane(canvas) { return canvas.evaluate(node => [node.width, node.height, ...(node.width && node.height ? node.getContext('2d').getImageData(0, 0, node.width, node.height).data : [])]); }
function named(root, role, name) { return root.getByRole(role, { name, exact: true }); }
