/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { importPhotoCatalogArchiveV3 } from '../../src/lightscaper/archive/catalog-archive-import-v3.ts';
import { normalizePhotoCatalogArchiveV3 } from '../../src/lightscaper/archive/catalog-archive-contract-v3.ts';
import { readScapeArchiveEnvelope } from '../../src/common/editor/scape-archive-envelope.ts';
import { withScapeArchiveReader } from '../../src/common/editor/scape-archive-reader.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';

test.use({ browserCoverage: false });
const ROOT = '/__photo_catalog_backup_observer.js';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAALZlWElmSUkqAAgAAAAGAA4BAgAPAAAAaAAAAA8BAgAOAAAAdwAAABIBAwABAAAAAQAAADsBAgAPAAAAhQAAAJiCAgAOAAAAlAAAAGmHBAABAAAAVgAAAAAAAAABAAOQAgAUAAAAogAAAAAAAABTb3VyY2UgY2FwdGlvbgBOYXRpdmUgY2FtZXJhAFNvdXJjZSBjcmVhdG9yAFNvdXJjZSByaWdodHMAMjAyNjoxMDowOCAxMToxMjoxMwDS1J8kAAAADElEQVQI12NgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC', 'base64');
const SHA256 = createHash('sha256').update(PNG).digest('hex');
const SAVED_QUERY = { schemaVersion: 2, kind: 'photo-catalog-query', text: 'source', filter: { kind: 'rating', value: 0 },
	sort: { field: 'capture-time', direction: 'descending' }, predicate: { kind: 'all', terms: [
		{ kind: 'text', column: 'camera-make', operator: 'contains', value: 'Native' },
		{ kind: 'number', column: 'width', minimum: 2, maximum: 2 },
		{ kind: 'not', term: { kind: 'presence', column: 'lens', value: 'known' } },
	] } };

for (const locale of ['en', 'de']) {
	test(`${locale}: File catalog backup downloads an authenticated archive without changing catalog or originals`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Full WebKit catalog Blob/OPFS custody qualification remains deferred.');
		test.setTimeout(120_000);
		await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
		const { app, copy, ids, before, requests, errors } = await setup(page, locale);
		await action(page, app, copy.photoFileMenu, copy.photoBackupTitle);
		const dialog = page.getByRole('dialog', { name: copy.photoBackupTitle, exact: true });
		const downloadPending = page.waitForEvent('download');
		await keyboard(page, dialog.locator('[data-photo-backup-save]'));
		const download = await downloadPending;
		expect(download.suggestedFilename()).toMatch(/\.liscape$/u);
		const bytes = await readFile(await download.path());
		await expect(dialog.locator('[data-photo-backup-receipt]')).toContainText(copy.photoBackupDownloadStarted.replace('{name}', download.suggestedFilename()));
		await authenticate(bytes, before);
		await keyboard(page, dialog.locator('[data-photo-backup-close]')); await expect(dialog).toHaveCount(0);
		expect(await observe(page, ids)).toEqual(before);
		await page.reload(); await expect(app).toBeVisible();
		await action(page, app, copy.photoViewMenu, copy.photoShowLibrary);
		expect(await observe(page, ids)).toEqual(before);
		expect(errors).toEqual([]); expect(requests.filter(url => /\/assets\/editor-copy-/u.test(url))).toEqual([]);
	});

	test(`${locale}: saved full metadata criteria, physical state and a stack survive the menu archive3 backup`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Full WebKit catalog Blob/OPFS custody qualification remains deferred.');
		test.setTimeout(120_000);
		await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
		const { app, copy, ids, before, requests, errors } = await setup(page, locale);
		const library = app.locator('[data-photo-library]');
		for (const [index, photo] of before.photos.entries()) {
			await library.getByRole('button').filter({ has: page.getByText(photo.fileName, { exact: true }) })
				.click(index ? { modifiers: ['Control'] } : {});
		}
		await expect(library.locator('[data-photo-id][aria-pressed="true"]')).toHaveCount(2);
		await action(page, app, copy.photoFileMenu, copy.photoStackCreate, copy.photoPhotoMenu);
		const stackDialog = page.getByRole('dialog', { name: copy.photoStackTitle, exact: true });
		await keyboard(page, named(stackDialog, 'button', copy.photoStackSave));
		await expect(stackDialog.locator('[data-stack-ack]')).toHaveText(copy.photoStackCreated);
		await keyboard(page, bodyClose(stackDialog, copy.photoCloseMetadata)); await expect(stackDialog).toHaveCount(0);
		await action(page, app, copy.photoViewMenu, copy.photoSaveCurrentFilter);
		const savedDialog = page.getByRole('dialog', { name: copy.photoSavedFiltersTitle, exact: true }), name = `${locale} archive metadata recipe`;
		await expect(named(savedDialog, 'textbox', copy.photoSavedFilterName)).toBeEnabled();
		await named(savedDialog, 'textbox', copy.photoSavedFilterName).fill(name);
		await keyboard(page, named(savedDialog, 'button', copy.photoOrganizerQueryJson));
		await named(savedDialog, 'textbox', copy.photoOrganizerQueryJson).fill(JSON.stringify(SAVED_QUERY));
		await keyboard(page, named(savedDialog, 'button', copy.photoOrganizerQueryJson));
		await keyboard(page, named(savedDialog, 'button', copy.photoSavedFilterSave));
		await expect(savedDialog.locator('[data-saved-receipt]')).toHaveText(copy.photoSavedFilterSaved);
		await keyboard(page, named(savedDialog, 'button', copy.photoSavedFilterRefreshList));
		const collectionId = await named(savedDialog, 'radio', name).inputValue();
		await keyboard(page, bodyClose(savedDialog, copy.photoCloseMetadata)); await expect(savedDialog).toHaveCount(0);
		await expect(library).toHaveAttribute('aria-busy', 'false');
		const previous = await observe(page, ids), saved = await observeSaved(page, previous.root.id, collectionId, ids[0]);
		expect(previous.photos).toEqual(before.photos); expect(saved.definition).toMatchObject({ id: collectionId, name, revision: 0, query: SAVED_QUERY });
		expect(saved.state).toMatchObject({ catalogId: previous.root.id, collectionCount: 1, revision: 1 });
		expect(saved.stack).toMatchObject({ revision: 0, photoIds: ids, coverPhotoId: ids[0] });
		await action(page, app, copy.photoFileMenu, copy.photoBackupTitle);
		const backup = page.getByRole('dialog', { name: copy.photoBackupTitle, exact: true }), pending = page.waitForEvent('download');
		await keyboard(page, named(backup, 'button', copy.photoBackupSave)); const download = await pending;
		await authenticate(await readFile(await download.path()), previous, { definitions: [saved.definition], savedState: saved.state, stacks: [saved.stack] });
		await expect(backup.locator('[data-photo-backup-receipt]')).toContainText(copy.photoBackupDownloadStarted.replace('{name}', download.suggestedFilename()));
		await keyboard(page, bodyClose(backup, copy.photoBackupClose));
		expect(await observe(page, ids)).toEqual(previous); expect(await observeSaved(page, previous.root.id, collectionId, ids[0])).toEqual(saved);
		expect(errors).toEqual([]); expect(requests.filter(url => /\/assets\/editor-copy-/u.test(url))).toEqual([]);
	});
}

test('a held picker is joined across Close and reopen, then a genuine native writer commits an authenticated backup', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'This witness requires native File System Access writable support.');
	test.setTimeout(120_000);
	// The selecting boundary returns a genuine OPFS FileSystemFileHandle. This
	// exercises the browser's native writer without automating the OS picker UI.
	await page.addInitScript(() => {
		window.backupPickerObservations = []; window.holdBackupPicker = true;
		Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value(request) {
			window.backupPickerObservations.push({ request, activation: navigator.userActivation.isActive });
			return new Promise(resolve => { window.releaseBackupPicker = async () => {
				const directory = await navigator.storage.getDirectory();
				resolve(await directory.getFileHandle('Native-backup.liscape', { create: true }));
			}; if (!window.holdBackupPicker) void window.releaseBackupPicker(); });
		} });
	});
	const { app, copy, ids, before, requests, errors } = await setup(page, 'en');
	await action(page, app, copy.photoFileMenu, copy.photoBackupTitle);
	let dialog = page.getByRole('dialog', { name: copy.photoBackupTitle, exact: true });
	await keyboard(page, dialog.locator('[data-photo-backup-save]'));
	await expect.poll(() => page.evaluate(() => window.backupPickerObservations.length)).toBe(1);
	await keyboard(page, dialog.locator('[data-photo-backup-close]')); await expect(dialog).toHaveCount(0);
	await action(page, app, copy.photoFileMenu, copy.photoBackupTitle);
	dialog = page.getByRole('dialog', { name: copy.photoBackupTitle, exact: true });
	await expect(dialog.locator('[data-photo-backup-save]')).toBeDisabled();
	await page.evaluate(async () => { await window.releaseBackupPicker(); });
	await expect(dialog.locator('[data-photo-backup-save]')).toBeEnabled();
	await page.evaluate(() => { window.holdBackupPicker = false; });
	await keyboard(page, dialog.locator('[data-photo-backup-save]'));
	await expect(dialog.locator('[data-photo-backup-receipt]')).toContainText(copy.photoBackupSaved.replace('{name}', 'Native-backup.liscape'));
	const saved = await page.evaluate(async () => {
		const directory = await navigator.storage.getDirectory();
		const file = await (await directory.getFileHandle('Native-backup.liscape')).getFile();
		return { bytes: Array.from(new Uint8Array(await file.arrayBuffer())), observations: window.backupPickerObservations };
	});
	expect(saved.observations).toHaveLength(2);
	for (const observation of saved.observations) {
		expect(observation.activation).toBe(true);
		expect(observation.request.suggestedName).toMatch(/\.liscape$/u);
		expect(observation.request.types).toEqual([{ description: copy.photoBackupFileType,
			accept: { 'application/vnd.soundscaper.scape+zip': ['.liscape'] } }]);
	}
	await authenticate(new Uint8Array(saved.bytes), before);
	expect(await observe(page, ids)).toEqual(before); expect(errors).toEqual([]);
	expect(requests.filter(url => /\/assets\/editor-copy-/u.test(url))).toEqual([]);
});

async function authenticate(bytes, previous, { definitions = [], savedState = null, stacks = [] } = {}) {
	const blob = new Blob([bytes]);
	const document = await withScapeArchiveReader(blob, undefined, async entries =>
		normalizePhotoCatalogArchiveV3(JSON.parse((await readScapeArchiveEnvelope(entries)).projectText)));
	expect(document.schemaVersion).toBe(3); expect(document.stackCount).toBe(stacks.length);
	expect(document.savedCollectionState).toEqual(savedState);
	expect(document.savedCollectionPacks.reduce((count, pack) => count + pack.collectionCount, 0)).toBe(definitions.length);
	const records = [], restoredStacks = [], restoredDefinitions = []; let published = false;
	// The generic stage is an authentication witness, not a durable catalog restore.
	const catalog = await importPhotoCatalogArchiveV3(blob, async (root, state) => {
		expect(root).toEqual(previous.root); expect(state).toEqual(savedState); return {
		async writePhoto(photo, chunks) {
			const parts = []; for await (const chunk of chunks) parts.push(Buffer.from(chunk));
			records.push({ photo, bytes: Buffer.concat(parts) });
		}, async writeStack(stack) { restoredStacks.push(stack); }, async writeSavedCollection(definition) { restoredDefinitions.push(definition); },
		async publish() { published = true; }, async rollback() { records.length = 0; restoredStacks.length = 0; restoredDefinitions.length = 0; },
	}; });
	expect(published).toBe(true); expect(catalog).toEqual(previous.root); expect(records).toHaveLength(previous.photos.length);
	expect(restoredStacks).toEqual(stacks); expect(restoredDefinitions).toEqual(definitions);
	for (const record of records) {
		const source = previous.photos.find(photo => photo.id === record.photo.id); expect(source).toBeDefined();
		expect(record.photo).toMatchObject({ revision: source.revision, rating: source.rating, flag: source.flag, colorLabel: source.colorLabel });
		expect(record.photo.metadata).toEqual(source.metadata); expect(record.photo.extractedMetadata).toEqual(source.extractedMetadata);
		expect(record.photo.original).toMatchObject({ id: source.originalId, name: source.originalName,
			storageKey: source.storageKey, contentSha256: SHA256, byteLength: PNG.length });
		expect(record.bytes.equals(PNG)).toBe(true); expect(createHash('sha256').update(record.bytes).digest('hex')).toBe(SHA256);
	}
}
async function setup(page, locale) {
	const requests = [], errors = []; page.on('request', request => { requests.push(request.url()); });
	page.on('pageerror', error => { errors.push(error.message); });
	const bundle = await build({ stdin: { contents: `export { readResidentPhotoLibraryV1 as observe } from "./tests/helpers/lightscaper-photo-library-ui-fixture.ts";
		export { bundledLightscaperEditorCopyForLocale as copyForLocale } from "./src/common/i18n/lightscaper-editor-copy.ts";
		import { PhotoCatalogRepositoryV1 } from "./src/lightscaper/catalog/repository.ts";
		export async function observeSaved(catalogId, collectionId, photoId) {
			const catalog = new PhotoCatalogRepositoryV1({ indexedDB, verifyOriginal: async () => undefined });
			try {
				const snapshot = await catalog.readSmartCollectionSnapshotV1(catalogId, collectionId);
				const context = await catalog.readSmartCollectionArchiveContextV1(catalogId);
				const members = await catalog.readStackMembershipPage(catalogId, { photoIds: [photoId] });
				if (members.items.length !== 1 || !snapshot.definition || !context.state) throw new Error('Expected one menu-authored saved recipe and stack.');
				const stack = await catalog.loadStack(catalogId, members.items[0].stackId);
				if (!stack || stack.photoIds.length !== 2) throw new Error('Expected one two-photo stack.');
				return { definition: snapshot.definition, state: context.state, stack };
			} finally { await catalog.close(); }
		}`,
		resolveDir: fileURLToPath(new URL('../../', import.meta.url)) }, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
	await page.route(`**${ROOT}`, async route => { await route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }); });
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`);
	const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
	const copy = await page.evaluate(async ({ locale, root }) => (await import(new URL(root, location.href).href)).copyForLocale(locale), { locale, root: ROOT });
	await expect(page.getByRole('dialog')).toHaveCount(0); await expect(app.locator('[data-photo-library]')).toHaveCount(0);
	await action(page, app, copy.photoFileMenu, copy.photoImportPhotos);
	const importer = page.getByRole('dialog', { name: copy.photoImportPhotos, exact: true });
	await importer.locator('input[type=file]').setInputFiles(['東京 é.PNG', 'Second.png'].map(name => ({ name, mimeType: 'image/png', buffer: PNG })));
	await keyboard(page, importer.locator('button[type=submit]')); await expect(importer).toHaveCount(0);
	const library = app.locator('[data-photo-library]'); await expect(library.locator('[data-photo-count]')).toHaveAttribute('data-photo-count', '2');
	await expect(library).toHaveAttribute('aria-busy', 'false');
	const ids = await library.locator('[data-photo-id]').evaluateAll(nodes => nodes.map(node => node.dataset.photoId));
	return { app, copy, ids, before: await observe(page, ids), requests, errors };
}
async function observe(page, ids) { return page.evaluate(async ({ ids, root }) => (await import(new URL(root, location.href).href)).observe(ids), { ids, root: ROOT }); }
async function observeSaved(page, catalogId, collectionId, photoId) {
	return page.evaluate(async input => (await import(new URL(input.root, location.href).href)).observeSaved(input.catalogId, input.collectionId, input.photoId),
		{ root: ROOT, catalogId, collectionId, photoId });
}
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
function bodyClose(scope, name) { return named(scope, 'button', name).filter({ hasText: new RegExp(`^${name}$`, 'u') }); }
async function keyboard(page, locator) { await expect(locator).toBeEnabled(); await locator.focus(); await expect(locator).toBeFocused(); await page.keyboard.press('Enter'); }
async function action(page, app, menu, name, submenu) {
	await keyboard(page, app.locator('nav > details > summary').filter({ hasText: new RegExp(`^${menu.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'u') }));
	if (submenu) await keyboard(page, app.locator('.lightscaper-photo-submenu > summary').filter({ hasText: submenu }));
	await keyboard(page, app.getByRole('button', { name, exact: true }));
}
