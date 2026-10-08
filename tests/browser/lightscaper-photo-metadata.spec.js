/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
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
		await card.focus(); await openMetadata();
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
		await expect(card).toContainText('Catalog name.png'); await card.focus(); await openMetadata();
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
