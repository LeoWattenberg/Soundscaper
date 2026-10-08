/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './helpers/browser-coverage-fixture.js';

// Independently encoded 2×3 RGBA: red/green, blue/transparent, half-alpha blue/yellow.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAHElEQVR4nGP4z8DwHwyB9P/qV7pAuuF//X+gCACcuAyINRgO7QAAAABJRU5ErkJggg==', 'base64');
for (const [locale, copy] of [
	['en', { file: 'File', view: 'View', importer: 'Import photos', choose: 'Choose photos', import: 'Import',
		thumbs: 'Show thumbnails', hideThumbs: 'Hide thumbnails', loupe: 'Show loupe', hideLoupe: 'Hide loupe', library: 'Photo library', show: 'Show photo library' }],
	['de', { file: 'Datei', view: 'Ansicht', importer: 'Fotos importieren', choose: 'Fotos auswählen', import: 'Importieren',
		thumbs: 'Vorschaubilder anzeigen', hideThumbs: 'Vorschaubilder ausblenden', loupe: 'Lupe anzeigen', hideLoupe: 'Lupe ausblenden', library: 'Fotobibliothek', show: 'Fotobibliothek anzeigen' }],
]) {
	test(`${locale}: imported pixels remain absent until View enables thumbnails or the selected loupe`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'The full WebKit original-storage workflow remains deferred; native presenter/caches are qualified separately.');
		const origin = JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper;
		const errors = []; page.on('pageerror', error => { errors.push(error.message); });
		await page.goto(`${origin}/${locale}/`);
		const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
		await expect(app.locator('canvas')).toHaveCount(0);
		await app.locator('summary').filter({ hasText: copy.file }).click();
		await app.getByRole('button', { name: copy.importer, exact: true }).click();
		const importer = page.getByRole('dialog', { name: copy.importer, exact: true });
		await importer.getByLabel(copy.choose).setInputFiles({ name: 'Asymmetric.png', mimeType: 'image/png', buffer: PNG });
		await importer.getByRole('button', { name: copy.import, exact: true }).click();
		const card = app.locator('[data-photo-id]'); await expect(card).toHaveCount(1);
		await expect(app.locator('[data-photo-library]')).toHaveAttribute('aria-busy', 'false');
		await card.focus(); await expect(app.locator('canvas')).toHaveCount(0);
		await chooseView(copy.thumbs);
		const thumbnail = card.locator('canvas'); await expect(thumbnail).toHaveAttribute('width', '2');
		await expect(thumbnail).toHaveAttribute('height', '3');
		await expect(thumbnail).toHaveAccessibleName('Asymmetric.png'); await assertPixels(thumbnail);
		await chooseView(copy.loupe);
		const loupe = app.locator('[data-photo-loupe] canvas'); await expect(loupe).toHaveAttribute('width', '2');
		await expect(loupe).toHaveAttribute('height', '3'); await assertPixels(loupe);
		await chooseView(copy.hideThumbs); await expect(card.locator('canvas')).toHaveCount(0);
		await expect(loupe).toBeVisible();
		await chooseView(copy.hideLoupe); await expect(app.locator('canvas')).toHaveCount(0);
		await page.reload(); await expect(app).toBeVisible(); await expect(app.locator('canvas')).toHaveCount(0);
		await chooseView(copy.show); await expect(card).toHaveCount(1); await expect(app.locator('canvas')).toHaveCount(0);
		await card.focus(); await chooseView(copy.thumbs); await expect(thumbnail).toHaveAttribute('width', '2');
		await assertPixels(thumbnail); expect(errors).toEqual([]);

		async function chooseView(label) {
			await app.locator('summary').filter({ hasText: copy.view }).focus(); await page.keyboard.press('Enter');
			await app.getByRole('button', { name: label, exact: true }).focus(); await page.keyboard.press('Enter');
		}
		async function assertPixels(canvas) {
			const pixels = await canvas.evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, 2, 3).data));
			expect(pixels.slice(0, 16)).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0]);
			expect(pixels.slice(20)).toEqual([255, 255, 0, 255]); expect(pixels[19]).toBe(127);
			expect(pixels[16]).toBe(0); expect(Math.abs(pixels[17] - 128)).toBeLessThanOrEqual(2); expect(pixels[18]).toBe(255);
		}
	});
}
