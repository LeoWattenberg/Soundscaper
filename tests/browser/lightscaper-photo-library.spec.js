/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { expect, test } from './helpers/browser-coverage-fixture.js';

test.use({ browserCoverage: false });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==', 'base64');
const SHA256 = createHash('sha256').update(PNG).digest('hex');

for (const [locale, copy] of [
	['en', { file: 'File', view: 'View', photo: 'Photo', importPhotos: 'Import photos', choose: 'Choose photos', import: 'Import', show: 'Show photo library',
		library: 'Photo library', rate: 'Rate 5 stars', rating: 'Rating: 5', flagPick: 'Flag: Pick', labelBlue: 'Color label: Blue' }],
	['de', { file: 'Datei', view: 'Ansicht', photo: 'Foto', importPhotos: 'Fotos importieren', choose: 'Fotos auswählen', import: 'Importieren', show: 'Fotobibliothek anzeigen',
		library: 'Fotobibliothek', rate: 'Mit 5 Sternen bewerten', rating: 'Bewertung: 5', flagPick: 'Kennzeichnung: Auswahl', labelBlue: 'Farbmarkierung: Blau' }],
]) {
	test(`${locale}: menu import reports failed files, dedupes originals, rates from the keyboard and reopens the durable library`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'The roadmap defers the full WebKit storage workflow until native Blob/OPFS support is qualified.');
		test.setTimeout(60_000);
		const origin = JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper;
		const errors = [];
		page.on('pageerror', error => { errors.push(error.message); });
		await page.goto(`${origin}/${locale}/`);
		const app = page.locator('[data-lightscaper-bound="true"]');
		await expect(app).toBeVisible();
		await expect(app.locator('[data-photo-library]')).toHaveCount(0);
		await expect(app.locator('input')).toHaveCount(0);
		const file = app.locator('summary').filter({ hasText: copy.file });
		await file.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
		await expect(app.getByRole('button', { name: copy.importPhotos, exact: true })).toBeFocused();
		await page.keyboard.press('Enter');
		const dialog = page.getByRole('dialog', { name: copy.importPhotos, exact: true });
		await expect(dialog).toBeVisible();
		await dialog.getByLabel(copy.choose).setInputFiles([
			{ name: 'Broken.png', mimeType: 'image/png', buffer: Buffer.from('Invalid image') },
			{ name: 'First.png', mimeType: 'image/png', buffer: PNG },
			{ name: 'Second.png', mimeType: 'image/png', buffer: PNG },
		]);
		await dialog.getByRole('button', { name: copy.import, exact: true }).focus();
		await page.keyboard.press('Enter');
		const library = app.getByRole('region', { name: copy.library, exact: true });
		await expect(library.locator('[data-photo-import-status="imported"]')).toHaveCount(2, { timeout: 20_000 });
		await expect(library.locator('[data-photo-import-status="failed"]')).toHaveCount(1);
		await expect(library.locator('[data-photo-count]')).toHaveAttribute('data-photo-count', '2');
		await expect(library.getByRole('alert')).toHaveCount(0);
		const first = library.getByRole('button').filter({ hasText: 'First.png' });
		await first.focus(); await page.keyboard.press('5');
		await expect(first).toContainText(copy.rating);
		await app.locator('summary').filter({ hasText: copy.file }).click();
		await app.locator('summary').filter({ hasText: copy.photo }).click();
		await expect(app.getByRole('button', { name: copy.rate, exact: true })).toBeEnabled();
		await app.getByRole('button', { name: copy.flagPick, exact: true }).focus(); await page.keyboard.press('Enter');
		await expect(first).toHaveAttribute('data-photo-flag', 'pick');
		await app.locator('summary').filter({ hasText: copy.file }).click();
		await app.locator('summary').filter({ hasText: copy.photo }).click();
		await app.getByRole('button', { name: copy.labelBlue, exact: true }).focus(); await page.keyboard.press('Enter');
		await expect(first).toHaveAttribute('data-photo-color-label', 'blue');
		const ids = await library.locator('[data-photo-id]').evaluateAll(elements => elements.map(element => element.dataset.photoId));
		const before = await observeLibrary(page, ids);
		expect(before.root.photoCount).toBe(2);
		const picked = before.photos.find(photo => photo.fileName === 'First.png');
		expect(picked.flag).toBe('pick'); expect(picked.colorLabel).toBe('blue');
		expect(new Set(before.photos.map(photo => photo.originalId)).size).toBe(2);
		expect(new Set(before.photos.map(photo => photo.storageKey)).size).toBe(1);
		for (const photo of before.photos) {
			expect(photo.sha256).toBe(SHA256); expect(photo.byteLength).toBe(PNG.length); expect(photo.bytes).toEqual(Array.from(PNG));
		}
		await page.reload(); await expect(app).toBeVisible();
		await expect(app.locator('[data-photo-library]')).toHaveCount(0);
		await app.locator('summary').filter({ hasText: copy.view }).click();
		await app.getByRole('button', { name: copy.show, exact: true }).focus(); await page.keyboard.press('Enter');
		await expect(first).toContainText(copy.rating);
		const after = await observeLibrary(page, ids);
		expect(after).toEqual(before); expect(errors).toEqual([]);
	});
}

test('a keyboard rating on the second library page retains the selected photo and focus', async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'The roadmap defers the full WebKit storage workflow until native Blob/OPFS support is qualified.');
	test.setTimeout(90_000);
	const origin = JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper;
	await page.goto(`${origin}/en/`);
	const app = page.locator('[data-lightscaper-bound="true"]');
	const library = app.getByRole('region', { name: 'Photo library', exact: true });
	for (const [offset, count] of [[0, 64], [64, 1]]) {
		await app.locator('summary').filter({ hasText: 'File' }).click();
		await app.getByRole('button', { name: 'Import photos', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Import photos', exact: true });
		await dialog.getByLabel('Choose photos').setInputFiles(Array.from({ length: count }, (_, index) => ({
			name: `Photo-${String(offset + index).padStart(2, '0')}.png`, mimeType: 'image/png', buffer: PNG,
		})));
		await dialog.getByRole('button', { name: 'Import', exact: true }).click();
		await expect(library.locator('[data-photo-count]')).toHaveAttribute('data-photo-count', String(offset + count), { timeout: 30_000 });
		await expect(library).toHaveAttribute('aria-busy', 'false');
	}
	await expect(library.locator('[data-photo-id]')).toHaveCount(64);
	await app.locator('summary').filter({ hasText: 'View' }).click();
	await app.getByRole('button', { name: 'Next page', exact: true }).focus();
	await page.keyboard.press('Enter');
	await expect(library.locator('[data-photo-id]')).toHaveCount(1);
	const last = library.locator('[data-photo-id]');
	const id = await last.getAttribute('data-photo-id');
	await last.focus(); await page.keyboard.press('5');
	await expect(last).toContainText('Rating: 5');
	await expect(last).toBeFocused();
	await expect(last).toHaveAttribute('data-photo-id', id);
	await expect(library.locator('[data-photo-id]')).toHaveCount(1);
	await expect(library.locator('[data-photo-count]')).toHaveAttribute('data-photo-count', '65');
	const saved = await observeLibrary(page, [id]);
	expect(saved.photos[0].rating).toBe(5);
	expect(saved.photos[0].sha256).toBe(SHA256);
	expect(saved.photos[0].bytes).toEqual(Array.from(PNG));
});

async function observeLibrary(page, photoIds) {
	const result = await build({ entryPoints: [fileURLToPath(new URL('../helpers/lightscaper-photo-library-ui-fixture.ts', import.meta.url))],
		bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
	await page.route('**/__photo_library_ui_observation.js', async route => {
		await route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text });
	});
	return page.evaluate(async photoIds => {
		const inspector = await import(new URL('/__photo_library_ui_observation.js', location.href).href);
		return inspector.readResidentPhotoLibraryV1(photoIds);
	}, photoIds);
}
