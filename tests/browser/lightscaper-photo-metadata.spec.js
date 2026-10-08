/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { createPhotoMetadataQueryByteFixtureV1 } from '../helpers/lightscaper-metadata-query-byte-fixture.ts';
import { jpegExif, numberEntry, rationalEntry, textEntry, tiffFixture } from '../helpers/image-metadata-fixtures.ts';
import { expect, test } from './helpers/browser-coverage-fixture.js';

test.use({ browserCoverage: false });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==', 'base64');

for (const [locale, copy] of [
	['en', { file: 'File', photo: 'Photo', view: 'View', importPhotos: 'Import photos', choose: 'Choose photos', import: 'Import',
		library: 'Photo library', show: 'Show photo library', edit: 'Edit metadata', filename: 'Filename', title: 'Title',
		caption: 'Caption', capture: 'Capture time', offset: 'Timezone offset in minutes (empty if unknown)', save: 'Save metadata', close: 'Close' }],
	['de', { file: 'Datei', photo: 'Foto', view: 'Ansicht', importPhotos: 'Fotos importieren', choose: 'Fotos auswählen', import: 'Importieren',
		library: 'Fotobibliothek', show: 'Fotobibliothek anzeigen', edit: 'Metadaten bearbeiten', filename: 'Dateiname', title: 'Titel',
		caption: 'Beschreibung', capture: 'Aufnahmezeit', offset: 'Zeitzonenversatz in Minuten (leer, falls unbekannt)', save: 'Metadaten speichern', close: 'Schließen' }],
]) {
	test(`${locale}: keyboard metadata edits rename only the catalog, preserve an unknown capture offset and survive reload`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'The roadmap defers the full WebKit storage workflow until native Blob/OPFS support is qualified.');
		test.setTimeout(60_000);
		const origin = JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper;
		await page.goto(`${origin}/${locale}/`);
		const app = page.locator('[data-lightscaper-bound="true"]');
		await expect(app).toBeVisible();
		await expect(app.getByRole('dialog')).toHaveCount(0);
		await app.locator('summary').filter({ hasText: copy.file }).click();
		await app.getByRole('button', { name: copy.importPhotos, exact: true }).click();
		const importer = page.getByRole('dialog', { name: copy.importPhotos, exact: true });
		await importer.getByLabel(copy.choose).setInputFiles({ name: 'Original.png', mimeType: 'image/png', buffer: PNG });
		await importer.getByRole('button', { name: copy.import, exact: true }).click();
		const library = app.getByRole('region', { name: copy.library, exact: true });
		const card = library.locator('[data-photo-id]');
		await expect(card).toHaveCount(1);
		await expect(library).toHaveAttribute('aria-busy', 'false');
		const photoId = await card.getAttribute('data-photo-id');
		const before = await observe(page, photoId);
		await card.focus(); await page.keyboard.press('Enter'); await openMetadata();
		const dialog = page.getByRole('dialog', { name: copy.edit, exact: true });
		await expect(dialog.getByLabel(copy.filename, { exact: true })).toBeFocused();
		await dialog.getByLabel(copy.filename, { exact: true }).fill('Catalog name.png');
		await dialog.getByLabel(copy.title, { exact: true }).fill('Authored title');
		await dialog.getByLabel(copy.caption, { exact: true }).fill('A caption\nwith two lines');
		await dialog.getByLabel(copy.capture, { exact: true }).fill('2026-10-08T11:12');
		await expect(dialog.getByLabel(copy.offset, { exact: true })).toHaveValue('');
		await dialog.getByRole('button', { name: copy.save, exact: true }).focus(); await page.keyboard.press('Enter');
		await expect(card).toContainText('Catalog name.png');
		await dialog.getByLabel(copy.title, { exact: true }).fill('A second authored title');
		await dialog.getByRole('button', { name: copy.save, exact: true }).focus(); await page.keyboard.press('Enter');
		await expect(dialog.getByLabel(copy.filename, { exact: true })).toBeFocused();
		await expect(dialog.getByRole('alert')).toHaveCount(0);
		await dialog.locator('.lightscaper-dialog-actions').getByRole('button', { name: copy.close, exact: true }).focus(); await page.keyboard.press('Enter');
		await expect(dialog).toHaveCount(0);
		const after = await observe(page, photoId);
		expect(after.metadata.fileName).toBe('Catalog name.png'); expect(after.metadata.title).toBe('A second authored title');
		expect(after.metadata.caption).toBe('A caption\nwith two lines');
		expect(after.metadata.captureTime).toEqual({ local: '2026-10-08T11:12:00.000', offsetMinutes: null });
		expect(after.originalName).toBe(before.originalName); expect(after.extractedMetadata).toEqual(before.extractedMetadata);
		expect(after.storageKey).toBe(before.storageKey); expect(after.sha256).toBe(createHash('sha256').update(PNG).digest('hex'));
		expect(after.bytes).toEqual(Array.from(PNG)); expect(after.revision).toBe(before.revision + 2);
		await page.reload(); await expect(app).toBeVisible();
		await expect(app.locator('[data-photo-library]')).toHaveCount(0);
		await app.locator('summary').filter({ hasText: copy.view }).click();
		await app.getByRole('button', { name: copy.show, exact: true }).click();
		await expect(card).toContainText('Catalog name.png'); await card.focus(); await page.keyboard.press('Enter'); await openMetadata();
		await expect(dialog.getByLabel(copy.title, { exact: true })).toHaveValue('A second authored title');
		await expect(dialog.getByLabel(copy.offset, { exact: true })).toHaveValue('');
		expect(await observe(page, photoId)).toEqual(after);

		async function openMetadata() {
			await app.locator('summary').filter({ hasText: copy.file }).focus(); await page.keyboard.press('Enter');
			await app.locator('summary').filter({ hasText: copy.photo }).focus(); await page.keyboard.press('Enter');
			await app.getByRole('button', { name: copy.edit, exact: true }).focus(); await page.keyboard.press('Enter');
		}
	});
}

async function observe(page, photoId) {
	const result = await build({ entryPoints: [fileURLToPath(new URL('../helpers/lightscaper-photo-library-ui-fixture.ts', import.meta.url))],
		bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
	await page.route('**/__photo_metadata_observation.js', async route => {
		await route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text });
	});
	return page.evaluate(async photoId => {
		const inspector = await import(new URL('/__photo_metadata_observation.js', location.href).href);
		const result = await inspector.readResidentPhotoLibraryV1([photoId]);
		return result.photos[0];
	}, photoId);
}

// Exactly seven <=96KiB browser-encoded JPEGs reuse the existing managed-import
// fixture. Replace its duplicate locally; no fixture writes authored/photo data.
const READ_FACTS_OBSERVER = '/__photo_metadata_read_facts.js';
const READ_FACTS_FIXTURE = (() => {
	const fixture = createPhotoMetadataQueryByteFixtureV1();
	const segment = jpegExif(tiffFixture([numberEntry(0x0112, 1), textEntry(0x010f, '')], [
		numberEntry(0xa001, 1), rationalEntry(0x829a, 0, 1), textEntry(0x9003, '2026:10:07 12:34:56'),
		textEntry(0x9011, '+00:00'),
	]));
	return Object.freeze({ ...fixture, cases: Object.freeze([...fixture.cases.slice(0, 6), Object.freeze({
		id: 'empty-zero', fileName: 'Empty and zero.jpg', appSegments: Object.freeze([Object.freeze(Array.from(segment))]), duplicateOf: null,
	})]) });
})();

for (const locale of ['en', 'de']) {
	test(`${locale}: keyboard native metadata read facts distinguish effective values from immutable EXIF/IPTC alternatives`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'The roadmap defers the full WebKit storage workflow until native Blob/OPFS support is qualified.');
		test.setTimeout(60_000);
		const copy = bundledLightscaperEditorCopyForLocale(locale), errors = [];
		page.on('pageerror', error => { errors.push(error.message); });
		const bundle = await build({ entryPoints: [fileURLToPath(new URL('../helpers/lightscaper-metadata-query-native-fixture.ts', import.meta.url))],
			bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
		await page.route(`**${READ_FACTS_OBSERVER}`, route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
		const origin = JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper;
		await page.goto(`${origin}/${locale}/`);
		const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
		await expect(app.getByRole('dialog')).toHaveCount(0);
		await metadataMenu(page, app, copy.photoFileMenu, copy.photoImportPhotos);
		const importer = page.getByRole('dialog', { name: copy.photoImportPhotos, exact: true });
		const selected = await page.evaluateHandle(async ({ path, fixture }) => {
			const helper = await import(new URL(path, location.href).href);
			return helper.createPhotoMetadataQuerySelectedFilesV1(fixture);
		}, { path: READ_FACTS_OBSERVER, fixture: READ_FACTS_FIXTURE });
		let sources;
		try {
			sources = await selected.evaluate(result => result.sources);
			// Real browser Files enter the chooser's native FileList/change boundary.
			await importer.getByLabel(copy.photoChooseFiles, { exact: true }).evaluate((input, selection) => {
				const transfer = new DataTransfer(); for (const file of selection.files) transfer.items.add(file);
				input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
			}, selected);
		} finally { await selected.dispose(); }
		await metadataKeyboard(page, importer.getByRole('button', { name: copy.photoImportAction, exact: true }));
		await expect(importer).toHaveCount(0);
		const library = app.getByRole('region', { name: locale === 'de' ? 'Fotobibliothek' : 'Photo library', exact: true }), cards = library.locator('[data-photo-id]');
		await expect(cards).toHaveCount(7); await expect(library).toHaveAttribute('aria-busy', 'false');
		const rows = await cards.evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.photoId, name: node.querySelector('strong').textContent })));
		const ids = rows.map(row => row.id), idFor = caseId => rows.find(row => row.name === sourceName(caseId)).id;
		const before = await readFactsObservation(page, ids);
		assertReadFactsOriginals(before, sources);

		let dialog = await openFacts('complete-canon');
		const effective = dialog.getByRole('region', { name: copy.photoEffectiveMetadata, exact: true });
		await expect(metadataFact(effective, copy.photoCameraMake)).toHaveText('Canon');
		await expect(metadataFact(effective, copy.photoIso)).toHaveText('200');
		await expect(metadataFact(effective, copy.photoExposureSeconds)).toHaveText(locale === 'de' ? '0,008' : '0.008');
		await expect(metadataFact(effective, copy.photoAperture)).toHaveText(locale === 'de' ? '2,8' : '2.8');
		await expect(metadataFact(effective, copy.photoModifiedTime)).toHaveText('1970-01-01T00:00:00.000Z');
		await closeFacts(dialog);

		dialog = await openFacts('empty-zero'); await expandSource(dialog);
		const emptyEffective = dialog.getByRole('region', { name: copy.photoEffectiveMetadata, exact: true });
		const zeroExif = dialog.getByRole('region', { name: copy.photoExifMetadata, exact: true });
		await expect(metadataFact(emptyEffective, copy.photoCameraMake)).toHaveJSProperty('textContent', '');
		await expect(metadataFact(emptyEffective, copy.photoCameraModel)).toHaveText(copy.photoMetadataUnknown);
		// Native EXIF accepts zero exposure; the bounded effective photo field rejects it.
		await expect(metadataFact(emptyEffective, copy.photoExposureSeconds)).toHaveText(copy.photoMetadataUnknown);
		await expect(metadataFact(zeroExif, copy.photoExposureSeconds)).toHaveText('0');
		await expect(metadataFact(zeroExif, copy.photoCaptureOffsetMinutes)).toHaveText('0');
		await expect(dialog.getByLabel(copy.photoCaptureOffset, { exact: true })).toHaveValue('0');
		await closeFacts(dialog);

		dialog = await openFacts('partial-capture'); await expandSource(dialog);
		const partial = dialog.getByRole('region', { name: copy.photoExifMetadata, exact: true });
		await expect(dialog.getByLabel(copy.photoCaptureTime, { exact: true })).toHaveValue('');
		await expect(metadataFact(partial, copy.photoCaptureTime)).toHaveText(copy.photoMetadataUnknown);
		await expect(metadataFact(partial, copy.photoCaptureOffsetMinutes)).toHaveText(copy.photoMetadataUnknown);
		await expect(metadataFact(partial, copy.photoRecordedCaptureDateTime)).toHaveJSProperty('textContent', '    :02:29 13:14:15');
		await expect(metadataFact(partial, copy.photoRecordedCaptureOffset)).toHaveJSProperty('textContent', '   :  ');
		await expect(metadataFact(partial, copy.photoRecordedCaptureSubsecond)).toHaveJSProperty('textContent', '123456');
		await closeFacts(dialog);

		dialog = await openFacts('oversized-camera'); await expandSource(dialog);
		await expect(metadataFact(dialog.getByRole('region', { name: copy.photoEffectiveMetadata, exact: true }), copy.photoCameraMake)).toHaveText(copy.photoMetadataUnknown);
		await expect(metadataFact(dialog.getByRole('region', { name: copy.photoExifMetadata, exact: true }), copy.photoCameraMake)).toHaveText('A'.repeat(1_025));
		await closeFacts(dialog);

		dialog = await openFacts('source-conflict'); await expandSource(dialog); await assertAlternatives(dialog, 'IPTC caption');
		await dialog.getByRole('textbox', { name: copy.photoCaption, exact: true }).fill('Authored caption');
		await metadataKeyboard(page, dialog.getByRole('button', { name: copy.photoSaveMetadata, exact: true }));
		await expect(dialog.getByLabel(copy.photoFileName, { exact: true })).toBeFocused();
		await expect(library).toHaveAttribute('aria-busy', 'false');
		await expect(dialog.getByRole('textbox', { name: copy.photoCaption, exact: true })).toHaveValue('Authored caption');
		await expect(dialog.getByRole('alert')).toHaveCount(0);
		await expandSource(dialog); await assertAlternatives(dialog, 'Authored caption'); await closeFacts(dialog);
		const after = await readFactsObservation(page, ids); assertReadFactsOriginals(after, sources);
		expect(after.roots).toEqual(before.roots); expect(after.assets).toEqual(before.assets);
		for (const previous of before.photos) {
			const current = after.photos.find(photo => photo.id === previous.id);
			expect(current.extractedMetadata).toEqual(previous.extractedMetadata); expect(current.original).toEqual(previous.original);
			expect(current.revision).toBe(previous.revision + (previous.id === idFor('source-conflict') ? 1 : 0));
		}
		await page.reload(); await expect(app).toBeVisible(); await expect(app.locator('[data-photo-library]')).toHaveCount(0);
		await metadataMenu(page, app, copy.photoViewMenu, copy.photoShowLibrary);
		await expect(cards).toHaveCount(7); await expect(library).toHaveAttribute('aria-busy', 'false');
		dialog = await openFacts('source-conflict'); await expandSource(dialog); await assertAlternatives(dialog, 'Authored caption');
		expect(await readFactsObservation(page, ids)).toEqual(after); expect(errors).toEqual([]);

		function sourceName(caseId) { return READ_FACTS_FIXTURE.cases.find(item => item.id === caseId).fileName; }
		async function openFacts(caseId) {
			await metadataKeyboard(page, library.getByRole('button', { name: new RegExp(`^${metadataEscaped(sourceName(caseId))}\\s`, 'u') }));
			await metadataMenu(page, app, copy.photoFileMenu, copy.photoEditMetadata, copy.photoPhotoMenu);
			const opened = page.getByRole('dialog', { name: copy.photoEditMetadata, exact: true });
			await expect(opened.getByLabel(copy.photoFileName, { exact: true })).toBeFocused(); return opened;
		}
		async function closeFacts(opened) {
			await metadataKeyboard(page, opened.locator('.lightscaper-dialog-actions').getByRole('button', { name: copy.photoCloseMetadata, exact: true }));
			await expect(opened).toHaveCount(0);
		}
		async function expandSource(opened) {
			const source = opened.locator('summary').filter({ hasText: new RegExp(`^${metadataEscaped(copy.photoOriginalMetadata)}$`, 'u') });
			if (!await opened.getByRole('region', { name: copy.photoExifMetadata, exact: true }).isVisible()) await metadataKeyboard(page, source);
		}
		async function assertAlternatives(opened, caption) {
			await expect(opened.getByRole('textbox', { name: copy.photoCaption, exact: true })).toHaveValue(caption);
			const exif = opened.getByRole('region', { name: copy.photoExifMetadata, exact: true });
			const iptc = opened.getByRole('region', { name: copy.photoIptcMetadata, exact: true });
			await expect(metadataFact(exif, copy.photoCaption)).toHaveText('Exif caption');
			await expect(metadataFact(iptc, copy.photoCaption)).toHaveText('IPTC caption');
			await expect(metadataFact(iptc, copy.photoIptcHeadline)).toHaveText('IPTC headline');
			await expect(metadataFact(iptc, copy.photoCreator).getByRole('listitem')).toHaveText(['IPTC Alice', 'IPTC Bob']);
			await expect(metadataFact(iptc, copy.photoKeywords).getByRole('listitem')).toHaveText(['Landscape', 'Portrait', 'Landscape']);
			await expect(metadataFact(iptc, copy.photoRecordedCaptureDate)).toHaveText('20241007');
			await expect(metadataFact(iptc, copy.photoRecordedCaptureTime)).toHaveText('010203-0430');
		}
	});
}

async function metadataKeyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
async function metadataMenu(page, app, menu, action, submenu = null) {
	await metadataKeyboard(page, app.locator('nav > details > summary').filter({ hasText: new RegExp(`^${metadataEscaped(menu)}$`, 'u') }));
	if (submenu !== null) await metadataKeyboard(page, app.locator('summary').filter({ hasText: new RegExp(`^${metadataEscaped(submenu)}$`, 'u') }));
	await metadataKeyboard(page, app.getByRole('button', { name: action, exact: true }));
}
function metadataEscaped(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
function metadataFact(section, label) { return section.locator('dt').filter({ hasText: new RegExp(`^${metadataEscaped(label)}$`, 'u') }).locator('..').locator('dd'); }
async function readFactsObservation(page, ids) {
	return page.evaluate(async ({ path, ids }) => (await import(new URL(path, location.href).href)).observePhotoMetadataQueryLibraryV1(ids), { path: READ_FACTS_OBSERVER, ids });
}
function assertReadFactsOriginals(observation, sources) {
	expect(observation.photoCount).toBe(7); expect(observation.intent).toBeNull();
	for (const photo of observation.photos) {
		const source = sources.find(item => item.fileName === photo.original.name);
		expect(photo.original).toMatchObject({ mimeType: 'image/jpeg', byteLength: source.byteLength, sha256: source.sha256 });
		expect(photo.actualSha256).toBe(source.sha256); expect(photo.actualBytes).toEqual(source.bytes);
	}
}
