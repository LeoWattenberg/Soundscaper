/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { expect, test } from './helpers/browser-coverage-fixture.js';

// The observation bundle exercises real repositories outside the built graph.
test.use({ browserCoverage: false });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==', 'base64');
const SHA256 = createHash('sha256').update(PNG).digest('hex');

for (const [locale, copy] of [
	['en', { file: 'File', photo: 'Photo', view: 'View', importer: 'Import photos', choose: 'Choose photos', import: 'Import',
		strip: 'Show filmstrip', hideStrip: 'Hide filmstrip', thumbs: 'Show thumbnails', auto: 'Auto advance',
		all: 'Select all photos', clear: 'Clear photo selection', pick: 'Flag: Pick', blue: 'Color label: Blue', show: 'Show photo library' }],
	['de', { file: 'Datei', photo: 'Foto', view: 'Ansicht', importer: 'Fotos importieren', choose: 'Fotos auswählen', import: 'Importieren',
		strip: 'Filmstreifen anzeigen', hideStrip: 'Filmstreifen ausblenden', thumbs: 'Vorschaubilder anzeigen', auto: 'Automatisch weiterschalten',
		all: 'Alle Fotos auswählen', clear: 'Fotoauswahl aufheben', pick: 'Kennzeichnung: Auswahl', blue: 'Farbmarkierung: Blau', show: 'Fotobibliothek anzeigen' }],
]) {
	test(`${locale}: menu filmstrip and page selection reuse previews and advance acknowledged culls without changing originals`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'Full WebKit original storage is deferred; the selection/presenter fixture is qualified separately.');
		test.setTimeout(60_000);
		const origin = JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper;
		const errors = []; page.on('pageerror', error => { errors.push(error.message); });
		await page.goto(`${origin}/${locale}/`);
		const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
		await expect(app.locator('[data-photo-library],canvas')).toHaveCount(0);
		await app.locator('summary').filter({ hasText: copy.file }).click();
		await app.getByRole('button', { name: copy.importer, exact: true }).click();
		const importer = page.getByRole('dialog', { name: copy.importer, exact: true });
		await importer.getByLabel(copy.choose).setInputFiles(['One.png', 'Two.png', 'Three.png'].map(name => ({ name, mimeType: 'image/png', buffer: PNG })));
		await importer.getByRole('button', { name: copy.import, exact: true }).click();
		const library = app.locator('[data-photo-library]'), cards = library.locator('[data-photo-id]');
		await expect(cards).toHaveCount(3); await expect(library).toHaveAttribute('aria-busy', 'false');
		await expect(library).toHaveAttribute('data-photo-layout', 'grid'); await expect(app.locator('canvas')).toHaveCount(0);
		const ids = await cards.evaluateAll(elements => elements.map(element => element.dataset.photoId));
		const before = await observe(page, ids), first = cards.nth(0), second = cards.nth(1), last = cards.nth(2);
		await first.click(); await last.click({ modifiers: ['Control'] });
		await expect(library.locator('[data-photo-id][aria-pressed="true"]')).toHaveCount(2);
		await second.focus(); await expect(first).toHaveAttribute('aria-pressed', 'true'); await expect(last).toHaveAttribute('aria-pressed', 'true');
		await first.click({ modifiers: ['Shift'] }); await expect(library.locator('[data-photo-id][aria-pressed="true"]')).toHaveCount(3);
		await first.press('Control+a'); await expect(library.locator('[data-photo-id][aria-pressed="true"]')).toHaveCount(3);
		await first.press('Escape'); await expect(library.locator('[data-photo-id][aria-pressed="true"]')).toHaveCount(0);
		await choosePhoto(copy.all); await expect(library.locator('[data-photo-id][aria-pressed="true"]')).toHaveCount(3);
		await choosePhoto(copy.clear); await expect(library.locator('[data-photo-id][aria-pressed="true"]')).toHaveCount(0);
		await first.click(); await first.press('End'); await expect(last).toBeFocused(); await expect(last).toHaveAttribute('aria-pressed', 'true');
		await last.press('Home'); await expect(first).toBeFocused();
		await chooseView(copy.strip); await expect(library).toHaveAttribute('data-photo-layout', 'filmstrip');
		await expect(library.locator('ul.lightscaper-photo-grid')).toHaveCSS('overflow-x', 'auto');
		await chooseView(copy.thumbs); await expect(cards.locator('canvas')).toHaveCount(3); await expect(app.locator('canvas')).toHaveCount(3);
		await choosePhoto(copy.auto); await first.focus(); await first.press('5');
		await expect(second).toBeFocused(); await expect(second).toHaveAttribute('aria-pressed', 'true');
		await choosePhoto(copy.pick); await expect(last).toBeFocused(); await expect(last).toHaveAttribute('aria-pressed', 'true');
		await choosePhoto(copy.blue); await expect(last).toHaveAttribute('data-photo-color-label', 'blue');
		await expect(last).toHaveAttribute('aria-pressed', 'true');
		await first.click(); await last.click({ modifiers: ['Control'] }); await first.focus(); await first.press('3');
		await expect(library).toHaveAttribute('aria-busy', 'false'); await expect(first).toBeFocused();
		await expect(library.locator('[data-photo-id][aria-pressed="true"]')).toHaveCount(2);
		const after = await observe(page, ids);
		expect(after.photos[0].rating).toBe(3); expect(after.photos[1].flag).toBe('pick'); expect(after.photos[2].colorLabel).toBe('blue');
		for (let index = 0; index < 3; index++) {
			for (const key of ['originalId', 'storageKey', 'sha256', 'byteLength', 'originalName', 'extractedMetadata', 'bytes']) expect(after.photos[index][key]).toEqual(before.photos[index][key]);
			expect(after.photos[index].sha256).toBe(SHA256); expect(after.photos[index].bytes).toEqual(Array.from(PNG));
		}
		await chooseView(copy.hideStrip); await expect(library).toHaveAttribute('data-photo-layout', 'grid');
		await page.reload(); await expect(app).toBeVisible(); await expect(app.locator('[data-photo-library],canvas')).toHaveCount(0);
		await chooseView(copy.show); await expect(cards).toHaveCount(3); await expect(library).toHaveAttribute('data-photo-layout', 'grid');
		expect(await observe(page, ids)).toEqual(after); expect(errors).toEqual([]);

		async function chooseView(label) {
			await app.locator('summary').filter({ hasText: copy.view }).focus(); await page.keyboard.press('Enter');
			await choose(label);
		}
		async function choosePhoto(label) {
			await app.locator('summary').filter({ hasText: copy.file }).focus(); await page.keyboard.press('Enter');
			await app.locator('summary').filter({ hasText: copy.photo }).focus(); await page.keyboard.press('Enter');
			await choose(label);
		}
		async function choose(label) {
			const button = app.getByRole('button', { name: label, exact: true }); await expect(button).toBeEnabled();
			await button.focus(); await expect(button).toBeFocused(); await page.keyboard.press('Enter');
		}
	});
}

async function observe(page, photoIds) {
	const result = await build({ entryPoints: [fileURLToPath(new URL('../helpers/lightscaper-photo-library-ui-fixture.ts', import.meta.url))],
		bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
	await page.route('**/__photo_culling_observation.js', async route => {
		await route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text });
	});
	return page.evaluate(async ids => {
		const inspector = await import(new URL('/__photo_culling_observation.js', location.href).href);
		return inspector.readResidentPhotoLibraryV1(ids);
	}, photoIds);
}
