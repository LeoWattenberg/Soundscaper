/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseNestedCommandAction, collectClientErrors, importFiles, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';

test.use({ browserCoverage: false });
const ENTRY = new URL('../helpers/image-geometry-native-fixture.ts', import.meta.url);
const MODULE = '/__image_geometry_native.js';
const WEBKIT_AV_IMPORT_DEFERRED = 'Playwright WebKit rejects the IndexedDB Blob write that persists an imported A/V source.';
function pixels(values) { return values.flatMap(value => value === 0 ? [0, 0, 0, 0] : [value, value + 10, value + 20, 255]); }
const CASES = [
	{ name: 'true crop and fixed Frame contain', natural: { width: 2, height: 2, pixels: pixels([2, 3, 6, 7]) }, frame: { width: 4, height: 2, pixels: pixels([0, 2, 3, 0, 0, 6, 7, 0]) } },
	{ name: 'clockwise quarter turn then output flip', natural: { width: 2, height: 2, pixels: pixels([1, 3, 2, 4]) }, frame: { width: 2, height: 2, pixels: pixels([1, 3, 2, 4]) } },
	{ name: 'non-affine source quad rectification', natural: { width: 2, height: 2, pixels: [25, 35, 45, 255, 105, 115, 125, 255, 71, 81, 91, 255, 129, 139, 149, 255] },
		frame: { width: 2, height: 2, pixels: [25, 35, 45, 255, 105, 115, 125, 255, 71, 81, 91, 255, 129, 139, 149, 255] } },
	{ name: 'premultiplied interpolation without hidden RGB bleed', natural: { width: 2, height: 1, pixels: [0, 0, 255, 128, 0, 128, 128, 255] },
		frame: { width: 4, height: 1, pixels: [0, 0, 0, 0, 0, 0, 255, 128, 0, 128, 128, 255, 0, 0, 0, 0] } },
];

for (const [index, fixture] of CASES.entries()) test(`native Frames geometry: ${fixture.name}`, async ({ page }) => {
	const bundle = await build({ entryPoints: [fileURLToPath(ENTRY)], bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent' });
	await page.context().route(`**${MODULE}`, route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).framescaper : browserProductSiteForBuild('framescaper').origin;
	await page.goto(`${origin}/en/`);
	const result = await page.evaluate(async ({ path, index }) => (await import(new URL(path, location.href).href)).qualifyImageGeometryNativeV1(index), { path: MODULE, index });
	expect(result.natural).toEqual(fixture.natural); expect(result.frame).toEqual(fixture.frame);
	expect(result.preview).toEqual(fixture.frame); expect(result.sourceUnchanged).toBe(true);
});

const COPY = {
	en: { properties: 'Clip properties', choose: 'Choose an effect', add: 'Add effect', effect: 'Crop and perspective (contain)', crop: 'Crop width',
		edit: 'Edit', clips: 'Audio clips', clip: 'Video clip: geometry-source',
		rotation: 'Clockwise rotation', perspective: 'Rectify source quad', aspect: 'Crop aspect', flip: 'Flip horizontally',
		right: 'Bottom right X', left: 'Bottom left X', exact: 'Exact value', on: 'On' },
	de: { properties: 'Clip-Eigenschaften', choose: 'Effekt auswählen', add: 'Effekt hinzufügen', effect: 'Zuschnitt und Perspektive (Einpassen)', crop: 'Zuschnittbreite',
		edit: 'Bearbeiten', clips: 'Audio-Clips', clip: 'Videoclip: geometry-source',
		rotation: 'Drehung im Uhrzeigersinn', perspective: 'Quellviereck entzerren', aspect: 'Zuschnittformat', flip: 'Horizontal spiegeln',
		right: 'Unten rechts X', left: 'Unten links X', exact: 'Genauer Wert', on: 'Ein' },
};

for (const locale of ['en', 'de']) test(`Frames ${locale} authors geometry only through opted-in clip properties`, async ({ page }, testInfo) => {
	test.skip(testInfo.project.name === 'webkit', WEBKIT_AV_IMPORT_DEFERRED); test.setTimeout(90_000);
	const copy = COPY[locale], errors = collectClientErrors(page), editor = await bootEditor(page, `/framescaper/${locale}/`);
	await expect(editor.getByRole('checkbox', { name: copy.effect, exact: true })).toHaveCount(0);
	await importFiles(editor, [createDeterministicAvFixture('geometry-source.webm')]);
	const clip = editor.locator('[data-clip-kind="video"]').first(); await expect(clip).toBeVisible(); await clip.click({ button: 'right' });
	await page.getByRole('menuitem', { name: copy.properties, exact: true }).click();
	const panel = editor.locator('[data-workspace-panel="clip-properties"]'); await expect(panel).toBeVisible();
	await chooseDropdown(page, panel.getByRole('group', { name: copy.choose, exact: true }), copy.effect);
	await panel.getByRole('button', { name: copy.add, exact: true }).click();
	await expect(panel.getByRole('checkbox', { name: copy.effect, exact: true })).toBeChecked();
	const crop = panel.getByRole('spinbutton', { name: `${copy.exact}: ${copy.crop}`, exact: true });
	await crop.fill('0.5'); await crop.press('Enter'); await expect(crop).toHaveValue('0.5');
	const rotation = panel.getByRole('spinbutton', { name: `${copy.exact}: ${copy.rotation}`, exact: true });
	await rotation.fill('90'); await rotation.press('Enter'); await expect(rotation).toHaveValue('90');
	await panel.getByRole('combobox', { name: `${copy.exact}: ${copy.perspective}`, exact: true }).selectOption({ label: copy.on });
	await expect(panel.getByRole('combobox', { name: `${copy.exact}: ${copy.perspective}`, exact: true })).toHaveValue('1');
	await panel.getByRole('combobox', { name: `${copy.exact}: ${copy.aspect}`, exact: true }).selectOption({ label: '1:1' });
	await panel.getByRole('combobox', { name: `${copy.exact}: ${copy.flip}`, exact: true }).selectOption({ label: copy.on });
	for (const [label, value] of [[copy.right, '0.75'], [copy.left, '0.25']]) {
		const point = panel.getByRole('spinbutton', { name: `${copy.exact}: ${label}`, exact: true });
		await point.fill(value); await point.press('Enter'); await expect(point).toHaveValue(value);
	}
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.reload();
	const reopened = await waitForEditor(page); await waitForProjectActivation(reopened);
	const restoredClip = reopened.getByRole('group', { name: copy.clip, exact: true });
	await restoredClip.focus(); await restoredClip.press('Enter');
	await chooseNestedCommandAction(page, reopened, copy.edit, [copy.clips, copy.properties]);
	const restored = reopened.locator('[data-workspace-panel="clip-properties"]');
	await expect(restored.getByRole('spinbutton', { name: `${copy.exact}: ${copy.crop}`, exact: true })).toHaveValue('0.5');
	await expect(restored.getByRole('spinbutton', { name: `${copy.exact}: ${copy.rotation}`, exact: true })).toHaveValue('90');
	await expect(restored.getByRole('combobox', { name: `${copy.exact}: ${copy.perspective}`, exact: true })).toHaveValue('1');
	await expect(restored.getByRole('combobox', { name: `${copy.exact}: ${copy.aspect}`, exact: true })).toHaveValue('2');
	await expect(restored.getByRole('combobox', { name: `${copy.exact}: ${copy.flip}`, exact: true })).toHaveValue('1');
	await expect(restored.getByRole('spinbutton', { name: `${copy.exact}: ${copy.right}`, exact: true })).toHaveValue('0.75');
	await expect(restored.getByRole('spinbutton', { name: `${copy.exact}: ${copy.left}`, exact: true })).toHaveValue('0.25');
	expect(errors).toEqual([]);
});
