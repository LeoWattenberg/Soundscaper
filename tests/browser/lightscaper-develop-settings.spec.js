/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { bundledSiteCopyForLocale } from '../../src/common/i18n/site-copy.js';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopSettingsCopy } from '../../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { installNativeOpfsWorkerCompanion, assertNativeOpfsWorkerExecution } from './helpers/native-opfs-worker-companion.ts';

test.use({ browserCoverage: false });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==', 'base64');
const CUBE = Buffer.from(`LUT_3D_SIZE 2\n${Array.from({ length: 8 }, () => '0.25 0 0\n').join('')}`);
const LUT_SHA = createHash('sha256').update(CUBE).digest('hex');
const LUT = { storageKey: `lut-sha256:${LUT_SHA}`, sha256: LUT_SHA, byteLength: CUBE.byteLength, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
const NEUTRAL_GEOMETRY = { crop: null, rotationDegrees: 0, flipHorizontal: false, flipVertical: false };

for (const locale of ['en', 'de']) {
	test(`${locale}: settings and presets remain opted-in menus on an empty library`, async ({ page }) => {
		const origin = JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper;
		await page.goto(`${origin}/${locale}/`);
		const app = page.locator('[data-lightscaper-bound="true"]'), messages = photoDevelopSettingsCopy(locale);
		await expect(app).toBeVisible(); await expect(app.getByRole('dialog')).toHaveCount(0);
		await expect(app.locator('summary').filter({ hasText: messages.menu })).toHaveCount(0);
		await expect(app.getByRole('button', { name: messages.copy, exact: true })).toHaveCount(0);
	});

	test(`${locale}: keyboard Copy/Paste, Sync, Auto-sync, Quick develop and full/partial presets preserve mixed LUT histories and exact native originals after reload`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'The roadmap defers the full WebKit storage workflow until native Blob/OPFS support is qualified.');
		test.setTimeout(120_000);
		const origin = JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper, copy = bundledLightscaperEditorCopyForLocale(locale);
		const develop = photoDevelopCopy(locale), messages = photoDevelopSettingsCopy(locale), errors = [];
		page.on('pageerror', error => { errors.push(error.message); }); await page.goto(`${origin}/${locale}/`);
		const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
		await summary(page, app, copy.photoFileMenu); await keyboard(page, app.getByRole('button', { name: copy.photoImportPhotos, exact: true }));
		const importer = page.getByRole('dialog', { name: copy.photoImportPhotos, exact: true });
		await importer.getByLabel(copy.photoChooseFiles).setInputFiles(['Source.png', 'Target one.png', 'Target two.png'].map(name => ({ name, mimeType: 'image/png', buffer: PNG })));
		await keyboard(page, importer.getByRole('button', { name: copy.photoImportAction, exact: true }));
		const library = app.getByRole('region', { name: bundledSiteCopyForLocale(locale).workspacePhoto, exact: true });
		const cards = library.locator('[data-photo-id]'); await expect(cards).toHaveCount(3); await expect(library).toHaveAttribute('aria-busy', 'false');
		const ids = await cards.evaluateAll(values => values.map(value => value.getAttribute('data-photo-id'))), originals = await observe(page, ids);
		for (const original of originals.photos) expect(original.bytes).toEqual([...PNG]);
		const sourceId = originals.photos.find(({ photo }) => photo.metadata.fileName === 'Source.png').photo.id;
		const firstTargetId = originals.photos.find(({ photo }) => photo.metadata.fileName === 'Target one.png').photo.id;
		await keyboard(page, library.locator(`[data-photo-id="${sourceId}"]`)); await photoAction(copy.photoSelectAll);
		let dialog = await openDevelop('Source.png');
		await keyboard(page, dialog.getByRole('button', { name: develop.add, exact: true })); await number('videoEffectParamTemperature', '0.25');
		await choose(page, dialog.getByRole('combobox', { name: develop.choose, exact: true }), 'cube-lut-profile-v1');
		await keyboard(page, dialog.getByRole('button', { name: develop.add, exact: true }));
		await dialog.getByLabel(develop.shared.videoEffectCubeLutImport, { exact: true }).setInputFiles({ name: 'Settings resource.cube', mimeType: 'text/plain', buffer: CUBE });
		await expect.poll(() => pixels(dialog.getByRole('img', { name: develop.after, exact: true }))).toEqual(Array.from({ length: 4 }, () => [137, 0, 0, 255]).flat());
		await save(); await settingsAction(messages.copy);
		let options = page.getByRole('dialog', { name: messages.copy, exact: true }); await partialWhiteBalance(options);
		await keyboard(page, options.getByRole('button', { name: messages.confirmCopy, exact: true })); await expect(options).toHaveCount(0);
		await settingsAction(messages.sync); options = page.getByRole('dialog', { name: messages.sync, exact: true });
		await partialWhiteBalance(options); await keyboard(page, options.getByRole('button', { name: messages.confirmSync, exact: true }));
		await settled(); await expect(options).toBeVisible(); await closeOptions(options);
		await settingsAction(messages.auto); options = page.getByRole('dialog', { name: messages.auto, exact: true });
		await keyboard(page, options.getByRole('button', { name: messages.confirmAuto, exact: true })); await expect(options).toHaveCount(0);
		await number('videoEffectParamTemperature', '0.5'); await save(); await settled();
		const synced = await observe(page, ids); expect(synced.photos.map(({ photo }) => photo.revision)).toEqual([2, 2, 2]);
		for (const { photo } of synced.photos) {
			const version = photo.versions.find(value => value.id === photo.activeVersionId);
			expect(photo.schemaVersion).toBe(photo.id === sourceId ? 2 : 1); expect(version.develop.processVersion).toBe(photo.id === sourceId ? 2 : 1);
			expect(version.develop.effects.map(effect => effect.type)).toEqual(photo.id === sourceId ? ['white-balance-v1', 'cube-lut-profile-v1'] : ['white-balance-v1']);
		}
		await settingsAction(messages.stopAuto); await settingsAction(messages.quick);
		options = page.getByRole('dialog', { name: messages.quick, exact: true }); await options.getByRole('spinbutton', { name: messages.delta, exact: true }).fill('0.5');
		await keyboard(page, options.getByRole('button', { name: messages.applyQuick, exact: true })); await settled(); await closeOptions(options);
		await settingsAction(messages.presets); options = page.getByRole('dialog', { name: messages.presets, exact: true });
		await checked(page, options.getByRole('checkbox', { name: messages.all, exact: true }), true);
		await checked(page, options.getByRole('checkbox', { name: messages.geometry, exact: true }), true); await checked(page, options.getByRole('checkbox', { name: messages.local, exact: true }), true);
		await options.getByRole('textbox', { name: messages.presetName, exact: true }).fill('Full look');
		await keyboard(page, options.getByRole('button', { name: messages.savePreset, exact: true })); await settled();
		await expect(options.getByRole('combobox', { name: messages.choosePreset, exact: true })).toContainText(`Full look (${messages.full})`);
		await partialWhiteBalance(options); await options.getByRole('textbox', { name: messages.presetName, exact: true }).fill('WB only');
		await keyboard(page, options.getByRole('button', { name: messages.savePreset, exact: true })); await settled();
		const presets = options.getByRole('combobox', { name: messages.choosePreset, exact: true });
		await choose(page, presets, { label: `WB only (${messages.partial})` }); await options.getByRole('textbox', { name: messages.presetName, exact: true }).fill('Renamed WB');
		await keyboard(page, options.getByRole('button', { name: messages.renamePreset, exact: true })); await settled();
		await expect(presets).toContainText(`Renamed WB (${messages.partial})`); await closeOptions(options);
		await number('videoEffectParamTemperature', '0.75'); await save();
		await settingsAction(messages.presets); options = page.getByRole('dialog', { name: messages.presets, exact: true });
		await choose(page, options.getByRole('combobox', { name: messages.choosePreset, exact: true }), { label: `Renamed WB (${messages.partial})` });
		await keyboard(page, options.getByRole('button', { name: messages.applyPreset, exact: true })); await settled();
		await expect(dialog.getByRole('spinbutton', { name: exact('videoEffectParamTemperature'), exact: true })).toHaveValue('0.5');
		await expect(dialog.getByRole('spinbutton', { name: exact('videoEffectParamExposure'), exact: true })).toHaveValue('0.5');
		await keyboard(page, options.getByRole('button', { name: messages.deletePreset, exact: true })); await settled();
		await expect(options.getByRole('combobox', { name: messages.choosePreset, exact: true })).not.toContainText('Renamed WB'); await closeOptions(options); await closeDevelop();
		await keyboard(page, library.locator(`[data-photo-id="${firstTargetId}"]`)); dialog = await openDevelop('Target one.png');
		await settingsAction(messages.paste); await settled();
		await expect(dialog.getByRole('spinbutton', { name: exact('videoEffectParamTemperature'), exact: true })).toHaveValue('0.25');
		await expect(dialog.getByRole('spinbutton', { name: exact('videoEffectParamExposure'), exact: true })).toHaveValue('0.5'); await closeDevelop();
		await page.reload(); await expect(app).toBeVisible(); await expect(library).toHaveCount(0);
		await summary(page, app, copy.photoViewMenu); await keyboard(page, app.getByRole('button', { name: copy.photoShowLibrary, exact: true }));
		await expect(cards).toHaveCount(3); await keyboard(page, library.locator(`[data-photo-id="${firstTargetId}"]`));
		dialog = await openDevelop('Target one.png'); await settingsAction(messages.presets); options = page.getByRole('dialog', { name: messages.presets, exact: true });
		await choose(page, options.getByRole('combobox', { name: messages.choosePreset, exact: true }), { label: `Full look (${messages.full})` });
		await keyboard(page, options.getByRole('button', { name: messages.applyPreset, exact: true })); await settled();
		await expect(dialog.getByRole('spinbutton', { name: exact('videoEffectParamTemperature'), exact: true })).toHaveValue('0.5');
		await expect.poll(() => pixels(dialog.getByRole('img', { name: develop.after, exact: true }))).toEqual(Array.from({ length: 4 }, () => [160, 0, 0, 255]).flat());
		await keyboard(page, options.getByRole('button', { name: messages.deletePreset, exact: true })); await settled();
		await expect(options.getByRole('combobox', { name: messages.choosePreset, exact: true }).getByRole('option')).toHaveText([messages.noPreset]); await closeOptions(options); await closeDevelop();
		const after = await observe(page, ids);
		expect(after.namespace).toBe(originals.namespace);
		for (const original of originals.photos) {
			const current = after.photos.find(({ photo }) => photo.id === original.photo.id);
			expect(current.bytes).toEqual(original.bytes);
			expect({ ...current.photo, schemaVersion: original.photo.schemaVersion, revision: original.photo.revision, versions: original.photo.versions }).toEqual(original.photo);
			const numeric = original.photo.metadata.fileName === 'Target two.png';
			expect(current.photo.schemaVersion).toBe(numeric ? 1 : 2); expect(current.photo.revision).toBe(numeric ? 3 : 5);
			for (const version of current.photo.versions) {
				expect(version.develop.processVersion).toBe(numeric ? 1 : 2); expect(version.workspace.schemaVersion).toBe(numeric ? 1 : 2);
				const effects = [{ type: 'white-balance-v1', enabled: true, params: { temperature: 0.5, tint: 0 } },
					...(numeric ? [] : [{ type: 'cube-lut-profile-v1', enabled: true, params: { lut: LUT } }]),
					{ type: 'tone-ladder-v1', enabled: true, params: { exposure: 0.5, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 } }];
				expect(version.develop).toEqual({ processVersion: numeric ? 1 : 2, effects: version.develop.effects.map(({ id }, index) => ({ id, ...effects[index] })),
					geometry: NEUTRAL_GEOMETRY, masks: [], maskBindings: [] });
				expect(new Set(version.develop.effects.map(effect => effect.id)).size).toBe(effects.length); expect(version.develop.effects).toHaveLength(effects.length);
				expect(version.workspace.entries.map(entry => entry.develop.processVersion)).toEqual(numeric ? [1, 1, 1, 1] : current.photo.id === sourceId ? [1, 2, 2, 2, 2, 2] : [1, 1, 1, 1, 1, 2]);
			}
		}
		expect(errors).toEqual([]);

		function exact(key) { return `${develop.shared.videoEffectExactValue}: ${develop.shared[key]}`; }
		async function number(key, value) { const input = dialog.getByRole('spinbutton', { name: exact(key), exact: true }); await input.fill(value); await input.press('Enter'); await expect(input).toHaveValue(value); }
		async function settled() { await expect(dialog.getByRole('button', { name: develop.cancel, exact: true }).last()).toBeDisabled();
			await expect(library).toHaveAttribute('aria-busy', 'false'); }
		async function save() { await keyboard(page, dialog.getByRole('button', { name: develop.save, exact: true })); await expect(dialog.locator('[data-photo-develop-ack]')).toContainText(develop.acknowledged); await settled(); }
		async function settingsAction(name) { const menu = dialog.locator('details').filter({ has: page.locator('summary').filter({ hasText: new RegExp(`^${messages.menu}$`, 'u') }) });
			if (!(await menu.evaluate(value => value.open))) await summary(page, dialog, messages.menu); await keyboard(page, menu.getByRole('button', { name, exact: true })); }
		async function partialWhiteBalance(target) { await checked(page, target.getByRole('checkbox', { name: messages.all, exact: true }), false);
			await checked(page, target.getByRole('checkbox', { name: develop.shared.videoEffectWhiteBalance, exact: true }), true);
			await checked(page, target.getByRole('checkbox', { name: messages.geometry, exact: true }), false); await checked(page, target.getByRole('checkbox', { name: messages.local, exact: true }), false); }
		async function closeOptions(target) { await keyboard(page, target.getByRole('button', { name: messages.close, exact: true }).filter({ hasText: messages.close })); await expect(target).toHaveCount(0); }
		async function closeDevelop() { await keyboard(page, dialog.getByRole('button', { name: develop.close, exact: true }).filter({ hasText: develop.close })); await expect(dialog).toHaveCount(0); }
		async function photoAction(name, nested = true) { await summary(page, app, copy.photoFileMenu); if (nested) await summary(page, app, copy.photoPhotoMenu);
			await keyboard(page, app.getByRole('button', { name, exact: true })); }
		async function openDevelop(fileName) { await photoAction(photoDevelopMenuLabel(locale)); const result = page.getByRole('dialog', { name: `${develop.title}: ${fileName}`, exact: true });
			await expect(result.getByRole('region', { name: develop.preview, exact: true })).toHaveAttribute('data-state', 'ready'); return result; }
	});
}
async function keyboard(page, locator) { await expect(locator).toBeEnabled(); await locator.focus(); await expect(locator).toBeFocused(); await page.keyboard.press('Enter'); }
async function checked(page, locator, value) {
	await expect(locator).toBeEnabled(); await locator.focus(); await expect(locator).toBeFocused();
	if (await locator.isChecked() !== value) await page.keyboard.press('Space'); await expect(locator).toBeChecked({ checked: value });
}
async function choose(page, combo, choice) {
	await expect(combo).toBeVisible(); await expect(combo).toBeEnabled();
	await expect.poll(() => combo.locator('option').evaluateAll((values, choice) => values.filter(option =>
		typeof choice === 'string' ? option.value === choice : option.label === choice.label).length, choice)).toBe(1);
	const options = await combo.locator('option').evaluateAll(values => values.map(option => ({ value: option.value, label: option.label })));
	const index = options.findIndex(option => typeof choice === 'string' ? option.value === choice : option.label === choice.label);
	expect(index).toBeGreaterThanOrEqual(0); expect(index).toBeLessThan(64); await combo.focus(); await expect(combo).toBeFocused(); await page.keyboard.press('Home');
	for (let step = 0; step < index; step++) await page.keyboard.press('ArrowDown'); await expect(combo).toHaveValue(options[index].value);
}
async function summary(page, root, name) { await keyboard(page, root.locator('summary').filter({ hasText: new RegExp(`^${name}$`, 'u') })); }
async function observe(page, ids) {
	await installNativeOpfsWorkerCompanion(page);
	const result = await build({ entryPoints: [fileURLToPath(new URL('../helpers/lightscaper-current-app-fixture.tsx', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
	await page.route('**/__develop_settings_original_observer.js', route => route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text }));
	const observed = await page.evaluate(async photoIds => { const module = await import(new URL('/__develop_settings_original_observer.js', location.href).href);
		return module.readResidentPhotoLibraryCurrent(photoIds, indexedDB, () => globalThis.__assertNativeOpfsWorkerExecution()); }, ids);
	await assertNativeOpfsWorkerExecution(page); return observed;
}
async function pixels(canvas) { return canvas.evaluate(element => element.width === 2 && element.height === 2 ? [...element.getContext('2d').getImageData(0, 0, 2, 2).data] : null); }
