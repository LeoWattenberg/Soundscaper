/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { lightscaperRestoreCopy } from '../../src/common/i18n/lightscaper-restore-copy.ts';
import { importPhotoCatalogArchiveV3 } from '../../src/lightscaper/archive/catalog-archive-import-v3.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';

test.use({ browserCoverage: false });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAALZlWElmSUkqAAgAAAAGAA4BAgAPAAAAaAAAAA8BAgAOAAAAdwAAABIBAwABAAAAAQAAADsBAgAPAAAAhQAAAJiCAgAOAAAAlAAAAGmHBAABAAAAVgAAAAAAAAABAAOQAgAUAAAAogAAAAAAAABTb3VyY2UgY2FwdGlvbgBOYXRpdmUgY2FtZXJhAFNvdXJjZSBjcmVhdG9yAFNvdXJjZSByaWdodHMAMjAyNjoxMDowOCAxMToxMjoxMwDS1J8kAAAADElEQVQI12NgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC', 'base64');
const QUERY = { schemaVersion: 2, kind: 'photo-catalog-query', text: 'source', filter: { kind: 'rating', value: 0 },
	sort: { field: 'capture-time', direction: 'descending' }, predicate: { kind: 'all', terms: [
		{ kind: 'number', column: 'width', minimum: 2, maximum: 2 },
		{ kind: 'not', term: { kind: 'presence', column: 'lens', value: 'known' } },
	] } };

for (const locale of ['en', 'de']) {
	test(`${locale}: File restore stays opt-in and a native empty backup reopens after reload`, async ({ page }) => {
		test.setTimeout(120_000);
		const { app, copy, restoreCopy, errors } = await setup(page, locale);
		await expect(page.getByRole('dialog')).toHaveCount(0); await expect(app.locator('[data-photo-library]')).toHaveCount(0);
		await expect(app.locator('canvas')).toHaveCount(0);
		await action(page, app, copy.photoFileMenu, restoreCopy.title);
		let dialog = named(page, 'dialog', restoreCopy.title);
		await expect(named(dialog, 'button', restoreCopy.restore)).toBeDisabled();
		await keyboard(page, bodyClose(dialog, restoreCopy.close)); await expect(dialog).toHaveCount(0);
		await expect(app.locator('[data-photo-library]')).toHaveCount(0);
		const source = await backup(page, app, copy), original = await decode(source.buffer);
		expect(original.photos).toEqual([]); expect(original.savedState).toBeNull();
		await restore(page, app, copy, restoreCopy, source);
		dialog = named(page, 'dialog', restoreCopy.title);
		await expect(dialog.locator('[data-photo-restore-receipt]')).toContainText(restoreCopy.acknowledged.replace('{name}', original.root.name));
		await keyboard(page, bodyClose(dialog, restoreCopy.close));
		await expect(app.locator('[data-photo-library]')).toHaveCount(0);
		await page.reload(); await expect(app).toBeVisible(); await expect(app.locator('[data-photo-library]')).toHaveCount(0);
		await action(page, app, copy.photoViewMenu, copy.photoShowLibrary);
		await expect(app.locator('[data-photo-count]')).toHaveAttribute('data-photo-count', '0');
		expect(await decode((await backup(page, app, copy)).buffer)).toEqual(original); expect(errors).toEqual([]);
	});

	test(`${locale}: menu restore preserves full saved criteria, ordered stack and originals across a same-ID session epoch`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Full WebKit catalog Blob/OPFS custody qualification remains deferred.');
		test.setTimeout(120_000);
		const { app, copy, restoreCopy, errors } = await setup(page, locale);
		await action(page, app, copy.photoFileMenu, copy.photoImportPhotos);
		const importer = named(page, 'dialog', copy.photoImportPhotos);
		await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles(['First.png', 'Second.png'].map(name => ({ name, mimeType: 'image/png', buffer: PNG })));
		await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
		const library = app.locator('[data-photo-library]'); await expect(library.locator('[data-photo-count]')).toHaveAttribute('data-photo-count', '2');
		await expect(library).toHaveAttribute('aria-busy', 'false');
		for (const [index, name] of ['First.png', 'Second.png'].entries()) await photo(page, library, name).click(index ? { modifiers: ['Control'] } : {});
		await action(page, app, copy.photoFileMenu, copy.photoStackCreate, copy.photoPhotoMenu);
		const stack = named(page, 'dialog', copy.photoStackTitle); await keyboard(page, named(stack, 'button', copy.photoStackSave));
		await expect(stack.locator('[data-stack-ack]')).toHaveText(copy.photoStackCreated); await keyboard(page, bodyClose(stack, copy.photoCloseMetadata));
		await action(page, app, copy.photoViewMenu, copy.photoSaveCurrentFilter);
		const saved = named(page, 'dialog', copy.photoSavedFiltersTitle), savedName = `${locale} full restored recipe`;
		await named(saved, 'textbox', copy.photoSavedFilterName).fill(savedName);
		await keyboard(page, named(saved, 'button', copy.photoOrganizerQueryJson));
		await named(saved, 'textbox', copy.photoOrganizerQueryJson).fill(JSON.stringify(QUERY));
		await keyboard(page, named(saved, 'button', copy.photoOrganizerQueryJson)); await keyboard(page, named(saved, 'button', copy.photoSavedFilterSave));
		await expect(saved.locator('[data-saved-receipt]')).toHaveText(copy.photoSavedFilterSaved); await keyboard(page, bodyClose(saved, copy.photoCloseMetadata));
		const source = await backup(page, app, copy), original = await decode(source.buffer);
		expect(original.photos).toHaveLength(2); expect(original.stacks).toHaveLength(1); expect(original.saved).toHaveLength(1);
		expect(original.saved[0]).toMatchObject({ name: savedName, query: QUERY }); expect(original.savedState).toMatchObject({ collectionCount: 1, revision: 1 });
		for (const item of original.photos) expect(item.original.equals(PNG)).toBe(true);
		await photo(page, library, 'First.png').click();
		await action(page, app, copy.photoFileMenu, copy.photoRateStars.replace('{count}', '5'), copy.photoPhotoMenu);
		await expect(photo(page, library, 'First.png')).toContainText(`${copy.photoRating}: 5`);
		await restore(page, app, copy, restoreCopy, source);
		const dialog = named(page, 'dialog', restoreCopy.title);
		await expect(dialog.locator('[data-photo-restore-receipt]')).toContainText(restoreCopy.acknowledged.replace('{name}', original.root.name));
		await keyboard(page, bodyClose(dialog, restoreCopy.close)); await expect(library).toHaveCount(0);
		await action(page, app, copy.photoViewMenu, copy.photoShowLibrary); await expect(library.locator('[data-photo-count]')).toHaveAttribute('data-photo-count', '2');
		await expect(photo(page, library, 'First.png')).toContainText(`${copy.photoRating}: 0`);
		await expect(library.locator('[data-photo-id][aria-pressed="true"]')).toHaveCount(0);
		await page.reload(); await expect(app).toBeVisible(); await expect(library).toHaveCount(0);
		await action(page, app, copy.photoViewMenu, copy.photoShowLibrary);
		await expect(library.locator('[data-photo-count]')).toHaveAttribute('data-photo-count', '2');
		// This rebackup reads the selected durable catalog, physical saved state,
		// full recipes, ordered stack and stored original bodies after real reload.
		expect(await decode((await backup(page, app, copy)).buffer)).toEqual(original); expect(errors).toEqual([]);
	});
}

async function setup(page, locale) {
	const errors = []; page.on('pageerror', error => { errors.push(error.message); });
	await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`); const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
	return { app, copy: bundledLightscaperEditorCopyForLocale(locale), restoreCopy: lightscaperRestoreCopy(locale), errors };
}
async function backup(page, app, copy) {
	await action(page, app, copy.photoFileMenu, copy.photoBackupTitle);
	const dialog = named(page, 'dialog', copy.photoBackupTitle), pending = page.waitForEvent('download');
	await keyboard(page, named(dialog, 'button', copy.photoBackupSave)); const download = await pending;
	const source = { name: download.suggestedFilename(), mimeType: 'application/vnd.soundscaper.scape+zip', buffer: await readFile(await download.path()) };
	await expect(dialog.locator('[data-photo-backup-receipt]')).toContainText(copy.photoBackupDownloadStarted.replace('{name}', source.name));
	await keyboard(page, bodyClose(dialog, copy.photoBackupClose)); return source;
}
async function restore(page, app, copy, restoreCopy, source) {
	await action(page, app, copy.photoFileMenu, restoreCopy.title);
	const dialog = named(page, 'dialog', restoreCopy.title);
	await dialog.getByLabel(restoreCopy.file, { exact: true }).setInputFiles(source);
	await keyboard(page, named(dialog, 'button', restoreCopy.restore));
	await expect(dialog.locator('[data-photo-restore-receipt]')).toBeVisible(); await expect(dialog.getByRole('alert')).toHaveCount(0);
}
async function decode(bytes) {
	const result = { root: null, savedState: null, photos: [], stacks: [], saved: [] };
	await importPhotoCatalogArchiveV3(new Blob([bytes]), async (root, state) => { result.root = root; result.savedState = state; return {
		async writePhoto(document, chunks) { const parts = []; for await (const chunk of chunks) parts.push(Buffer.from(chunk)); result.photos.push({ document, original: Buffer.concat(parts) }); },
		async writeStack(stack) { result.stacks.push(stack); }, async writeSavedCollection(definition) { result.saved.push(definition); },
		async publish() {}, async rollback() { throw new Error('Backup authentication rolled back.'); },
	}; });
	result.photos.sort((a, b) => a.document.id.localeCompare(b.document.id)); result.stacks.sort((a, b) => a.id.localeCompare(b.id)); result.saved.sort((a, b) => a.id.localeCompare(b.id));
	return result;
}
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
function photo(page, library, name) { return library.getByRole('button').filter({ has: page.getByText(name, { exact: true }) }); }
function bodyClose(scope, name) { return named(scope, 'button', name).filter({ hasText: new RegExp(`^${name}$`, 'u') }); }
async function keyboard(page, locator) { await expect(locator).toBeEnabled(); await locator.focus(); await expect(locator).toBeFocused(); await page.keyboard.press('Enter'); }
async function action(page, app, menu, name, submenu) {
	await keyboard(page, app.locator('nav > details > summary').filter({ hasText: new RegExp(`^${menu.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'u') }));
	if (submenu) await keyboard(page, app.locator('.lightscaper-photo-submenu > summary').filter({ hasText: submenu }));
	await keyboard(page, named(app, 'button', name));
}
