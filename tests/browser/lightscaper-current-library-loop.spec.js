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

// Every case serves test-only observation/corruption/eviction code, outside portable coverage.
test.use({ browserCoverage: false });

// Actual UI commands publish all records. The bounded fixture observes the selected
// namespace, corrupts one body for recovery, and invokes the real preview trim owner.
const OBSERVER = '/__current_library_loop.js';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAALZlWElmSUkqAAgAAAAGAA4BAgAPAAAAaAAAAA8BAgAOAAAAdwAAABIBAwABAAAAAQAAADsBAgAPAAAAhQAAAJiCAgAOAAAAlAAAAGmHBAABAAAAVgAAAAAAAAABAAOQAgAUAAAAogAAAAAAAABTb3VyY2UgY2FwdGlvbgBOYXRpdmUgY2FtZXJhAFNvdXJjZSBjcmVhdG9yAFNvdXJjZSByaWdodHMAMjAyNjoxMDowOCAxMToxMjoxMwDS1J8kAAAADElEQVQI12NgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC', 'base64');
const CUBE = Buffer.from('LUT_3D_SIZE 2\n1 1 1\n0 1 1\n1 0 1\n0 0 1\n1 1 0\n0 1 0\n1 0 0\n0 0 0\n');
const SOURCE_SHA = sha(PNG), LUT_SHA = sha(CUBE);
const SOURCE_NAMES = ['First.png', 'Second.png'];

for (const locale of ['en', 'de']) test(`${locale}: current keyboard library loop preserves mixed photos, source facts and exact bodies through recovery, eviction, V5 restore and reload`, async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'Full WebKit catalog Blob/OPFS custody qualification remains deferred.');
	test.setTimeout(120_000);
	const { app, copy, develop, settings, restoreCopy, errors } = await setup(page, locale);
	const library = app.locator('[data-photo-library]'), cards = library.locator('[data-photo-id]');
	await expect(library).toHaveCount(0); await expect(page.getByRole('dialog')).toHaveCount(0);
	await action(copy.photoFileMenu, copy.photoImportPhotos);
	const importer = named(page, 'dialog', copy.photoImportPhotos);
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles(SOURCE_NAMES.map(name => ({ name, mimeType: 'image/png', buffer: PNG })));
	await key(importer.locator('button[type=submit]')); await expect(importer).toHaveCount(0); await settled(2);
	const importedIds = await cards.evaluateAll(nodes => nodes.map(node => node.dataset.photoId));
	const imported = await observe(importedIds); assertSources(imported); expect(imported.namespace).toBeNull();
	const currentId = imported.photos.find(item => item.photo.original.name === SOURCE_NAMES[0]).photo.id;
	const legacyId = imported.photos.find(item => item.photo.original.name === SOURCE_NAMES[1]).photo.id, ids = [currentId, legacyId];
	const card = id => library.locator(`[data-photo-id="${id}"]`);
	await key(card(currentId)); await card(currentId).press('5'); await settled(2);
	await action(copy.photoFileMenu, `${copy.photoFlag}: ${copy.photoPick}`, true); await settled(2);
	await expect(card(currentId)).toContainText(`${copy.photoRating}: 5`);
	await action(copy.photoFileMenu, photoDevelopMenuLabel(locale), true);
	const editor = named(page, 'dialog', `${develop.title}: ${SOURCE_NAMES[0]}`);
	await expect(named(editor, 'region', develop.preview)).toHaveAttribute('data-state', 'ready');
	await choose(named(editor, 'combobox', develop.choose), 'cube-lut-profile-v1'); await key(named(editor, 'button', develop.add));
	await editor.getByLabel(develop.shared.videoEffectCubeLutImport, { exact: true }).setInputFiles({ name: 'Invert.cube', mimeType: 'text/plain', buffer: CUBE });
	await expect(named(editor, 'button', develop.shared.videoEffectCubeLutClear)).toBeEnabled();
	await key(named(editor, 'button', develop.save)); await expect(editor.locator('[data-photo-develop-ack]')).toBeVisible();
	await expect(named(editor, 'button', develop.cancel).last()).toBeDisabled(); await settled(2);
	const settingsMenu = editor.locator('details').filter({ has: page.locator('summary').filter({ hasText: exact(settings.menu) }) });
	await key(settingsMenu.locator('summary')); await key(named(settingsMenu, 'button', settings.presets));
	const presets = named(page, 'dialog', settings.presets);
	await savePreset('Current full', false); await savePreset('Current LUT', true);
	await close(presets, settings.close); await close(editor, develop.close);
	let resident = await observe(ids); assertSources(resident, imported);
	expect(resident.photos.map(item => item.photo.schemaVersion)).toEqual([2, 1]);
	const current = resident.photos[0].photo, version = active(current), reference = version.develop.effects[0].params.lut;
	expect(version.develop.processVersion).toBe(2); expect(version.workspace.schemaVersion).toBe(2);
	expect(reference).toEqual({ storageKey: `lut-sha256:${LUT_SHA}`, sha256: LUT_SHA, byteLength: CUBE.length, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] });
	expect(current.rating).toBe(5); expect(current.flag).toBe('pick');

	await selectBoth();
	const stackIds = await library.locator('[data-photo-id][aria-pressed=true]').evaluateAll(nodes => nodes.map(node => node.dataset.photoId));
	expect([...stackIds].sort()).toEqual([...ids].sort());
	await action(copy.photoFileMenu, copy.photoStackCreate, true);
	const stack = named(page, 'dialog', copy.photoStackTitle);
	await expect(stack.locator('[data-stack-member]')).toHaveCount(2);
	for (const [index, id] of stackIds.entries()) {
		const member = stack.locator('[data-stack-member]').nth(index);
		await expect(member).toHaveAttribute('data-stack-member', id);
		await expect(member.locator('span').first()).toHaveText(resident.photos.find(item => item.photo.id === id).photo.metadata.fileName);
	}
	await key(stack.locator(`[data-stack-member="${legacyId}"]`).getByRole('button', { name: copy.photoStackMakeCover, exact: true }));
	await key(named(stack, 'button', copy.photoStackSave)); await expect(stack.locator('[data-stack-ack]')).toContainText(copy.photoStackCreated);
	await close(stack, copy.photoCloseMetadata);
	await action(copy.photoViewMenu, copy.photoStackCollapseView); await settled(1); await expect(card(legacyId)).toHaveCount(1);
	await expect(library.locator('[data-photo-count]')).toHaveAttribute('data-photo-count', '2');
	await action(copy.photoViewMenu, copy.photoStackExpandView); await settled(2);

	await action(copy.photoFileMenu, copy.photoOrganizerTitle);
	const organizer = named(page, 'dialog', copy.photoOrganizerTitle);
	await definition('folder', 'Trip folder'); await definition('keyword', 'Trip keyword');
	let root = (await observe(ids)).root;
	const folder = root.folders.find(item => item.name === 'Trip folder'), keyword = root.keywords.find(item => item.name === 'Trip keyword');
	expect(folder).toBeDefined(); expect(keyword).toBeDefined();
	const smartRule = { kind: 'all', terms: [{ kind: 'rating', minimum: 4, maximum: 5 }, { kind: 'keyword', id: keyword.id }] };
	await definition('collection', 'Trip smart', smartRule); root = (await observe(ids)).root;
	const smart = root.collections.find(item => item.name === 'Trip smart'); expect(smart.query).toEqual(smartRule);
	await close(organizer, copy.photoCloseMetadata);
	await key(card(currentId)); await action(copy.photoFileMenu, copy.photoMembershipTitle, true);
	const memberships = named(page, 'dialog', copy.photoMembershipTitle);
	await key(memberships.locator(`[data-definition-choose="${folder.id}"]`));
	await choose(memberships.locator('select[name=membershipKind]'), 'keyword');
	await key(memberships.locator(`[data-definition-choose="${keyword.id}"]`)); await key(memberships.locator('[data-membership-add]'));
	await key(named(memberships, 'button', copy.photoMembershipApply)); await expect(named(memberships, 'button', copy.photoMembershipApply)).toBeEnabled();
	await expect.poll(async () => (await observe(ids)).photos[0].photo.keywordIds).toEqual([keyword.id]);
	await close(memberships, copy.photoCloseMetadata);
	await query(smart.id); await settled(1); await expect(card(currentId)).toHaveCount(1);
	await key(card(currentId)); await card(currentId).press('2'); await settled(0);
	expect((await observe(ids)).photos[0].photo.rating).toBe(2);
	await query(null); await settled(2); await key(card(currentId)); await card(currentId).press('5'); await settled(2);
	await query(smart.id); await settled(1);
	await action(copy.photoViewMenu, copy.photoSaveCurrentFilter);
	const savedFilters = named(page, 'dialog', copy.photoSavedFiltersTitle);
	await text(savedFilters.locator('input[name=savedFilterName]'), 'Trip live query');
	await key(savedFilters.locator('[data-saved-save]')); await expect(savedFilters.locator('[data-saved-receipt]')).toContainText(copy.photoSavedFilterSaved);
	await close(savedFilters, copy.photoCloseMetadata); await query(null); await settled(2);

	await key(card(currentId)); await action(copy.photoFileMenu, copy.photoEditMetadata, true);
	const metadata = named(page, 'dialog', copy.photoEditMetadata);
	await text(metadata.locator('input[name=title]'), 'Keyboard trip title');
	await text(metadata.locator('textarea[name=caption]'), 'Keyboard first line\nKeyboard second line');
	await text(metadata.locator('input[name=creator]'), 'Keyboard author'); await text(metadata.locator('input[name=location]'), 'Keyboard location');
	const capture = metadata.locator('input[name=captureLocal]'), previousClock = await capture.inputValue();
	await capture.focus(); await page.keyboard.press('ArrowUp');
	const authoredClock = await capture.inputValue(); expect(authoredClock).not.toBe(previousClock);
	expect(authoredClock).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?$/u);
	await text(metadata.locator('input[name=captureOffset]'), '120'); await key(metadata.locator('button[type=submit]'));
	await expect(metadata.locator('input[name=title]')).toHaveValue('Keyboard trip title'); await settled(2);
	await close(metadata, copy.photoCloseMetadata);
	resident = await observe(ids); assertSources(resident, imported);
	expect(resident.photos[0].photo.metadata).toMatchObject({ title: 'Keyboard trip title', caption: 'Keyboard first line\nKeyboard second line',
		creator: 'Keyboard author', location: 'Keyboard location', captureTime: { local: canonicalClock(authoredClock), offsetMinutes: 120 } });
	expect(resident.photos[0].photo.folderId).toBe(folder.id); expect(resident.photos[0].photo.keywordIds).toEqual([keyword.id]);
	const beforeRename = resident;
	await selectBoth();
	const renameIds = await library.locator('[data-photo-id][aria-pressed=true]').evaluateAll(nodes => nodes.map(node => node.dataset.photoId));
	expect([...renameIds].sort()).toEqual([...ids].sort());
	await action(copy.photoFileMenu, copy.photoBatchRenameTitle, true);
	const rename = named(page, 'dialog', copy.photoBatchRenameTitle);
	await text(rename.locator('[data-batch-rename-template]'), 'Trip-{sequence}.{extension}');
	await text(rename.locator('[data-batch-rename-sequence-start]'), '1'); await text(rename.locator('[data-batch-rename-sequence-padding]'), '3');
	await key(rename.locator('[data-batch-rename-preview]')); await expect(rename.locator('[data-batch-rename-plan-row]')).toHaveCount(2);
	for (const [index, value] of ['Trip-001.png', 'Trip-002.png'].entries()) {
		const row = rename.locator('[data-batch-rename-plan-row]').nth(index);
		await expect(row.locator('td').nth(0)).toHaveText(beforeRename.photos.find(item => item.photo.id === renameIds[index]).photo.metadata.fileName);
		await expect(row.locator('td').nth(1)).toHaveText(value);
	}
	await key(rename.locator('[data-batch-rename-apply]')); await expect(rename.locator('[data-batch-rename-status="renamed"]')).toHaveCount(2);
	await key(rename.locator('[data-batch-rename-close]')); resident = await observe(ids); assertSources(resident, imported);
	for (let index = 0; index < 2; index++) {
		expect(resident.photos[index].photo.metadata).toEqual({ ...beforeRename.photos[index].photo.metadata, fileName: `Trip-00${renameIds.indexOf(ids[index]) + 1}.png` });
		expect(resident.photos[index].photo.revision).toBe(beforeRename.photos[index].photo.revision + 1);
	}

	await action(copy.photoViewMenu, copy.photoShowThumbnails);
	await expect(library.locator('canvas')).toHaveCount(2); await expect.poll(() => library.locator('canvas').evaluateAll(nodes => nodes.map(node => [node.width, node.height]))).toEqual([[2, 2], [2, 2]]);
	await key(card(currentId)); await action(copy.photoViewMenu, copy.photoShowLoupe);
	await expect(app.locator('[data-photo-loupe] canvas')).toHaveCount(1);
	await action(copy.photoViewMenu, copy.photoHideLoupe); await action(copy.photoViewMenu, copy.photoHideThumbnails);
	await expect(app.locator('canvas')).toHaveCount(0);
	const beforeEviction = await observe(ids), cached = await fixture('readCurrentLibraryPreviewInventoryV1', ids);
	expect(cached.entries.length).toBeGreaterThanOrEqual(2);
	const eviction = await fixture('evictCurrentLibraryPreviewsV1', ids);
	expect(eviction.removedEntries).toBe(cached.entries.length); expect(eviction.removedBytes).toBe(cached.entries.reduce((sum, row) => sum + row.byteLength, 0));
	expect((await fixture('readCurrentLibraryPreviewInventoryV1', ids)).entries).toEqual([]);
	expect(await observe(ids)).toEqual(beforeEviction);
	await action(copy.photoViewMenu, copy.photoShowThumbnails); await expect(library.locator('canvas')).toHaveCount(2);
	await expect.poll(async () => (await fixture('readCurrentLibraryPreviewInventoryV1', ids)).entries.length).toBeGreaterThanOrEqual(2);
	await action(copy.photoViewMenu, copy.photoHideThumbnails); await expect(app.locator('canvas')).toHaveCount(0);

	const beforeFault = await observe(ids), fault = await fixture('corruptCurrentLibraryOriginalV1', ids);
	expect(fault.expectedSha256).toBe(SOURCE_SHA); expect(fault.corruptSha256).not.toBe(SOURCE_SHA);
	// During the explicit fault, stored document/custody facts remain valid; body SHA does not.
	await action(copy.photoFileMenu, copy.photoOriginalRecoveryTitle);
	const recovery = named(page, 'dialog', copy.photoOriginalRecoveryTitle);
	await expect(recovery.locator('[data-original-row]')).toHaveCount(2);
	for (const row of await recovery.locator('[data-original-row]').all()) await expect(row).toContainText(copy.photoOriginalCorrupt);
	const target = recovery.locator('[data-original-row]').filter({ hasText: 'Trip-001.png' }).locator('input[type=radio]');
	await target.focus(); await page.keyboard.press('Space'); await expect(target).toBeChecked();
	const choosing = page.waitForEvent('filechooser'); await key(recovery.locator('[data-original-file]'), 'Space');
	await (await choosing).setFiles({ name: 'Same original body.bin', mimeType: 'image/png', buffer: PNG });
	await expect(recovery.locator('[data-original-selected-file]')).toHaveText('Same original body.bin');
	await key(recovery.locator('[data-original-restore]')); await expect(recovery.locator('[data-original-receipt]')).toContainText(copy.photoOriginalRestored);
	await expect(recovery.locator('[data-original-inspect]')).toBeEnabled(); await key(recovery.locator('[data-original-inspect]'));
	for (const row of await recovery.locator('[data-original-row]').all()) await expect(row).toContainText(copy.photoOriginalVerified);
	await key(recovery.locator('[data-original-close]'));
	expect(await observe(ids)).toEqual(beforeFault); assertSources(await observe(ids), imported);

	const final = await observe(ids), backup = await download(), archive = await decode(backup.buffer);
	expect(archive.root).toEqual(final.root); expect(archive.photos.map(row => row.document)).toEqual([...final.photos.map(row => row.photo)].sort(byId));
	for (const row of archive.photos) { expect(row.original).toEqual(PNG); expect(sha(row.original)).toBe(row.document.original.contentSha256); }
	expect(archive.resources).toEqual([{ reference, bytes: CUBE }]); expect(archive.stacks).toHaveLength(1);
	expect(archive.stacks[0]).toMatchObject({ photoIds: stackIds, coverPhotoId: legacyId });
	expect(archive.savedState).toMatchObject({ collectionCount: 1 }); expect(archive.saved).toHaveLength(1);
	expect(archive.saved[0]).toMatchObject({ name: 'Trip live query', query: { filter: { kind: 'collection', id: smart.id } } });
	expect(archive.presets.schemaVersion).toBe(2); expect(archive.presetHeader).toMatchObject({ rowSchemaVersion: 2, revision: 2, presetCount: 2 });
	const full = archive.presets.presets.find(value => value.identity.name === 'Current full'), partial = archive.presets.presets.find(value => value.identity.name === 'Current LUT');
	expect(full.settings.selection).toEqual({ effectTypes: 'all', geometry: true, localAdjustments: true });
	expect(partial.settings.selection).toEqual({ effectTypes: ['cube-lut-profile-v1'], geometry: false, localAdjustments: false });
	for (const preset of [full, partial]) expect(preset.settings.develop.effects[0].params.lut).toEqual(reference);
	await key(card(currentId)); await card(currentId).press('1'); await settled(2); expect((await observe(ids)).photos[0].photo.rating).toBe(1);
	await action(copy.photoFileMenu, restoreCopy.title);
	const restore = named(page, 'dialog', restoreCopy.title); await restore.getByLabel(restoreCopy.file, { exact: true }).setInputFiles(backup);
	await key(named(restore, 'button', restoreCopy.restore)); await expect(restore.locator('[data-photo-restore-receipt]')).toBeVisible();
	await expect(restore.getByRole('alert')).toHaveCount(0); await close(restore, restoreCopy.close);
	await page.reload(); await expect(app).toBeVisible(); await expect(library).toHaveCount(0); await expect(page.getByRole('dialog')).toHaveCount(0);
	await action(copy.photoViewMenu, copy.photoShowLibrary); await settled(2);
	const reopened = await observe(ids); expect(reopened.namespace).toMatch(/^[a-f0-9]{32}$/u); expect(reopened.namespace).not.toBe(final.namespace);
	expect(reopened.root).toEqual(final.root); expect(reopened.photos).toEqual(final.photos); assertSources(reopened, imported);
	await action(copy.photoViewMenu, copy.photoSavedFiltersTitle);
	const reopenedSaved = named(page, 'dialog', copy.photoSavedFiltersTitle);
	const savedChoice = reopenedSaved.getByRole('radio', { name: /Trip live query/u }); await savedChoice.focus(); await page.keyboard.press('Space');
	await key(reopenedSaved.locator('[data-saved-use]')); await settled(1); await expect(card(currentId)).toHaveCount(1);
	await close(reopenedSaved, copy.photoCloseMetadata);
	expect(await decode((await download()).buffer)).toEqual(archive); expect(errors).toEqual([]);
	await test.info().attach('current-library-loop-ledger', { contentType: 'application/json', body: JSON.stringify({
		locale, browserName, sourceSha256: SOURCE_SHA, lutSha256: LUT_SHA, photoIds: ids, namespaceBefore: final.namespace,
		namespaceAfter: reopened.namespace, photoSchemas: reopened.photos.map(item => item.photo.schemaVersion), removedPreviewEntries: eviction.removedEntries,
		root: archive.root, photoRevisions: reopened.photos.map(item => item.photo.revision), stackCount: archive.stacks.length,
		savedCount: archive.saved.length, presetHeader: archive.presetHeader, lutCount: archive.resources.length }) });

	async function key(locator, key = 'Enter') { await keyboard(page, locator, key); }
	async function text(locator, value) { await locator.focus(); await expect(locator).toBeFocused(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.insertText(value); await expect(locator).toHaveValue(value); }
	async function choose(combo, value) { await chooseWithKeyboard(page, combo, value); }
	async function settled(count) { await expect(library).toHaveAttribute('aria-busy', 'false'); await expect(cards).toHaveCount(count); }
	async function action(title, label, photo = false) { await menu(page, app, title, label, photo ? copy.photoPhotoMenu : null); }
	async function close(dialog, label) { await key(named(dialog, 'button', label).filter({ hasText: exact(label) })); await expect(dialog).toHaveCount(0); }
	async function observe(photoIds) { return fixture('readResidentPhotoLibraryCurrent', photoIds); }
	async function fixture(method, photoIds) { const result = await page.evaluate(async ({ path, method, photoIds }) => {
		const module = await import(new URL(path, location.href).href);
		return method === 'readResidentPhotoLibraryCurrent'
			? module[method](photoIds, indexedDB, () => globalThis.__assertNativeOpfsWorkerExecution()) : module[method](photoIds);
	}, { path: OBSERVER, method, photoIds });
		await assertNativeOpfsWorkerExecution(page); return result; }
	async function selectBoth() { await key(card(currentId)); await card(legacyId).focus(); await page.keyboard.press('Control+Space'); await expect(library.locator('[data-photo-id][aria-pressed=true]')).toHaveCount(2); }
	async function savePreset(name, partial) {
		await checkbox(named(presets, 'checkbox', settings.all), !partial);
		if (partial) await checkbox(named(presets, 'checkbox', develop.shared.videoEffectCubeLutProfile), true);
		await checkbox(named(presets, 'checkbox', settings.geometry), !partial); await checkbox(named(presets, 'checkbox', settings.local), !partial);
		await text(named(presets, 'textbox', settings.presetName), name); await key(named(presets, 'button', settings.savePreset));
		await expect(named(presets, 'combobox', settings.choosePreset)).toContainText(`${name} (${partial ? settings.partial : settings.full})`);
		await expect(named(presets, 'button', settings.savePreset)).toBeEnabled();
	}
	async function checkbox(locator, value) { if (await locator.isChecked() !== value) { await locator.focus(); await page.keyboard.press('Space'); } await expect(locator).toBeChecked({ checked: value }); }
	async function definition(kind, name, rule) {
		await choose(organizer.locator('select[name=organizerKind]'), kind); await key(organizer.locator('[data-organizer-create]'));
		await text(organizer.locator('input[name=definitionName]'), name);
		if (rule) { await choose(organizer.locator('select[name=collectionKind]'), 'smart'); await text(organizer.locator('textarea[name=queryJson]'), JSON.stringify(rule)); }
		await key(organizer.locator('form button[type=submit]')); await expect(organizer.locator('[data-organizer-selected]')).toContainText(name);
	}
	async function query(collectionId) {
		await action(copy.photoViewMenu, copy.photoQueryTitle); const query = named(page, 'dialog', copy.photoQueryTitle);
		await choose(named(query, 'combobox', copy.photoQueryFilter), collectionId ? 'collection' : '');
		if (collectionId) await key(query.locator(`[data-definition-choose="${collectionId}"]`));
		const build = query.locator('[data-query-build]'); if (await build.count()) { await key(build); await expect(build).toHaveCount(0); }
		await key(named(query, 'button', copy.photoQueryApply)); await expect(library).toHaveAttribute('aria-busy', 'false');
		await expect(query.getByRole('alert')).toHaveCount(0); await key(query.locator('[data-query-close]')); await expect(query).toHaveCount(0);
	}
	async function download() {
		await action(copy.photoFileMenu, copy.photoBackupTitle); const dialog = named(page, 'dialog', copy.photoBackupTitle), pending = page.waitForEvent('download');
		await key(named(dialog, 'button', copy.photoBackupSave)); const result = await pending;
		const source = { name: result.suggestedFilename(), mimeType: 'application/vnd.soundscaper.scape+zip', buffer: await readFile(await result.path()) };
		await expect(dialog.locator('[data-photo-backup-receipt]')).toContainText(copy.photoBackupDownloadStarted.replace('{name}', source.name));
		await close(dialog, copy.photoBackupClose); return source;
	}
});

async function setup(page, locale) {
	await installNativeOpfsWorkerCompanion(page);
	const errors = []; page.on('pageerror', error => { errors.push(error.message); });
	await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
	const bundle = await build({ stdin: { resolveDir: fileURLToPath(new URL('../helpers/', import.meta.url)), contents:
		`export { readResidentPhotoLibraryCurrent } from './lightscaper-current-app-fixture.tsx';\nexport { corruptCurrentLibraryOriginalV1, readCurrentLibraryPreviewInventoryV1, evictCurrentLibraryPreviewsV1 } from './lightscaper-current-library-loop-fixture.ts';` },
		bundle: true, write: false, format: 'esm', platform: 'browser' });
	await page.route(`**${OBSERVER}`, route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`); const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
	return { app, copy: bundledLightscaperEditorCopyForLocale(locale), develop: photoDevelopCopy(locale), settings: photoDevelopSettingsCopy(locale), restoreCopy: lightscaperRestoreCopy(locale), errors };
}
async function decode(bytes) {
	const result = { root: null, savedState: null, presetHeader: null, resources: [], presets: null, photos: [], stacks: [], saved: [] }; let published = false;
	await importPhotoCatalogArchiveV5(new Blob([bytes]), async (root, savedState, presetHeader) => {
		Object.assign(result, { root, savedState, presetHeader }); return {
			async writePhoto(document, chunks) { const parts = []; for await (const chunk of chunks) parts.push(Buffer.from(chunk)); result.photos.push({ document, original: Buffer.concat(parts) }); },
			async writeLut(reference, body) { result.resources.push({ reference, bytes: Buffer.from(body) }); }, async writeDevelopPresets(row) { result.presets = row; },
			async writeStack(stack) { result.stacks.push(stack); }, async writeSavedCollection(definition) { result.saved.push(definition); },
			async publish() { published = true; }, async rollback() { throw Error('Current loop archive authentication rolled back.'); },
		};
	});
	expect(published).toBe(true); result.photos.sort((a, b) => byId(a.document, b.document)); return result;
}
function assertSources(resident, previous = resident) {
	for (const item of resident.photos) {
		const before = previous.photos.find(row => row.photo.id === item.photo.id);
		expect(item.bytes).toEqual([...PNG]); expect(sha(Buffer.from(item.bytes))).toBe(SOURCE_SHA);
		expect(item.photo.original.contentSha256).toBe(SOURCE_SHA); expect(item.photo.original.byteLength).toBe(PNG.length);
		expect(item.photo.original).toEqual(before.photo.original); expect(item.photo.extractedMetadata).toEqual(before.photo.extractedMetadata);
		expect(item.photo.extractedMetadata.exif.artist).toBe('Source creator'); expect(item.photo.extractedMetadata.exif.description).toBe('Source caption');
	}
}
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function active(photo) { return photo.versions.find(version => version.id === photo.activeVersionId); }
function byId(a, b) { return a.id.localeCompare(b.id); }
function canonicalClock(clock) { const full = clock.length === 16 ? `${clock}:00` : clock; return full.includes('.') ? full : `${full}.000`; }
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
function exact(value) { return new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'u'); }
async function keyboard(page, locator, key = 'Enter') { await expect(locator).toBeEnabled(); await locator.focus(); await expect(locator).toBeFocused(); await page.keyboard.press(key); }
async function menu(page, app, title, action, submenu) {
	await keyboard(page, app.locator('nav > details > summary').filter({ hasText: exact(title) }));
	if (submenu) await keyboard(page, app.locator('.lightscaper-photo-submenu > summary').filter({ hasText: exact(submenu) }));
	await keyboard(page, named(app, 'button', action));
}
async function chooseWithKeyboard(page, combo, value) {
	await expect(combo).toBeVisible(); await expect(combo).toBeEnabled();
	await expect(combo.locator(`option[value=${JSON.stringify(value)}]`)).toHaveCount(1);
	const index = await combo.locator('option').evaluateAll((options, value) => options.findIndex(option => option.value === value), value);
	expect(index).toBeGreaterThanOrEqual(0); expect(index).toBeLessThan(64); await combo.focus(); await expect(combo).toBeFocused(); await page.keyboard.press('Home');
	for (let count = 0; count < index; count++) await page.keyboard.press('ArrowDown'); await expect(combo).toHaveValue(value);
}
