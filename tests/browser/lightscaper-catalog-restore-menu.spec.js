/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { lightscaperRestoreCopy } from '../../src/common/i18n/lightscaper-restore-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopSettingsCopy } from '../../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { importPhotoCatalogArchiveV5 } from '../../src/lightscaper/archive/catalog-archive-import-v5.ts';
import { normalizePhotoCatalogArchiveV5 } from '../../src/lightscaper/archive/catalog-archive-contract-v5.ts';
import { readScapeArchiveEnvelope } from '../../src/common/editor/scape-archive-envelope.ts';
import { withScapeArchiveReader } from '../../src/common/editor/scape-archive-reader.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 } from '../../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { PHOTO_LIBRARY_DEFAULT_SETTINGS_DATABASE_NAME_V2 } from '../../src/lightscaper/storage/photo-library-location-v2.ts';
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
		expect(original.presetHeader).toBeNull(); expect(original.presets).toBeNull();
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
		await keyboard(page, photo(page, library, 'First.png'));
		await photo(page, library, 'Second.png').focus(); await page.keyboard.press('Control+Space');
		await expect(photo(page, library, 'First.png')).toHaveAttribute('aria-pressed', 'true');
		await expect(photo(page, library, 'Second.png')).toHaveAttribute('aria-pressed', 'true');
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
		expect(original.presetHeader).toBeNull(); expect(original.presets).toBeNull();
		expect(original.saved[0]).toMatchObject({ name: savedName, query: QUERY }); expect(original.savedState).toMatchObject({ collectionCount: 1, revision: 1 });
		for (const item of original.photos) expect(item.original.equals(PNG)).toBe(true);
		await keyboard(page, photo(page, library, 'First.png'));
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

	test(`${locale}: full and partial presets survive same-ID restore and reload, then partial apply preserves unselected settings and originals`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Full WebKit catalog Blob/OPFS custody qualification remains deferred.');
		test.setTimeout(120_000);
		const { app, copy, restoreCopy, errors } = await setup(page, locale);
		const library = await importPhotos(page, app, copy, ['Source.png', 'Target one.png', 'Target two.png']);
		const develop = developTools(page, app, library, copy, locale), messages = develop.messages;
		await develop.open('Target one.png'); await develop.add('tone-ladder-v1', 'videoEffectParamExposure', '1'); await develop.save(); await develop.close();
		await develop.open('Source.png'); await develop.add('white-balance-v1', 'videoEffectParamTemperature', '0.25');
		await develop.add('tone-ladder-v1', 'videoEffectParamExposure', '0.5'); await develop.save();
		let options = await develop.presets();
		await develop.savePreset(options, 'Full look', false); await develop.savePreset(options, 'WB only', true);
		await develop.closeOptions(options); await develop.close();
		const source = await backup(page, app, copy), original = await decode(source.buffer);
		expect(original.presetHeader).toMatchObject({ revision: 2, presetCount: 2 });
		expect(original.presets).toMatchObject({ catalogId: original.root.id, revision: 2 });
		const full = original.presets.presets.find(preset => preset.identity.name === 'Full look');
		const partial = original.presets.presets.find(preset => preset.identity.name === 'WB only');
		expect(full.settings.selection).toEqual({ effectTypes: 'all', geometry: true, localAdjustments: true });
		expect(partial.settings.selection).toEqual({ effectTypes: ['white-balance-v1'], geometry: false, localAdjustments: false });
		expect(full.settings.develop.effects.map(effect => effect.type)).toEqual(['white-balance-v1', 'tone-ladder-v1']);
		expect(partial.settings.develop.effects).toHaveLength(1); expect(partial.settings.develop.effects[0].params.temperature).toBe(0.25);
		expect(full.settings.develop.effects[1].params.exposure).toBe(0.5); expect(original.photos).toHaveLength(3);
		for (const item of original.photos) expect(item.original.equals(PNG)).toBe(true);
		const target = original.photos.find(item => item.document.metadata.fileName === 'Target one.png');
		expect(activeVersion(target.document).develop.effects[0].params.exposure).toBe(1);
		// Make the old selected namespace observably different before restoring the archive.
		await develop.open('Source.png'); options = await develop.presets();
		await develop.choose(options, 'Full look', false); await keyboard(page, named(options, 'button', messages.deletePreset)); await develop.settled();
		await develop.choose(options, 'WB only', true); await named(options, 'textbox', messages.presetName).fill('Old namespace WB');
		await keyboard(page, named(options, 'button', messages.renamePreset)); await develop.settled();
		await expect(named(options, 'combobox', messages.choosePreset)).toContainText('Old namespace WB');
		await develop.closeOptions(options); await develop.close();
		await restoreAndReload(page, app, library, copy, restoreCopy, source, 3);
		await develop.open('Target one.png'); options = await develop.presets();
		await expect(named(options, 'combobox', messages.choosePreset).getByRole('option')).toHaveText([
			messages.noPreset, ...original.presets.presets.map(preset => `${preset.identity.name} (${preset === full ? messages.full : messages.partial})`),
		]);
		await develop.closeOptions(options); await develop.close();
		// A real second backup authenticates all recipes, full photo documents and stored bytes after reload.
		expect(await decode((await backup(page, app, copy)).buffer)).toEqual(original);
		await develop.open('Target one.png'); options = await develop.presets(); await develop.choose(options, 'WB only', true);
		await keyboard(page, named(options, 'button', messages.applyPreset)); await develop.settled();
		await expect(develop.numberInput('videoEffectParamTemperature')).toHaveValue('0.25');
		await expect(develop.numberInput('videoEffectParamExposure')).toHaveValue('1');
		await develop.closeOptions(options); await develop.close();
		const applied = await decode((await backup(page, app, copy)).buffer);
		expect(applied.presets).toEqual(original.presets); expect(applied.presetHeader).toEqual(original.presetHeader);
		for (const before of original.photos) {
			const after = applied.photos.find(item => item.document.id === before.document.id); expect(after.original).toEqual(before.original);
			if (before !== target) { expect(after.document).toEqual(before.document); continue; }
			const { revision, versions, ...immutable } = before.document, { revision: nextRevision, versions: nextVersions, ...nextImmutable } = after.document;
			expect(nextImmutable).toEqual(immutable); expect(nextRevision).toBe(revision + 1); expect(nextVersions).toHaveLength(versions.length);
			const version = activeVersion(after.document), prior = activeVersion(before.document);
			expect(version.id).toBe(prior.id); expect(version.workspace.cursor).toBe(prior.workspace.cursor + 1);
			expect(version.workspace.entries.slice(0, -1)).toEqual(prior.workspace.entries);
			const { develop: priorDevelop, workspace: priorWorkspace, ...identity } = prior;
			const { develop: nextDevelop, workspace: nextWorkspace, ...nextIdentity } = version;
			expect(nextIdentity).toEqual(identity);
			expect(nextWorkspace.snapshots).toEqual(priorWorkspace.snapshots);
			expect(nextVersions.filter(item => item.id !== prior.id)).toEqual(versions.filter(item => item.id !== prior.id));
			for (const key of ['processVersion', 'geometry', 'masks', 'maskBindings']) expect(nextDevelop[key], key).toEqual(priorDevelop[key]);
			expect(nextWorkspace.entries[nextWorkspace.cursor].develop).toEqual(nextDevelop);
			expect(version.develop.effects.find(effect => effect.type === 'white-balance-v1').params.temperature).toBe(0.25);
			expect(version.develop.effects.find(effect => effect.type === 'tone-ladder-v1')).toEqual(prior.develop.effects[0]);
		}
		expect(errors).toEqual([]);
	});

	test(`${locale}: deleting the final preset preserves a positive empty revision through restore and reload`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Full WebKit catalog Blob/OPFS custody qualification remains deferred.');
		test.setTimeout(120_000);
		const { app, copy, restoreCopy, errors } = await setup(page, locale);
		const library = await importPhotos(page, app, copy, ['Empty presets.png']), develop = developTools(page, app, library, copy, locale);
		await develop.open('Empty presets.png'); let options = await develop.presets();
		await develop.savePreset(options, 'Temporary', false); await develop.choose(options, 'Temporary', false);
		await keyboard(page, named(options, 'button', develop.messages.deletePreset)); await develop.settled();
		await expect(named(options, 'combobox', develop.messages.choosePreset).getByRole('option')).toHaveText([develop.messages.noPreset]);
		await develop.closeOptions(options); await develop.close();
		const source = await backup(page, app, copy), original = await decode(source.buffer);
		expect(original.presetHeader).toMatchObject({ revision: 2, presetCount: 0 });
		expect(original.presets).toEqual({ schemaVersion: 2, kind: 'photo-develop-presets', catalogId: original.root.id, revision: 2, presets: [] });
		await develop.open('Empty presets.png'); options = await develop.presets(); await develop.savePreset(options, 'Old namespace preset', false);
		await develop.closeOptions(options); await develop.close();
		await restoreAndReload(page, app, library, copy, restoreCopy, source, 1);
		await develop.open('Empty presets.png'); options = await develop.presets();
		await expect(named(options, 'combobox', develop.messages.choosePreset).getByRole('option')).toHaveText([develop.messages.noPreset]);
		await develop.closeOptions(options); await develop.close();
		expect(await decode((await backup(page, app, copy)).buffer)).toEqual(original); expect(errors).toEqual([]);
	});

	test(`${locale}: keyboard Close and Cancel join held native publication and retain its completed acknowledgement`, async ({ page }) => {
		test.setTimeout(120_000);
		await installPublicationBarrier(page);
		const { app, copy, restoreCopy, errors } = await setup(page, locale);
		const source = await backup(page, app, copy), original = await decode(source.buffer);
		expect(original.presetHeader).toBeNull(); expect(original.presets).toBeNull();
		try {
			await page.evaluate(() => globalThis.__lightscaperRestorePublicationBarrier.arm());
			await action(page, app, copy.photoFileMenu, restoreCopy.title);
			let dialog = named(page, 'dialog', restoreCopy.title);
			await dialog.getByLabel(restoreCopy.file, { exact: true }).setInputFiles(source);
			await keyboard(page, named(dialog, 'button', restoreCopy.restore));
			await expect.poll(() => page.evaluate(() => globalThis.__lightscaperRestorePublicationBarrier.snapshot().held)).toBe(true);
			await expect(dialog.locator('[data-photo-restore-receipt]')).toHaveCount(0);
			await expect(named(dialog, 'button', restoreCopy.restore)).toBeDisabled();
			await keyboard(page, bodyClose(dialog, restoreCopy.close)); await expect(dialog).toHaveCount(0);
			await action(page, app, copy.photoFileMenu, restoreCopy.title); dialog = named(page, 'dialog', restoreCopy.title);
			await keyboard(page, named(dialog, 'button', restoreCopy.cancel));
			await expect(named(dialog, 'button', restoreCopy.cancel)).toBeDisabled();
			await expect(dialog.locator('[data-photo-restore-receipt]')).toHaveCount(0);
			const installed = await page.evaluate(async ({ databaseName, pointerKey }) => {
				const database = await new Promise((resolve, reject) => {
					const opening = indexedDB.open(databaseName); opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
				});
				const transaction = database.transaction('settings'), store = transaction.objectStore('settings');
				const completion = new Promise((resolve, reject) => {
					transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error);
				});
				void completion.catch(() => undefined);
				try {
					const read = key => new Promise((resolve, reject) => { const request = store.get(key);
						request.onsuccess = () => resolve(request.result?.value); request.onerror = () => reject(request.error); });
					const pointer = await read(pointerKey), commit = await read(`photo-library:restore-commit-v1:${pointer.namespaceToken}`);
					await completion;
					return { version: pointer.schemaVersion, token: pointer.namespaceToken, commitToken: commit.allocation.namespaceToken, catalogId: pointer.catalogId, committedCatalogId: commit.candidateReceipt.catalogId };
				} finally { try { await completion; } catch { /* Preserve an earlier read failure after native settlement. */ } database.close(); }
			}, { databaseName: PHOTO_LIBRARY_DEFAULT_SETTINGS_DATABASE_NAME_V2, pointerKey: PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 });
			expect(installed).toMatchObject({ version: 2, catalogId: original.root.id, committedCatalogId: original.root.id });
			expect(installed.token).toMatch(/^[a-f0-9]{32}$/u); expect(installed.commitToken).toBe(installed.token);
			await page.evaluate(() => globalThis.__lightscaperRestorePublicationBarrier.release());
			await expect(dialog.locator('[data-photo-restore-receipt]')).toContainText(restoreCopy.acknowledged.replace('{name}', original.root.name));
			await expect(dialog.getByRole('alert')).toHaveCount(0); await expect(dialog.getByText(restoreCopy.cancelled, { exact: true })).toHaveCount(0);
			await keyboard(page, bodyClose(dialog, restoreCopy.close)); await page.reload(); await expect(app).toBeVisible();
			expect(await decode((await backup(page, app, copy)).buffer)).toEqual(original); expect(errors).toEqual([]);
		} finally { await page.evaluate(() => globalThis.__lightscaperRestorePublicationBarrier.release()); }
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
	const blob = new Blob([bytes]), header = await withScapeArchiveReader(blob, undefined, async entries =>
		normalizePhotoCatalogArchiveV5(JSON.parse((await readScapeArchiveEnvelope(entries)).projectText)));
	expect(header.schemaVersion).toBe(5); expect(header.lutResources).toEqual([]);
	const result = { root: null, savedState: null, presetHeader: null, presets: null, photos: [], stacks: [], saved: [] };
	await importPhotoCatalogArchiveV5(blob, async (root, state, presets, declaredLuts) => {
		expect(declaredLuts).toEqual([]); expect(root).toEqual(header.catalog); expect(state).toEqual(header.savedCollectionState);
		expect(presets).toEqual(header.developPresetPack); if (presets) expect(presets.rowSchemaVersion).toBe(2);
		result.root = root; result.savedState = state; result.presetHeader = presets; return {
		async writePhoto(document, chunks) { assertNumericPhoto(document); const parts = []; for await (const chunk of chunks) parts.push(Buffer.from(chunk)); result.photos.push({ document, original: Buffer.concat(parts) }); },
		async writeStack(stack) { result.stacks.push(stack); }, async writeSavedCollection(definition) { result.saved.push(definition); },
		async writeDevelopPresets(row) { expect(result.presets).toBeNull(); expect(row.schemaVersion).toBe(2);
			for (const preset of row.presets) { expect(preset.schemaVersion).toBe(2); expect(preset.settings.schemaVersion).toBe(2); expect(preset.settings.develop.processVersion).toBe(1); }
			result.presets = row; },
		async writeLut() { throw Error('Numeric-only restore witness must not contain LUT resources.'); },
		async publish() {}, async rollback() { throw new Error('Backup authentication rolled back.'); },
	}; });
	result.photos.sort((a, b) => a.document.id.localeCompare(b.document.id)); result.stacks.sort((a, b) => a.id.localeCompare(b.id)); result.saved.sort((a, b) => a.id.localeCompare(b.id));
	return result;
}
function activeVersion(document) { return document.versions.find(version => version.id === document.activeVersionId); }
async function importPhotos(page, app, copy, names) {
	await action(page, app, copy.photoFileMenu, copy.photoImportPhotos); const importer = named(page, 'dialog', copy.photoImportPhotos);
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles(names.map(name => ({ name, mimeType: 'image/png', buffer: PNG })));
	await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
	const library = app.locator('[data-photo-library]'); await expect(library.locator('[data-photo-count]')).toHaveAttribute('data-photo-count', String(names.length));
	await expect(library).toHaveAttribute('aria-busy', 'false'); return library;
}
async function restoreAndReload(page, app, library, copy, restoreCopy, source, count) {
	await restore(page, app, copy, restoreCopy, source); await keyboard(page, bodyClose(named(page, 'dialog', restoreCopy.title), restoreCopy.close));
	await expect(library).toHaveCount(0); await page.reload(); await expect(app).toBeVisible(); await expect(library).toHaveCount(0);
	await action(page, app, copy.photoViewMenu, copy.photoShowLibrary);
	await expect(library.locator('[data-photo-count]')).toHaveAttribute('data-photo-count', String(count)); await expect(library).toHaveAttribute('aria-busy', 'false');
}
function developTools(page, app, library, copy, locale) {
	const labels = photoDevelopCopy(locale), messages = photoDevelopSettingsCopy(locale); let dialog;
	const numberInput = key => named(dialog, 'spinbutton', `${labels.shared.videoEffectExactValue}: ${labels.shared[key]}`);
	const settled = async () => { await expect(named(dialog, 'button', labels.cancel).last()).toBeDisabled(); await expect(library).toHaveAttribute('aria-busy', 'false'); };
	return { messages, numberInput, settled,
		async open(fileName) { await keyboard(page, photo(page, library, fileName)); await action(page, app, copy.photoFileMenu, photoDevelopMenuLabel(locale), copy.photoPhotoMenu);
			dialog = named(page, 'dialog', `${labels.title}: ${fileName}`); await expect(named(dialog, 'region', labels.preview)).toHaveAttribute('data-state', 'ready'); },
		async add(type, key, value) { await chooseValue(page, named(dialog, 'combobox', labels.choose), type); await keyboard(page, named(dialog, 'button', labels.add));
			const input = numberInput(key); await input.fill(value); await input.press('Enter'); await expect(input).toHaveValue(value); },
		async save() { await keyboard(page, named(dialog, 'button', labels.save)); await expect(dialog.locator('[data-photo-develop-ack]')).toContainText(labels.acknowledged); await settled(); },
		async presets() { const menu = dialog.locator('details').filter({ has: page.locator('summary').filter({ hasText: new RegExp(`^${messages.menu}$`, 'u') }) });
			if (!(await menu.evaluate(value => value.open))) await keyboard(page, menu.locator('summary'));
			await keyboard(page, named(menu, 'button', messages.presets)); const options = named(page, 'dialog', messages.presets); await settled(); return options; },
		async choose(options, name, partial) { await chooseLabel(page, named(options, 'combobox', messages.choosePreset), `${name} (${partial ? messages.partial : messages.full})`); },
		async savePreset(options, name, partial) { await checkbox(page, named(options, 'checkbox', messages.all), !partial);
			if (partial) await checkbox(page, named(options, 'checkbox', labels.shared.videoEffectWhiteBalance), true);
			await checkbox(page, named(options, 'checkbox', messages.geometry), !partial); await checkbox(page, named(options, 'checkbox', messages.local), !partial);
			await named(options, 'textbox', messages.presetName).fill(name); await keyboard(page, named(options, 'button', messages.savePreset)); await settled();
			await expect(named(options, 'combobox', messages.choosePreset)).toContainText(`${name} (${partial ? messages.partial : messages.full})`); },
		async closeOptions(options) { await keyboard(page, bodyClose(options, messages.close)); await expect(options).toHaveCount(0); },
		async close() { await keyboard(page, bodyClose(dialog, labels.close)); await expect(dialog).toHaveCount(0); },
	};
}
function assertNumericPhoto(photo) {
	expect(photo.schemaVersion).toBe(1);
	for (const version of photo.versions) {
		expect(version.develop.processVersion).toBe(1);
		if (version.workspace) { expect(version.workspace.schemaVersion).toBe(1);
			for (const item of [...version.workspace.entries, ...version.workspace.snapshots]) expect(item.develop.processVersion).toBe(1); }
	}
}
async function chooseValue(page, combo, value) {
	const values = await combo.getByRole('option').evaluateAll(options => options.map(option => option.value));
	const index = values.indexOf(value); expect(index).toBeGreaterThanOrEqual(0);
	await combo.focus(); await expect(combo).toBeFocused(); await page.keyboard.press('Home');
	for (let offset = 0; offset < index; offset++) await page.keyboard.press('ArrowDown');
	await expect(combo).toHaveValue(value);
}
async function chooseLabel(page, combo, label) {
	const option = combo.getByRole('option', { name: label, exact: true }); await expect(option).toHaveCount(1);
	await chooseValue(page, combo, await option.getAttribute('value'));
}
async function checkbox(page, control, checked) {
	await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused();
	if (await control.isChecked() !== checked) await page.keyboard.press('Space');
	await expect(control).toBeChecked({ checked });
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

/** Hold only observation of a genuine completed pointer/history transaction, never its native commit. */
async function installPublicationBarrier(page) {
	await page.addInitScript(({ databaseName, pointerKey }) => {
		const completion = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
		const put = IDBObjectStore.prototype.put, targets = new WeakSet(), waiting = [];
		let armed = false, held = false;
		Object.defineProperty(IDBTransaction.prototype, 'oncomplete', { ...completion, set(callback) {
			Reflect.apply(completion.set, this, [typeof callback !== 'function' ? callback : function(event) {
				if (armed && targets.has(this)) { held = true; waiting.push(() => Reflect.apply(callback, this, [event])); }
				else Reflect.apply(callback, this, [event]);
			}]);
		} });
		IDBObjectStore.prototype.put = function(value, key) {
			if (armed && this.name === 'settings' && this.transaction.db.name === databaseName && value?.key === pointerKey && value.value?.schemaVersion === 2) targets.add(this.transaction);
			return Reflect.apply(put, this, key === undefined ? [value] : [value, key]);
		};
		globalThis.__lightscaperRestorePublicationBarrier = Object.freeze({ arm() { armed = true; }, snapshot: () => ({ held }), release() {
			armed = false; Object.defineProperty(IDBTransaction.prototype, 'oncomplete', completion); IDBObjectStore.prototype.put = put;
			for (const deliver of waiting.splice(0)) deliver();
		} });
	}, { databaseName: PHOTO_LIBRARY_DEFAULT_SETTINGS_DATABASE_NAME_V2, pointerKey: PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 });
}
