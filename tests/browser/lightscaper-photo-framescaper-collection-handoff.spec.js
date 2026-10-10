/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoFramescaperCollectionHandoffCopy } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-copy.ts';
import { photoFramescaperCollectionHandoffMenuLabel } from '../../src/common/i18n/lightscaper-photo-framescaper-handoff-menu-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { pngChunk } from '../helpers/image-metadata-fixtures.ts';
import { expect, test, installNativeImageHandoffRuntime, observeNativeImageHandoffLibrary,
	inspectCollectionFramescaperArchive } from './helpers/lightscaper-image-handoff-native-fixture.js';

const NAMES = ['Photo A.png', 'Photo B.png', 'Photo C.png'];
const COLORS = [[255, 255, 255, 255], [128, 128, 128, 255], [0, 0, 0, 255]];
const PNGS = COLORS.map(png), CUBE = Buffer.from(`LUT_3D_SIZE 2\n${'0.25 0 0\n'.repeat(8)}`);
const SAVED_QUERY = { schemaVersion: 2, kind: 'photo-catalog-query', text: '', filter: null,
	sort: { field: 'file-name', direction: 'descending' }, predicate: { kind: 'number', column: 'width', minimum: 2, maximum: 2 } };

for (const locale of ['en', 'de']) {
	test(`${locale}: collection sequence is menu-only, unselected and keeps the archive cold`, async ({ page }) => {
		const requested = []; page.on('request', request => { requested.push(request.url()); });
		const { app, copy } = await open(page, locale);
		await expect(app.locator('[data-photo-library]')).toHaveCount(0); await expect(page.getByRole('dialog')).toHaveCount(0);
		await action(page, app, copy.photoFileMenu, photoFramescaperCollectionHandoffMenuLabel(locale), copy.photoPhotoMenu, false);
		await expect(named(app, 'button', photoFramescaperCollectionHandoffMenuLabel(locale))).toBeEnabled();
		expect(requested.filter(url => /(?:photo-framescaper-collection|lightscaper-photo-framescaper-handoff-copy)/u.test(url))).toEqual([]);
		await keyboard(page, named(app, 'button', photoFramescaperCollectionHandoffMenuLabel(locale)));
		const words = photoFramescaperCollectionHandoffCopy(locale), dialog = named(page, 'dialog', words.title); await expect(dialog).toBeVisible();
		await expect(named(dialog, 'button', words.download)).toBeDisabled();
		await keyboard(page, named(dialog.locator('.lightscaper-catalog-backup-actions'), 'button', words.close));
		await expect(dialog).toHaveCount(0); await expect(app.locator('[data-photo-library]')).toHaveCount(0);
	});

	test(`${locale}: manual, smart and saved Query2 collections download editable native-order Frame sequences`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'The roadmap defers native WebKit Blob/OPFS catalog workflows.'); test.setTimeout(180_000);
		const errors = []; page.on('pageerror', error => { errors.push(error.message); });
		await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }); });
		await installNativeImageHandoffRuntime(page);
		const { app, copy } = await open(page, locale), words = photoFramescaperCollectionHandoffCopy(locale), develop = photoDevelopCopy(locale);
		await action(page, app, copy.photoFileMenu, copy.photoImportPhotos);
		const importer = named(page, 'dialog', copy.photoImportPhotos);
		await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles(NAMES.map((name, index) => ({ name, mimeType: 'image/png', buffer: PNGS[index] })));
		await keyboard(page, named(importer, 'button', copy.photoImportAction)); await expect(importer).toHaveCount(0);
		const library = app.locator('[data-photo-library]'); await expect(library.locator('[data-photo-id]')).toHaveCount(3);
		await expect(library).toHaveAttribute('aria-busy', 'false');
		const ids = await library.locator('[data-photo-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-photo-id')));
		const initial = await observeNativeImageHandoffLibrary(page, ids), byName = new Map(initial.photos.map(item => [item.photo.metadata.fileName, item.photo.id]));
		const card = name => library.getByRole('button', { name: new RegExp(`^${name.replace('.', '\\.')}`, 'u') });
		await keyboard(page, card(NAMES[0])); await action(page, app, copy.photoFileMenu, photoDevelopMenuLabel(locale), copy.photoPhotoMenu);
		const workspace = named(page, 'dialog', `${develop.title}: ${NAMES[0]}`);
		await expect(named(workspace, 'region', develop.preview)).toHaveAttribute('data-state', 'ready');
		await choose(page, named(workspace, 'combobox', develop.choose), 'cube-lut-profile-v1'); await keyboard(page, named(workspace, 'button', develop.add));
		await workspace.getByLabel(develop.shared.videoEffectCubeLutImport, { exact: true }).setInputFiles({ name: 'Collection red.cube', mimeType: 'text/plain', buffer: CUBE });
		await expect.poll(() => named(workspace, 'img', develop.after).evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, 2, 2).data)))
			.toEqual(Array(4).fill([137, 0, 0, 255]).flat());
		await keyboard(page, named(workspace, 'button', develop.save)); await expect(workspace.locator('[data-photo-develop-ack]')).toBeVisible();
		await keyboard(page, named(workspace.locator('.lightscaper-develop-actions'), 'button', develop.close)); await expect(workspace).toHaveCount(0);

		await action(page, app, copy.photoFileMenu, copy.photoOrganizerTitle);
		const organizer = named(page, 'dialog', copy.photoOrganizerTitle);
		await definition('Manual order'); await definition('Smart order', { kind: 'rating', minimum: 0, maximum: 5 });
		await keyboard(page, organizer.locator('form').getByRole('button', { name: copy.photoCloseMetadata, exact: true })); await expect(organizer).toHaveCount(0);
		const root = (await observeNativeImageHandoffLibrary(page, ids)).root;
		const manual = root.collections.find(item => item.name === 'Manual order'), smart = root.collections.find(item => item.name === 'Smart order');
		expect(manual).toBeDefined(); expect(smart).toBeDefined();
		for (const name of NAMES.slice(0, 2)) {
			await keyboard(page, card(name)); await action(page, app, copy.photoFileMenu, copy.photoMembershipTitle, copy.photoPhotoMenu);
			const membership = named(page, 'dialog', copy.photoMembershipTitle);
			await choose(page, named(membership, 'combobox', copy.photoMembershipTitle), 'collection');
			await keyboard(page, named(membership, 'button', `${copy.photoDefinitionChoose}: ${manual.name}`)); await keyboard(page, named(membership, 'button', copy.photoMembershipAdd));
			await keyboard(page, named(membership, 'button', copy.photoMembershipApply)); await expect(named(membership, 'button', copy.photoMembershipApply)).toBeEnabled();
			await keyboard(page, membership.locator('form').getByRole('button', { name: copy.photoCloseMetadata, exact: true })); await expect(membership).toHaveCount(0);
		}
		await action(page, app, copy.photoViewMenu, copy.photoSaveCurrentFilter);
		const saved = named(page, 'dialog', copy.photoSavedFiltersTitle); await named(saved, 'textbox', copy.photoSavedFilterName).fill('Reverse width query');
		await keyboard(page, named(saved, 'button', copy.photoOrganizerQueryJson)); await named(saved, 'textbox', copy.photoOrganizerQueryJson).fill(JSON.stringify(SAVED_QUERY));
		await keyboard(page, named(saved, 'button', copy.photoOrganizerQueryJson)); await keyboard(page, named(saved, 'button', copy.photoSavedFilterSave));
		await expect(saved.locator('[data-saved-receipt]')).toContainText(copy.photoSavedFilterSaved);
		await keyboard(page, named(saved, 'button', copy.photoSavedFilterRefreshList)); const savedId = await named(saved, 'radio', 'Reverse width query').inputValue();
		await keyboard(page, named(saved.locator('form'), 'button', copy.photoCloseMetadata)); await expect(saved).toHaveCount(0);
		await action(page, app, copy.photoFileMenu, copy.photoClearSelection, copy.photoPhotoMenu);
		const before = await observeNativeImageHandoffLibrary(page, ids);
		const variants = [
			{ scope: 'catalog', id: manual.id, name: manual.name, ids: NAMES.slice(0, 2).map(name => byName.get(name)).sort() },
			{ scope: 'catalog', id: smart.id, name: smart.name, ids: [...ids].sort() },
			{ scope: 'saved-query', id: savedId, name: 'Reverse width query', ids: [...NAMES].reverse().map(name => byName.get(name)) },
		];
		for (const variant of variants) {
			await action(page, app, copy.photoFileMenu, photoFramescaperCollectionHandoffMenuLabel(locale), copy.photoPhotoMenu);
			const dialog = named(page, 'dialog', words.title); await expect(dialog).toBeVisible();
			const downloadButton = named(dialog, 'button', words.download); await expect(downloadButton).toBeDisabled();
			await choose(page, named(dialog, 'combobox', words.scope), variant.scope);
			if (variant.scope === 'catalog') await keyboard(page, named(dialog, 'button', `${copy.photoDefinitionChoose}: ${variant.name} — ${variant.id === manual.id ? words.manual : words.smart}`));
			else await choose(page, named(dialog, 'combobox', words.savedCollection), variant.id);
			await expect(downloadButton).toBeEnabled(); const waiting = page.waitForEvent('download'); await keyboard(page, downloadButton); const download = await waiting;
			await expect(dialog.locator('[data-photo-framescaper-collection-handoff-receipt]')).toHaveAttribute('data-photo-framescaper-collection-handoff-receipt', 'download-started');
			const bytes = await readFile(await download.path()); expect(download.suggestedFilename()).toBe(`${variant.name}.fscape`);
			const entries = unzipSync(bytes), manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']));
			for (const asset of manifest.assets) { expect(entries[asset.entry].length).toBe(asset.size); expect(sha(entries[asset.entry])).toBe(asset.sha256); }
			const recipient = await inspectCollectionFramescaperArchive(page, bytes), project = recipient.project;
			expect(recipient.saved).toEqual(project); expect(project.sources.map(source => source.provenance.origin.photoId)).toEqual(variant.ids);
			expect(project.sources).toHaveLength(variant.ids.length); expect(new Set(project.sources.map(source => source.id)).size).toBe(variant.ids.length);
			expect(project.clips.map(clip => [clip.sequenceStartFrame, clip.sequenceFrameCount])).toEqual(variant.ids.map((_id, index) => [index * 150, 150]));
			expect(project.tracks[0].clipIds).toEqual(project.clips.map(clip => clip.id));
			for (const [index, source] of project.sources.entries()) {
				const sender = before.photos.find(item => item.photo.id === variant.ids[index]), version = sender.photo.versions.find(item => item.id === sender.photo.activeVersionId);
				expect(source.develop).toEqual(version.develop); expect(source.provenance.original.exactName).toBe(sender.photo.original.name);
				expect(recipient.images[index].original).toEqual(sender.bytes);
				const color = sender.photo.metadata.fileName === NAMES[0] ? [137, 0, 0, 255] : COLORS[NAMES.indexOf(sender.photo.metadata.fileName)];
				expect(recipient.images[index].pixels).toEqual(Array(4).fill(color).flat());
			}
			await keyboard(page, named(dialog.locator('.lightscaper-catalog-backup-actions'), 'button', words.close)); await expect(dialog).toHaveCount(0);
			expect(await observeNativeImageHandoffLibrary(page, ids)).toEqual(before);
		}
		await page.reload(); await expect(app).toBeVisible(); expect(await observeNativeImageHandoffLibrary(page, ids)).toEqual(before); expect(errors).toEqual([]);

		async function definition(name, query) {
			await choose(page, named(organizer, 'combobox', copy.photoOrganizerKind).filter({ has: named(page, 'option', copy.photoOrganizerCollection) }), 'collection');
			await keyboard(page, named(organizer, 'button', copy.photoOrganizerCreate).and(organizer.locator('button:not(form button)')));
			await named(organizer, 'textbox', copy.photoOrganizerName).fill(name);
			if (query) { await choose(page, named(organizer.locator('form'), 'combobox', copy.photoOrganizerKind), 'smart'); await named(organizer, 'textbox', copy.photoOrganizerQueryJson).fill(JSON.stringify(query)); }
			await keyboard(page, named(organizer.locator('form'), 'button', copy.photoOrganizerCreate)); await expect(organizer.locator('[data-organizer-selected]')).toContainText(name);
		}
	});
}

async function open(page, locale) {
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`); const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible(); return { app, copy: bundledLightscaperEditorCopyForLocale(locale) };
}
async function action(page, app, menu, label, submenu, click = true) {
	await keyboard(page, app.getByRole('navigation').getByText(menu, { exact: true }));
	if (submenu) await keyboard(page, app.getByRole('navigation').getByText(submenu, { exact: true }));
	if (click) await keyboard(page, named(app, 'button', label));
}
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
async function choose(page, combo, value) {
	await expect(combo).toBeEnabled(); const { index, count } = await combo.locator('option').evaluateAll((options, value) => ({ index: options.findIndex(option => option.value === value), count: options.length }), value);
	expect(index).toBeGreaterThanOrEqual(0); expect(index).toBeLessThan(64); await combo.focus(); await expect(combo).toBeFocused(); await page.keyboard.press(index === count - 1 ? 'End' : 'Home');
	if (index !== count - 1) for (let step = 0; step < index; step++) await page.keyboard.press('ArrowDown'); await expect(combo).toHaveValue(value);
}
function png(color) {
	const row = [0, ...color, ...color]; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk('IHDR', Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0])), pngChunk('sRGB', Buffer.from([0])),
		pngChunk('IDAT', deflateSync(Buffer.from([...row, ...row]))), pngChunk('IEND', Buffer.alloc(0))]);
}
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
