/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopSettingsCopy } from '../../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { lightscaperRestoreCopy } from '../../src/common/i18n/lightscaper-restore-copy.ts';
import { importPhotoCatalogArchiveV5 } from '../../src/lightscaper/archive/catalog-archive-import-v5.ts';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { installNativeOpfsWorkerCompanion, assertNativeOpfsWorkerExecution } from './helpers/native-opfs-worker-companion.ts';

// The authored observer workflow serves test-only code; cold menu cases keep ordinary coverage.
const syntheticRouteTest = test.extend({ browserCoverage: false });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==', 'base64');
const CUBE = Buffer.from(`LUT_3D_SIZE 2\n${Array.from({ length: 8 }, () => '0.25 0 0\n').join('')}`);
const SHA = createHash('sha256').update(CUBE).digest('hex');
const LUT_PIXELS = Array.from({ length: 4 }, () => [137, 0, 0, 255]).flat();

for (const locale of ['en', 'de']) {
	test(`${locale}: current cube authoring remains a cold File Photo menu action`, async ({ page }) => {
		const { app, copy, messages } = await setup(page, locale);
		await expect(app.locator('[data-photo-library]')).toHaveCount(0); await expect(page.getByRole('dialog')).toHaveCount(0);
		await menu(page, app, copy.photoFileMenu, photoDevelopMenuLabel(locale), copy.photoPhotoMenu, false);
		await expect(named(app, 'button', photoDevelopMenuLabel(locale))).toBeDisabled();
		await expect(app.locator('[data-photo-develop-workspace]')).toHaveCount(0);
		await expect(app.getByLabel(messages.shared.videoEffectCubeLutImport, { exact: true })).toHaveCount(0);
	});

	syntheticRouteTest(`${locale}: keyboard LUT authoring preserves literal pixels, mixed history and full/partial presets through native V5 backup, same-ID restore and reload`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Full WebKit catalog Blob/OPFS custody qualification remains deferred.');
		test.setTimeout(120_000);
		const { app, copy, messages, settings, restoreCopy, errors } = await setup(page, locale);
		await menu(page, app, copy.photoFileMenu, copy.photoImportPhotos);
		const importer = named(page, 'dialog', copy.photoImportPhotos);
		await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: 'Current LUT.png', mimeType: 'image/png', buffer: PNG });
		await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
		const library = app.locator('[data-photo-library]'), card = library.locator('[data-photo-id]');
		await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false');
		const photoId = await card.getAttribute('data-photo-id'), original = await observe(page, photoId);
		expect(original.namespace).toBeNull(); expect(original.photos[0].bytes).toEqual([...PNG]);
		await openDevelop(); const dialog = named(page, 'dialog', `${messages.title}: Current LUT.png`);
		const preview = named(dialog, 'region', messages.preview), after = named(dialog, 'img', messages.after);
		await expect(preview).toHaveAttribute('data-state', 'ready'); const before = await pixels(after);
		await choose(page, named(dialog, 'combobox', messages.choose), 'cube-lut-profile-v1');
		await keyboard(page, named(dialog, 'button', messages.add));
		await expect(dialog.getByText(messages.shared.videoEffectCubeLutNone, { exact: true })).toBeVisible();
		await expect.poll(() => pixels(after)).toEqual(before);
		await dialog.getByLabel(messages.shared.videoEffectCubeLutImport, { exact: true }).setInputFiles({ name: 'Quarter red.cube', mimeType: 'text/plain', buffer: CUBE });
		await expect.poll(() => pixels(after)).toEqual(LUT_PIXELS);
		const histogram = named(dialog, 'img', `${messages.histogram}: ${messages.after}`);
		await expect.poll(async () => (await histogram.locator('polyline').nth(0).getAttribute('points')).split(' ')[137]).toBe('137,0');
		await save(); await expect(named(dialog, 'combobox', messages.history).getByRole('option')).toHaveCount(2);
		const history = named(dialog, 'combobox', messages.history);
		await history.focus(); await page.keyboard.press('ArrowUp'); await expect(history).toHaveValue('0'); await settled();
		await expect.poll(() => pixels(after)).toEqual(before);
		await history.focus(); await page.keyboard.press('ArrowDown'); await expect(history).toHaveValue('1'); await settled();
		await expect.poll(() => pixels(after)).toEqual(LUT_PIXELS);
		await named(dialog, 'textbox', messages.snapshotName).fill('Resource snapshot'); await keyboard(page, named(dialog, 'button', messages.saveSnapshot)); await settled();
		const options = await presets();
		await savePreset(options, 'Full LUT', false); await savePreset(options, 'LUT only', true);
		await keyboard(page, closeButton(options, settings.close)); await expect(options).toHaveCount(0);
		await closeDevelop();
		const saved = await observe(page, photoId), document = saved.photos[0].photo, version = active(document);
		expect(document.schemaVersion).toBe(2); expect(document.revision).toBe(original.photos[0].photo.revision + 4);
		expect(version.develop.processVersion).toBe(2); expect(version.workspace.schemaVersion).toBe(2);
		expect(version.workspace.entries.map(entry => entry.develop.processVersion)).toEqual([1, 2]);
		expect(version.workspace.snapshots).toHaveLength(1); expect(version.workspace.snapshots[0].develop.effects[0].params.lut.sha256).toBe(SHA);
		expect(document.original).toEqual(original.photos[0].photo.original); expect(document.metadata).toEqual(original.photos[0].photo.metadata);
		expect(document.extractedMetadata).toEqual(original.photos[0].photo.extractedMetadata); expect(saved.photos[0].bytes).toEqual([...PNG]);
		const backup = await downloadBackup(page, app, copy), authenticated = await decodeCurrentPhotoArchive(backup.buffer);
		expect(authenticated.photos).toEqual([{ document, original: PNG }]); expect(authenticated.resources).toHaveLength(1);
		expect(authenticated.resources[0]).toEqual({ reference: version.develop.effects[0].params.lut, bytes: CUBE });
		expect(authenticated.presets.schemaVersion).toBe(2); expect(authenticated.presetHeader).toMatchObject({ rowSchemaVersion: 2, revision: 2, presetCount: 2 });
		const full = authenticated.presets.presets.find(value => value.identity.name === 'Full LUT'), partial = authenticated.presets.presets.find(value => value.identity.name === 'LUT only');
		expect(full.settings.selection).toEqual({ effectTypes: 'all', geometry: true, localAdjustments: true });
		expect(partial.settings.selection).toEqual({ effectTypes: ['cube-lut-profile-v1'], geometry: false, localAdjustments: false });
		for (const preset of [full, partial]) expect(preset.settings.develop.effects[0].params.lut).toEqual(version.develop.effects[0].params.lut);
		// Change the previous namespace so an ignored restore cannot satisfy the full-document comparison.
		await openDevelop(); await keyboard(page, named(dialog, 'button', messages.shared.videoEffectCubeLutClear)); await save(); await closeDevelop();
		expect(active((await observe(page, photoId)).photos[0].photo).develop.effects[0].params.lut).toBeNull();
		await menu(page, app, copy.photoFileMenu, restoreCopy.title);
		const restore = named(page, 'dialog', restoreCopy.title); await restore.getByLabel(restoreCopy.file, { exact: true }).setInputFiles(backup);
		await keyboard(page, named(restore, 'button', restoreCopy.restore)); await expect(restore.locator('[data-photo-restore-receipt]')).toBeVisible();
		await expect(restore.getByRole('alert')).toHaveCount(0); await keyboard(page, closeButton(restore, restoreCopy.close));
		await page.reload(); await expect(app).toBeVisible(); await expect(library).toHaveCount(0);
		await menu(page, app, copy.photoViewMenu, copy.photoShowLibrary); await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false');
		const restored = await observe(page, photoId); expect(restored.namespace).toMatch(/^[a-f0-9]{32}$/u);
		expect(restored.root.id).toBe(saved.root.id); expect(restored.photos).toEqual(saved.photos);
		await openDevelop(); await expect(preview).toHaveAttribute('data-state', 'ready'); await expect.poll(() => pixels(after)).toEqual(LUT_PIXELS);
		const restoredOptions = await presets();
		const expectedLabels = [[full.identity.id, `Full LUT (${settings.full})`], [partial.identity.id, `LUT only (${settings.partial})`]]
			.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([, label]) => label);
		await expect(named(restoredOptions, 'combobox', settings.choosePreset).getByRole('option')).toHaveText([settings.noPreset, ...expectedLabels]);
		await keyboard(page, closeButton(restoredOptions, settings.close)); await closeDevelop();
		expect(await decodeCurrentPhotoArchive((await downloadBackup(page, app, copy)).buffer)).toEqual(authenticated); expect(errors).toEqual([]);

		async function openDevelop() { await keyboard(page, card); await menu(page, app, copy.photoFileMenu, photoDevelopMenuLabel(locale), copy.photoPhotoMenu); }
		async function settled() { await expect(named(dialog, 'button', messages.cancel).last()).toBeDisabled(); await expect(library).toHaveAttribute('aria-busy', 'false'); }
		async function save() { await keyboard(page, named(dialog, 'button', messages.save)); await expect(dialog.locator('[data-photo-develop-ack]')).toBeVisible(); await settled(); }
		async function closeDevelop() { await keyboard(page, closeButton(dialog, messages.close)); await expect(dialog).toHaveCount(0); }
		async function presets() { const menu = dialog.locator('details').filter({ has: page.locator('summary').filter({ hasText: new RegExp(`^${settings.menu}$`, 'u') }) });
			if (!(await menu.evaluate(element => element.open))) await keyboard(page, menu.locator('summary'));
			await keyboard(page, named(menu, 'button', settings.presets)); const options = named(page, 'dialog', settings.presets); await settled(); return options; }
		async function savePreset(options, name, partial) {
			await checked(page, named(options, 'checkbox', settings.all), !partial);
			if (partial) await checked(page, named(options, 'checkbox', messages.shared.videoEffectCubeLutProfile), true);
			await checked(page, named(options, 'checkbox', settings.geometry), !partial); await checked(page, named(options, 'checkbox', settings.local), !partial);
			await named(options, 'textbox', settings.presetName).fill(name); await keyboard(page, named(options, 'button', settings.savePreset)); await settled();
			await expect(named(options, 'combobox', settings.choosePreset)).toContainText(`${name} (${partial ? settings.partial : settings.full})`);
		}
	});
}

/** Authenticate the complete V5 record/resource closure and clone borrowed body bytes before release. */
export async function decodeCurrentPhotoArchive(bytes) {
	const result = { root: null, savedState: null, presetHeader: null, resources: [], presets: null, photos: [], stacks: [], saved: [] };
	await importPhotoCatalogArchiveV5(new Blob([bytes]), async (root, savedState, presetHeader) => {
		Object.assign(result, { root, savedState, presetHeader }); return {
			async writePhoto(document, chunks) { const parts = []; for await (const chunk of chunks) parts.push(Buffer.from(chunk)); result.photos.push({ document, original: Buffer.concat(parts) }); },
			async writeLut(reference, bytes) { result.resources.push({ reference, bytes: Buffer.from(bytes) }); },
			async writeDevelopPresets(row) { result.presets = row; }, async writeStack(stack) { result.stacks.push(stack); }, async writeSavedCollection(definition) { result.saved.push(definition); },
			async publish() {}, async rollback() { throw new Error('Current backup authentication rolled back.'); },
		};
	});
	result.photos.sort((a, b) => a.document.id.localeCompare(b.document.id)); return result;
}
async function observe(page, photoId) {
	await installNativeOpfsWorkerCompanion(page);
	const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('../helpers/', import.meta.url)), contents:
		`export { readResidentPhotoLibraryCurrent } from './lightscaper-current-app-fixture.tsx';` }, bundle: true, write: false, format: 'esm', platform: 'browser' });
	await page.route('**/__current_photo_observer.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
	const observed = await page.evaluate(async id => (await import(new URL('/__current_photo_observer.js', location.href).href))
		.readResidentPhotoLibraryCurrent([id], indexedDB, () => globalThis.__assertNativeOpfsWorkerExecution()), photoId);
	await assertNativeOpfsWorkerExecution(page); return observed;
}
async function setup(page, locale) {
	const errors = []; page.on('pageerror', error => { errors.push(error.message); });
	await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`); const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
	return { app, copy: bundledLightscaperEditorCopyForLocale(locale), messages: photoDevelopCopy(locale), settings: photoDevelopSettingsCopy(locale), restoreCopy: lightscaperRestoreCopy(locale), errors };
}
async function downloadBackup(page, app, copy) {
	await menu(page, app, copy.photoFileMenu, copy.photoBackupTitle); const dialog = named(page, 'dialog', copy.photoBackupTitle), pending = page.waitForEvent('download');
	await keyboard(page, named(dialog, 'button', copy.photoBackupSave)); const download = await pending;
	const source = { name: download.suggestedFilename(), mimeType: 'application/vnd.soundscaper.scape+zip', buffer: await readFile(await download.path()) };
	await expect(dialog.locator('[data-photo-backup-receipt]')).toContainText(copy.photoBackupDownloadStarted.replace('{name}', source.name));
	await keyboard(page, closeButton(dialog, copy.photoBackupClose)); return source;
}
function active(photo) { return photo.versions.find(version => version.id === photo.activeVersionId); }
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
function closeButton(scope, name) { return named(scope, 'button', name).filter({ hasText: new RegExp(`^${name}$`, 'u') }); }
async function keyboard(page, locator) { await expect(locator).toBeEnabled(); await locator.focus(); await expect(locator).toBeFocused(); await page.keyboard.press('Enter'); }
async function checked(page, locator, value) {
	await expect(locator).toBeEnabled(); await locator.focus(); await expect(locator).toBeFocused();
	if (await locator.isChecked() !== value) await page.keyboard.press('Space'); await expect(locator).toBeChecked({ checked: value });
}
async function menu(page, app, title, action, submenu, execute = true) {
	await keyboard(page, app.locator('nav > details > summary').filter({ hasText: new RegExp(`^${title}$`, 'u') }));
	if (submenu) await keyboard(page, app.locator('.lightscaper-photo-submenu > summary').filter({ hasText: new RegExp(`^${submenu}$`, 'u') }));
	if (execute) await keyboard(page, named(app, 'button', action));
}
async function choose(page, combo, value) {
	const index = await combo.locator('option').evaluateAll((options, value) => options.findIndex(option => option.value === value), value);
	expect(index).toBeGreaterThanOrEqual(0); expect(index).toBeLessThan(64); await combo.focus(); await page.keyboard.press('Home');
	for (let step = 0; step < index; step++) await page.keyboard.press('ArrowDown'); await expect(combo).toHaveValue(value);
}
async function pixels(canvas) { return canvas.evaluate(element => element.width === 2 && element.height === 2
	? [...element.getContext('2d').getImageData(0, 0, 2, 2).data] : null); }
