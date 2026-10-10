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
import { installNativeOpfsWorkerCompanion, assertNativeOpfsWorkerExecution } from './helpers/native-opfs-worker-companion.ts';

test.use({ browserCoverage: false });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==', 'base64');
const SHA256 = createHash('sha256').update(PNG).digest('hex');
const CUBE = Buffer.from(`LUT_3D_SIZE 2\n${Array.from({ length: 8 }, () => '0.25 0 0\n').join('')}`);
const LUT_SHA = createHash('sha256').update(CUBE).digest('hex');
const LUT = { storageKey: `lut-sha256:${LUT_SHA}`, sha256: LUT_SHA, byteLength: CUBE.byteLength, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
const LUT_PIXELS = Array.from({ length: 4 }, () => [137, 0, 0, 255]).flat();

for (const locale of ['en', 'de']) test(`${locale}: keyboard Import options apply full LUT and numeric partial Develop presets with exact originals and recoverable per-file failures`, async ({ page, browserName }) => {
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
	await choose(dialog.getByRole('combobox', { name: develop.choose, exact: true }), 'tone-ladder-v1');
	await keyboard(dialog.getByRole('button', { name: develop.add, exact: true })); await number('videoEffectParamExposure', '1.25');
	await choose(dialog.getByRole('combobox', { name: develop.choose, exact: true }), 'cube-lut-profile-v1');
	await keyboard(dialog.getByRole('button', { name: develop.add, exact: true }));
	await dialog.getByLabel(develop.shared.videoEffectCubeLutImport, { exact: true }).setInputFiles({ name: 'Import preset.cube', mimeType: 'text/plain', buffer: CUBE });
	await expect.poll(() => pixels(dialog.getByRole('img', { name: develop.after, exact: true }))).toEqual(LUT_PIXELS);
	await keyboard(dialog.getByRole('button', { name: develop.save, exact: true })); await settled();
	await settingsAction(messages.presets); let options = page.getByRole('dialog', { name: messages.presets, exact: true });
	await checked(options.getByRole('checkbox', { name: messages.all, exact: true }), true);
	await checked(options.getByRole('checkbox', { name: messages.geometry, exact: true }), true); await checked(options.getByRole('checkbox', { name: messages.local, exact: true }), true);
	await options.getByRole('textbox', { name: messages.presetName, exact: true }).fill('Full import look');
	await keyboard(options.getByRole('button', { name: messages.savePreset, exact: true })); await settled();
	await checked(options.getByRole('checkbox', { name: messages.all, exact: true }), false);
	await checked(options.getByRole('checkbox', { name: develop.shared.videoEffectWhiteBalance, exact: true }), true);
	await checked(options.getByRole('checkbox', { name: messages.geometry, exact: true }), false); await checked(options.getByRole('checkbox', { name: messages.local, exact: true }), false);
	await options.getByRole('textbox', { name: messages.presetName, exact: true }).fill('WB import look');
	await keyboard(options.getByRole('button', { name: messages.savePreset, exact: true })); await settled();
	await keyboard(options.getByRole('button', { name: messages.close, exact: true }).filter({ hasText: messages.close })); await expect(options).toHaveCount(0); await closeDevelop();

	importer = await importDialog(); await importer.getByLabel(copy.photoChooseFiles).setInputFiles([source('Full.png'), { name: 'Broken.png', mimeType: 'image/png', buffer: Buffer.from('Invalid photo') }, source('Full twin.png')]);
	await keyboard(importer.locator('[data-photo-import-options] > summary'));
	let selector = importer.getByRole('combobox', { name: messages.choosePreset, exact: true }); await expect(selector).toBeEnabled();
	await choose(selector, { label: `Full import look (${messages.full})` }); const selectedId = await selector.inputValue();
	await keyboard(importer.locator('[data-photo-import-options] > summary')); await keyboard(importer.locator('[data-photo-import-options] > summary'));
	selector = importer.getByRole('combobox', { name: messages.choosePreset, exact: true }); await expect(selector).toBeEnabled(); await expect(selector).toHaveValue(selectedId);
	await keyboard(importer.getByRole('button', { name: copy.photoImportAction, exact: true })); await expect(importer).toHaveCount(0);
	await expect(library.locator('[data-photo-id]')).toHaveCount(3); await expect(library.locator('[data-photo-import-status="imported"]')).toHaveCount(2);
	await expect(library.locator('[data-photo-import-status="failed"]')).toHaveCount(1);
	await selectPhoto('Full.png'); dialog = await openDevelop('Full.png');
	await expect(dialog.getByRole('spinbutton', { name: exact('videoEffectParamTemperature'), exact: true })).toHaveValue('23');
	await expect(dialog.getByRole('spinbutton', { name: exact('videoEffectParamExposure'), exact: true })).toHaveValue('1.25');
	await expect.poll(() => pixels(dialog.getByRole('img', { name: develop.after, exact: true }))).toEqual(LUT_PIXELS); await closeDevelop();
	importer = await importDialog(); await importer.getByLabel(copy.photoChooseFiles).setInputFiles([source('Partial.png')]);
	await keyboard(importer.locator('[data-photo-import-options] > summary')); selector = importer.getByRole('combobox', { name: messages.choosePreset, exact: true });
	await expect(selector).toBeEnabled(); await choose(selector, { label: `WB import look (${messages.partial})` });
	await keyboard(importer.getByRole('button', { name: copy.photoImportAction, exact: true })); await expect(importer).toHaveCount(0); await expect(library.locator('[data-photo-id]')).toHaveCount(4);
	await selectPhoto('Partial.png'); dialog = await openDevelop('Partial.png');
	await expect(dialog.getByRole('spinbutton', { name: exact('videoEffectParamTemperature'), exact: true })).toHaveValue('23');
	await expect(dialog.getByRole('spinbutton', { name: exact('videoEffectParamExposure'), exact: true })).toHaveCount(0);
	await expect(dialog.getByLabel(develop.shared.videoEffectCubeLutImport, { exact: true })).toHaveCount(0); await closeDevelop();
	const ids = await library.locator('[data-photo-id]').evaluateAll(nodes => nodes.map(node => node.dataset.photoId)), before = await observe(page, ids);
	expect(before.namespace).toBeNull(); expect(before.photos).toHaveLength(4);
	for (const { photo, bytes } of before.photos) {
		expect(photo.original.contentSha256).toBe(SHA256); expect(bytes).toEqual([...PNG]); expect(photo.original.byteLength).toBe(PNG.length);
		expect(createHash('sha256').update(Buffer.from(bytes)).digest('hex')).toBe(SHA256);
		expect(photo.original.name).toBe(photo.metadata.fileName); expect(photo.revision).toBe(photo.metadata.fileName === 'Source.png' ? 1 : 0);
		const partial = photo.metadata.fileName === 'Partial.png';
		expect(photo.schemaVersion).toBe(partial ? 1 : 2); expect(photo.versions).toHaveLength(1);
		const version = photo.versions[0]; expect(photo.activeVersionId).toBe(version.id);
		const effects = [{ type: 'white-balance-v1', enabled: true, params: { temperature: 23, tint: 0 } },
			...(partial ? [] : [{ type: 'tone-ladder-v1', enabled: true, params: { exposure: 1.25, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 } },
				{ type: 'cube-lut-profile-v1', enabled: true, params: { lut: LUT } }])];
		expect(version.develop).toEqual({ processVersion: partial ? 1 : 2, effects: version.develop.effects.map(({ id }, index) => ({ id, ...effects[index] })),
			geometry: { crop: null, rotationDegrees: 0, flipHorizontal: false, flipVertical: false }, masks: [], maskBindings: [] });
		expect(version.develop.effects).toHaveLength(effects.length); expect(new Set(version.develop.effects.map(effect => effect.id)).size).toBe(effects.length);
		expect(version.workspace.schemaVersion).toBe(partial ? 1 : 2); expect(version.workspace.cursor).toBe(1);
		expect(version.workspace.entries.map(entry => entry.develop.processVersion)).toEqual(partial ? [1, 1] : [1, 2]);
		expect(version.workspace.entries[0].develop).toEqual({ processVersion: 1, effects: [],
			geometry: { crop: null, rotationDegrees: 0, flipHorizontal: false, flipVertical: false }, masks: [], maskBindings: [] });
		expect(version.workspace.entries.at(-1).develop).toEqual(version.develop); expect(version.workspace.snapshots).toEqual([]);
	}
	expect(new Set(before.photos.map(({ photo }) => photo.original.storageKey)).size).toBe(1);
	await page.reload(); await expect(app).toBeVisible(); await expect(library).toHaveCount(0);
	await summary(app, copy.photoViewMenu); await keyboard(app.getByRole('button', { name: copy.photoShowLibrary, exact: true }));
	await expect(library.locator('[data-photo-id]')).toHaveCount(4); await selectPhoto('Partial.png'); dialog = await openDevelop('Partial.png');
	await expect(dialog.getByRole('spinbutton', { name: exact('videoEffectParamTemperature'), exact: true })).toHaveValue('23');
	await expect(dialog.getByRole('spinbutton', { name: exact('videoEffectParamExposure'), exact: true })).toHaveCount(0);
	await expect(dialog.getByLabel(develop.shared.videoEffectCubeLutImport, { exact: true })).toHaveCount(0); await closeDevelop();
	await selectPhoto('Full.png'); dialog = await openDevelop('Full.png');
	await expect.poll(() => pixels(dialog.getByRole('img', { name: develop.after, exact: true }))).toEqual(LUT_PIXELS); await closeDevelop();
	expect(await observe(page, ids)).toEqual(before); expect(errors).toEqual([]);

	function source(name) { return { name, mimeType: 'image/png', buffer: PNG }; }
	function exact(key) { return `${develop.shared.videoEffectExactValue}: ${develop.shared[key]}`; }
	async function keyboard(locator) { await expect(locator).toBeEnabled(); await locator.focus(); await expect(locator).toBeFocused(); await page.keyboard.press('Enter'); }
	async function checked(locator, value) { await expect(locator).toBeEnabled(); await locator.focus(); await expect(locator).toBeFocused();
		if (await locator.isChecked() !== value) await page.keyboard.press('Space'); await expect(locator).toBeChecked({ checked: value }); }
	async function choose(locator, value) {
		const choices = await locator.getByRole('option').evaluateAll(options => options.map(option => ({ value: option.value, label: option.label })));
		const index = choices.findIndex(option => typeof value === 'string' ? option.value === value : option.label === value.label);
		expect(index).toBeGreaterThanOrEqual(0); expect(choices.length).toBeLessThanOrEqual(64); await locator.focus(); await expect(locator).toBeFocused();
		await page.keyboard.press('Home'); for (let step = 0; step < index; step++) await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Tab'); await expect(locator).toHaveValue(choices[index].value);
	}
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

/** Current admission authenticates complete Photo1/2 documents and retained LUT bodies as well as original bytes. */
async function observe(page, ids) {
	await installNativeOpfsWorkerCompanion(page);
	if (ids.length > 4) throw new RangeError('Develop import observation is bounded to four photos.');
	const result = await build({ stdin: { resolveDir: fileURLToPath(new URL('../helpers/', import.meta.url)), contents:
		`export { readResidentPhotoLibraryCurrent } from './lightscaper-current-app-fixture.tsx';` }, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
	await page.route('**/__develop_import_original_observer.js', route => route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text }));
	const observed = await page.evaluate(async photoIds => { const module = await import(new URL('/__develop_import_original_observer.js', location.href).href);
		return module.readResidentPhotoLibraryCurrent(photoIds, indexedDB, () => globalThis.__assertNativeOpfsWorkerExecution()); }, ids);
	await assertNativeOpfsWorkerExecution(page); return observed;
}
async function pixels(canvas) { return canvas.evaluate(element => element.width === 2 && element.height === 2
	? [...element.getContext('2d').getImageData(0, 0, 2, 2).data] : null); }
