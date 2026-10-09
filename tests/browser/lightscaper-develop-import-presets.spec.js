/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopSettingsCopy } from '../../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';

test.use({ browserCoverage: false });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==', 'base64');
const SHA256 = createHash('sha256').update(PNG).digest('hex');

for (const locale of ['en', 'de']) test(`${locale}: Import options apply full and partial Develop presets with exact originals and recoverable per-file failures`, async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'The roadmap defers the full WebKit storage workflow until native Blob/OPFS support is qualified.');
	test.setTimeout(120_000);
	const origins = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS) : null;
	const origin = origins?.lightscaper ?? browserProductSiteForBuild('lightscaper').origin;
	const copy = bundledLightscaperEditorCopyForLocale(locale), develop = photoDevelopCopy(locale), messages = photoDevelopSettingsCopy(locale), errors = [];
	page.on('pageerror', error => { errors.push(error.message); }); await page.goto(`${origin}/${locale}/`);
	const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible(); await expect(app.getByRole('dialog')).toHaveCount(0);
	let importer = await importDialog();
	await expect(importer.getByRole('combobox', { name: messages.choosePreset, exact: true })).toHaveCount(0);
	await importer.getByLabel(copy.photoChooseFiles).setInputFiles([source('Source.png')]);
	await keyboard(importer.getByRole('button', { name: copy.photoImportAction, exact: true })); await expect(importer).toHaveCount(0);
	const library = app.locator('[data-photo-library]'); await expect(library.locator('[data-photo-id]')).toHaveCount(1);
	const seedId = await library.locator('[data-photo-id]').getAttribute('data-photo-id');
	await keyboard(library.locator(`[data-photo-id="${seedId}"]`)); let dialog = await openDevelop('Source.png');
	await keyboard(dialog.getByRole('button', { name: develop.add, exact: true })); await number('videoEffectParamTemperature', '23');
	await dialog.getByRole('combobox', { name: develop.choose, exact: true }).selectOption({ label: develop.shared.videoEffectToneLadder });
	await keyboard(dialog.getByRole('button', { name: develop.add, exact: true })); await number('videoEffectParamExposure', '1.25');
	await keyboard(dialog.getByRole('button', { name: develop.save, exact: true })); await settled();
	await settingsAction(messages.presets); let options = page.getByRole('dialog', { name: messages.presets, exact: true });
	await options.getByRole('checkbox', { name: messages.all, exact: true }).check();
	await options.getByRole('checkbox', { name: messages.geometry, exact: true }).check(); await options.getByRole('checkbox', { name: messages.local, exact: true }).check();
	await options.getByRole('textbox', { name: messages.presetName, exact: true }).fill('Full import look');
	await keyboard(options.getByRole('button', { name: messages.savePreset, exact: true })); await settled();
	await options.getByRole('checkbox', { name: messages.all, exact: true }).uncheck();
	await options.getByRole('checkbox', { name: develop.shared.videoEffectWhiteBalance, exact: true }).check();
	await options.getByRole('checkbox', { name: messages.geometry, exact: true }).uncheck(); await options.getByRole('checkbox', { name: messages.local, exact: true }).uncheck();
	await options.getByRole('textbox', { name: messages.presetName, exact: true }).fill('WB import look');
	await keyboard(options.getByRole('button', { name: messages.savePreset, exact: true })); await settled();
	await keyboard(options.getByRole('button', { name: messages.close, exact: true }).filter({ hasText: messages.close })); await expect(options).toHaveCount(0); await closeDevelop();

	importer = await importDialog(); await importer.getByLabel(copy.photoChooseFiles).setInputFiles([source('Full.png'), { name: 'Broken.png', mimeType: 'image/png', buffer: Buffer.from('Invalid photo') }, source('Full twin.png')]);
	await keyboard(importer.locator('[data-photo-import-options] > summary'));
	let selector = importer.getByRole('combobox', { name: messages.choosePreset, exact: true }); await expect(selector).toBeEnabled();
	await selector.selectOption({ label: `Full import look (${messages.full})` }); const selectedId = await selector.inputValue();
	await keyboard(importer.locator('[data-photo-import-options] > summary')); await keyboard(importer.locator('[data-photo-import-options] > summary'));
	selector = importer.getByRole('combobox', { name: messages.choosePreset, exact: true }); await expect(selector).toBeEnabled(); await expect(selector).toHaveValue(selectedId);
	await keyboard(importer.getByRole('button', { name: copy.photoImportAction, exact: true })); await expect(importer).toHaveCount(0);
	await expect(library.locator('[data-photo-id]')).toHaveCount(3); await expect(library.locator('[data-photo-import-status="imported"]')).toHaveCount(2);
	await expect(library.locator('[data-photo-import-status="failed"]')).toHaveCount(1);
	await selectPhoto('Full.png'); dialog = await openDevelop('Full.png');
	await expect(dialog.getByRole('spinbutton', { name: exact('videoEffectParamTemperature'), exact: true })).toHaveValue('23');
	await expect(dialog.getByRole('spinbutton', { name: exact('videoEffectParamExposure'), exact: true })).toHaveValue('1.25'); await closeDevelop();
	importer = await importDialog(); await importer.getByLabel(copy.photoChooseFiles).setInputFiles([source('Partial.png')]);
	await keyboard(importer.locator('[data-photo-import-options] > summary')); selector = importer.getByRole('combobox', { name: messages.choosePreset, exact: true });
	await expect(selector).toBeEnabled(); await selector.selectOption({ label: `WB import look (${messages.partial})` });
	await keyboard(importer.getByRole('button', { name: copy.photoImportAction, exact: true })); await expect(importer).toHaveCount(0); await expect(library.locator('[data-photo-id]')).toHaveCount(4);
	await selectPhoto('Partial.png'); dialog = await openDevelop('Partial.png');
	await expect(dialog.getByRole('spinbutton', { name: exact('videoEffectParamTemperature'), exact: true })).toHaveValue('23');
	await expect(dialog.getByRole('spinbutton', { name: exact('videoEffectParamExposure'), exact: true })).toHaveCount(0); await closeDevelop();
	const ids = await library.locator('[data-photo-id]').evaluateAll(nodes => nodes.map(node => node.dataset.photoId)), before = await observe(page, ids);
	for (const photo of before.photos) { expect(photo.sha256).toBe(SHA256); expect(photo.bytes).toEqual([...PNG]); expect(photo.byteLength).toBe(PNG.length);
		expect(photo.originalName).toBe(photo.fileName); expect(photo.revision).toBe(photo.fileName === 'Source.png' ? 1 : 0); }
	expect(new Set(before.photos.map(photo => photo.storageKey)).size).toBe(1);
	await page.reload(); await expect(app).toBeVisible(); await expect(library).toHaveCount(0);
	await summary(app, copy.photoViewMenu); await keyboard(app.getByRole('button', { name: copy.photoShowLibrary, exact: true }));
	await expect(library.locator('[data-photo-id]')).toHaveCount(4); await selectPhoto('Partial.png'); dialog = await openDevelop('Partial.png');
	await expect(dialog.getByRole('spinbutton', { name: exact('videoEffectParamTemperature'), exact: true })).toHaveValue('23');
	await expect(dialog.getByRole('spinbutton', { name: exact('videoEffectParamExposure'), exact: true })).toHaveCount(0); await closeDevelop();
	expect(await observe(page, ids)).toEqual(before); expect(errors).toEqual([]);

	function source(name) { return { name, mimeType: 'image/png', buffer: PNG }; }
	function exact(key) { return `${develop.shared.videoEffectExactValue}: ${develop.shared[key]}`; }
	async function keyboard(locator) { await expect(locator).toBeEnabled(); await locator.focus(); await page.keyboard.press('Enter'); }
	async function summary(root, name) { await keyboard(root.locator('summary').filter({ hasText: new RegExp(`^${name}$`, 'u') })); }
	async function importDialog() { await summary(app, copy.photoFileMenu); await keyboard(app.getByRole('button', { name: copy.photoImportPhotos, exact: true })); return page.getByRole('dialog', { name: copy.photoImportPhotos, exact: true }); }
	async function selectPhoto(name) { await expect(library).toHaveAttribute('aria-busy', 'false'); await keyboard(library.locator('[data-photo-id]').filter({ hasText: name })); }
	async function openDevelop(name) { await summary(app, copy.photoFileMenu); await summary(app, copy.photoPhotoMenu); await keyboard(app.getByRole('button', { name: photoDevelopMenuLabel(locale), exact: true }));
		const target = page.getByRole('dialog', { name: `${develop.title}: ${name}`, exact: true }); await expect(target.getByRole('region', { name: develop.preview, exact: true })).toHaveAttribute('data-state', 'ready'); return target; }
	async function number(key, value) { const input = dialog.getByRole('spinbutton', { name: exact(key), exact: true }); await input.fill(value); await input.press('Enter'); await expect(input).toHaveValue(value); }
	async function settled() { await expect(dialog.getByRole('button', { name: develop.cancel, exact: true }).last()).toBeDisabled(); await expect(library).toHaveAttribute('aria-busy', 'false'); }
	async function settingsAction(name) { await summary(dialog, messages.menu); await keyboard(dialog.getByRole('button', { name, exact: true })); }
	async function closeDevelop() { await keyboard(dialog.getByRole('button', { name: develop.close, exact: true }).filter({ hasText: develop.close })); await expect(dialog).toHaveCount(0); }
});

/** Read-only observer is valid here: this workflow never restores or replaces the default namespace. */
async function observe(page, ids) {
	if (ids.length > 4) throw new RangeError('Develop import observation is bounded to four photos.');
	const result = await build({ entryPoints: [fileURLToPath(new URL('../helpers/lightscaper-photo-library-ui-fixture.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
	await page.route('**/__develop_import_original_observer.js', route => route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text }));
	return page.evaluate(async photoIds => { const module = await import(new URL('/__develop_import_original_observer.js', location.href).href); return module.readResidentPhotoLibraryV1(photoIds); }, ids);
}
