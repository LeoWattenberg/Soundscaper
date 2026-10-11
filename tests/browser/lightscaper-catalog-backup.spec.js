/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { sourceMapDirectoryFor } from '../../scripts/lib/build-source-map-relocation.mjs';
import { importPhotoCatalogArchiveV5 } from '../../src/lightscaper/archive/catalog-archive-import-v5.ts';
import { normalizePhotoCatalogArchiveV5 } from '../../src/lightscaper/archive/catalog-archive-contract-v5.ts';
import { readScapeArchiveEnvelope } from '../../src/common/editor/scape-archive-envelope.ts';
import { withScapeArchiveReader } from '../../src/common/editor/scape-archive-reader.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { installNativeOpfsWorkerCompanion, assertNativeOpfsWorkerExecution } from './helpers/native-opfs-worker-companion.ts';

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
		expect(errors).toEqual([]); expect(await fullEditorCopyGroupRequests(requests)).toEqual([]);
	});

	test(`${locale}: saved full metadata criteria, physical state and a stack survive the menu archive5 backup`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Full WebKit catalog Blob/OPFS custody qualification remains deferred.');
		test.setTimeout(120_000);
		await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
		const { app, copy, ids, before, requests, errors } = await setup(page, locale);
		const library = app.locator('[data-photo-library]');
		for (const [index, item] of before.photos.entries()) {
			const card = library.getByRole('button').filter({ has: page.getByText(item.photo.metadata.fileName, { exact: true }) });
			if (index) { await card.focus(); await expect(card).toBeFocused(); await page.keyboard.press('Control+Space'); }
			else await keyboard(page, card);
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
		expect(errors).toEqual([]); expect(await fullEditorCopyGroupRequests(requests)).toEqual([]);
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
	expect(await fullEditorCopyGroupRequests(requests)).toEqual([]);
});

/** The editor-copy group also contains shared effect labels and Light copy.
 * Authenticate its requested chunks before identifying full catalog owners. */
async function fullEditorCopyGroupRequests(requests) {
	const site = browserProductSiteForBuild('lightscaper');
	const directory = resolve(fileURLToPath(new URL('../../', import.meta.url)), site.outputDirectory);
	const metadata = JSON.parse(await readFile(resolve(directory, '.browser-product-build.json'), 'utf8'));
	expect(metadata.productId).toBe('lightscaper'); expect(metadata.origin).toBe(site.origin);
	const forbidden = ['src/common/i18n/catalogs.js', 'src/common/i18n/editor-copy-inventory.ts', 'src/common/i18n/runtime.js'];
	const matches = [];
	for (const request of new Set(requests)) {
		const url = new URL(request);
		if (url.origin !== site.origin || !/^\/assets\/editor-copy-[^/]+\.js$/u.test(url.pathname)) continue;
		const asset = url.pathname.slice(1), mapName = `${basename(asset)}.map`;
		const bytes = await readFile(resolve(directory, asset));
		const mapBytes = await readFile(resolve(sourceMapDirectoryFor(directory), mapName));
		for (const [data, pin] of [[bytes, metadata.files[asset]], [mapBytes, metadata.sourceMaps[mapName]]]) {
			expect(pin).toBeDefined(); expect(data.byteLength).toBe(pin.byteLength);
			expect(createHash('sha256').update(data).digest('hex')).toBe(pin.sha256);
		}
		const map = JSON.parse(mapBytes.toString('utf8'));
		expect(basename(map.file)).toBe(basename(asset)); expect(Array.isArray(map.sources)).toBe(true);
		for (const source of map.sources) {
			expect(typeof source).toBe('string');
			const path = (source.startsWith('file:') ? fileURLToPath(source) : source).replaceAll('\\', '/');
			if (forbidden.some(owner => path.endsWith(`/${owner}`))) matches.push({ request, source });
		}
	}
	return matches;
}

async function authenticate(bytes, previous, { definitions = [], savedState = null, stacks = [] } = {}) {
	const blob = new Blob([bytes]);
	const document = await withScapeArchiveReader(blob, undefined, async entries =>
		normalizePhotoCatalogArchiveV5(JSON.parse((await readScapeArchiveEnvelope(entries)).projectText)));
	expect(document.schemaVersion).toBe(5); expect(document.lutResources).toEqual([]); expect(document.stackCount).toBe(stacks.length);
	expect(document.savedCollectionState).toEqual(savedState); expect(document.developPresetPack).toBeNull();
	expect(document.savedCollectionPacks.reduce((count, pack) => count + pack.collectionCount, 0)).toBe(definitions.length);
	const records = [], restoredStacks = [], restoredDefinitions = []; let published = false;
	// The generic stage is an authentication witness, not a durable catalog restore.
	const catalog = await importPhotoCatalogArchiveV5(blob, async (root, state, presetHeader, declaredLuts) => {
		expect(declaredLuts).toEqual([]); expect(presetHeader).toBeNull(); expect(root).toEqual(previous.root); expect(state).toEqual(savedState); return {
		async writePhoto(photo, chunks) {
			const parts = []; for await (const chunk of chunks) parts.push(Buffer.from(chunk));
			records.push({ photo, bytes: Buffer.concat(parts) });
		}, async writeStack(stack) { restoredStacks.push(stack); }, async writeSavedCollection(definition) { restoredDefinitions.push(definition); },
		async writeDevelopPresets() { throw new Error('Expected absent Develop preset state.'); },
		async writeLut() { throw new Error('Numeric-only backup must not contain LUT resources.'); },
		async publish() { published = true; }, async rollback() { records.length = 0; restoredStacks.length = 0; restoredDefinitions.length = 0; },
	}; });
	expect(published).toBe(true); expect(catalog).toEqual(previous.root); expect(records).toHaveLength(previous.photos.length);
	expect(restoredStacks).toEqual(stacks); expect(restoredDefinitions).toEqual(definitions);
	for (const record of records) {
		const observed = previous.photos.find(item => item.photo.id === record.photo.id); expect(observed).toBeDefined();
		const source = observed.photo; expect(record.photo).toEqual(source); assertNumericPhoto(record.photo);
		expect(record.photo).toMatchObject({ revision: source.revision, rating: source.rating, flag: source.flag, colorLabel: source.colorLabel });
		expect(record.photo.metadata).toEqual(source.metadata); expect(record.photo.extractedMetadata).toEqual(source.extractedMetadata);
		expect(record.photo.original).toMatchObject({ id: source.original.id, name: source.original.name,
			storageKey: source.original.storageKey, contentSha256: SHA256, byteLength: PNG.length });
		expect(record.bytes.equals(PNG)).toBe(true); expect(createHash('sha256').update(record.bytes).digest('hex')).toBe(SHA256);
	}
}
async function setup(page, locale) {
	await installNativeOpfsWorkerCompanion(page);
	const requests = [], errors = []; page.on('request', request => { requests.push(request.url()); });
	page.on('pageerror', error => { errors.push(error.message); });
	const bundle = await build({ stdin: { contents: `export { readResidentPhotoLibraryCurrent as observe } from "./tests/helpers/lightscaper-current-app-fixture.tsx";
		export { readCurrentCatalogCompanionsV1 as companions } from "./tests/helpers/lightscaper-current-catalog-companions-fixture.ts";
		export { bundledLightscaperEditorCopyForLocale as copyForLocale } from "./src/common/i18n/lightscaper-editor-copy.ts";`,
		resolveDir: fileURLToPath(new URL('../../', import.meta.url)) }, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'], loader: { '.woff2': 'dataurl' } });
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
	const before = await observe(page, ids); expect(before.namespace).toBeNull();
	for (const item of before.photos) { assertNumericPhoto(item.photo); expect(item.bytes).toEqual([...PNG]); }
	return { app, copy, ids, before, requests, errors };
}
async function observe(page, ids) { const result = await page.evaluate(async ({ ids, root }) => (await import(new URL(root, location.href).href))
	.observe(ids, indexedDB, () => globalThis.__assertNativeOpfsWorkerExecution()), { ids, root: ROOT });
	await assertNativeOpfsWorkerExecution(page); return result; }
async function observeSaved(page, catalogId, collectionId, photoId) {
	return page.evaluate(async input => {
		const observed = await (await import(new URL(input.root, location.href).href))
			.companions(input.ids, indexedDB, () => globalThis.__assertNativeOpfsWorkerExecution());
		if (observed.root.id !== input.catalogId || observed.saved.length !== 1 || observed.stacks.length !== 1) throw Error('Expected one selected saved recipe and stack.');
		const definition = observed.saved.find(item => item.id === input.collectionId), stack = observed.stacks.find(item => item.photoIds.includes(input.photoId));
		if (!definition || !observed.savedState || !stack || stack.photoIds.length !== 2) throw Error('Expected complete menu-authored saved state and two-photo stack.');
		return { definition, state: observed.savedState, stack };
	}, { root: ROOT, catalogId, collectionId, photoId, ids: await page.locator('[data-photo-library] [data-photo-id]').evaluateAll(nodes => nodes.map(node => node.dataset.photoId)) });
}
function assertNumericPhoto(photo) {
	expect(photo.schemaVersion).toBe(1);
	for (const version of photo.versions) {
		expect(version.develop.processVersion).toBe(1);
		if (version.workspace) { expect(version.workspace.schemaVersion).toBe(1);
			for (const item of [...version.workspace.entries, ...version.workspace.snapshots]) expect(item.develop.processVersion).toBe(1); }
	}
}
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
function bodyClose(scope, name) { return named(scope, 'button', name).filter({ hasText: new RegExp(`^${name}$`, 'u') }); }
async function keyboard(page, locator) { await expect(locator).toBeEnabled(); await locator.focus(); await expect(locator).toBeFocused(); await page.keyboard.press('Enter'); }
async function action(page, app, menu, name, submenu) {
	await keyboard(page, app.locator('nav > details > summary').filter({ hasText: new RegExp(`^${menu.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'u') }));
	if (submenu) await keyboard(page, app.locator('.lightscaper-photo-submenu > summary').filter({ hasText: submenu }));
	await keyboard(page, app.getByRole('button', { name, exact: true }));
}
