/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { expect, test } from './helpers/browser-coverage-fixture.js';

test.use({ browserCoverage: false });
const copies = [
	['en', { view: 'View', query: 'Search, filter and sort', search: 'Search text', filter: 'Filter', sort: 'Sort by', direction: 'Sort direction',
		apply: 'Apply query', next: 'Next page', library: 'Photo library', build: 'Prepare search index', required: 'Prepare the search index before searching this library.' }],
	['de', { view: 'Ansicht', query: 'Suchen, filtern und sortieren', search: 'Suchtext', filter: 'Filter', sort: 'Sortieren nach', direction: 'Sortierrichtung',
		apply: 'Suche anwenden', next: 'Nächste Seite', library: 'Fotobibliothek', build: 'Suchindex vorbereiten', required: 'Bereite den Suchindex vor, bevor du diese Bibliothek durchsuchst.' }],
];

for (const [locale, copy] of copies) {
	test(`${locale}: menu queries globally sort, drain sparse steps, navigate paged definitions and update live smart collections`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'The roadmap defers the full WebKit storage workflow until native Blob/OPFS support is qualified.');
		test.setTimeout(90_000);
		const { app, fixture } = await setup(page, locale), errors = [];
		page.on('pageerror', error => { errors.push(error.message); });
		await expect(app.locator('[data-photo-library]')).toHaveCount(0);
		await expect(app.getByRole('dialog')).toHaveCount(0);
		const library = app.getByRole('region', { name: copy.library, exact: true });
		const dialog = page.getByRole('dialog', { name: copy.query, exact: true });
		await openQuery();
		await expect(dialog.getByLabel(copy.search, { exact: true })).toBeFocused();
		await dialog.getByRole('combobox', { name: copy.sort, exact: true }).selectOption('file-name');
		await apply();
		await expect(library.locator('[data-photo-id]')).toHaveCount(64);
		await expect(library.locator('[data-photo-id]').first()).toHaveAttribute('data-photo-id', fixture.filenameAscendingFirst);
		await closeQuery(); await nextPage();
		await expect(library.locator('[data-photo-id]')).toHaveCount(16);
		await expect(library.locator('[data-photo-id]').last()).toHaveAttribute('data-photo-id', fixture.filenameAscendingLast);

		await openQuery();
		await dialog.getByLabel(copy.search, { exact: true }).fill('Sparse token');
		await dialog.getByRole('combobox', { name: copy.sort, exact: true }).selectOption('photo-id');
		await apply(); await expect(library.locator('[data-photo-id]')).toHaveCount(1);
		await expect(library.locator('[data-photo-id]')).toHaveAttribute('data-photo-id', fixture.sparsePhotoId);
		await closeQuery(); await openQuery();
		await dialog.getByLabel(copy.search, { exact: true }).fill('');
		await dialog.getByRole('combobox', { name: copy.filter, exact: true }).selectOption('folder');
		const selector = dialog.locator('[data-definition-selector="folder"]');
		await expect(selector.locator('[data-definition-id]')).toHaveCount(64);
		await selector.locator('[data-definition-next]').focus(); await page.keyboard.press('Enter');
		await expect(selector.locator('[data-definition-id]')).toHaveCount(6);
		await selector.locator('[data-definition-open="folder-069"]').click();
		await expect(selector.locator('[data-definition-parent]')).toHaveText('Folder 069');
		await selector.locator('[data-definition-up]').click();
		await expect(selector.locator('[data-definition-id]')).toHaveCount(64);
		await selector.locator('[data-definition-next]').click(); await selector.locator('[data-definition-open="folder-069"]').click();
		await chooseDefinition('nested-folder');
		await apply(); await expect(library.locator('[data-photo-id]')).toHaveCount(1);
		await expect(library.locator('[data-photo-id]')).toHaveAttribute('data-photo-id', fixture.sparsePhotoId);
		await closeQuery(); await openQuery();
		await dialog.getByRole('combobox', { name: copy.filter, exact: true }).selectOption('keyword');
		await dialog.locator('[data-definition-choose="landscape"]').click();
		await apply(); await expect(library.locator('[data-photo-id]')).toHaveCount(32);
		await closeQuery(); await nextPage(); await expect(library.locator('[data-photo-id]')).toHaveCount(8);
		await openQuery();
		await dialog.getByRole('combobox', { name: copy.filter, exact: true }).selectOption('collection');
		await dialog.locator('[data-definition-choose="manual"]').click();
		await apply(); await expect(library.locator('[data-photo-id]')).toHaveCount(22);
		await closeQuery(); await nextPage(); await expect(library.locator('[data-photo-id]')).toHaveCount(5);
		await openQuery();
		await chooseDefinition('smart');
		await apply(); await expect(library.locator('[data-photo-id]')).toHaveCount(fixture.smartFirstPageCount);
		await expect(library.locator('[data-photo-id]').first()).toHaveAttribute('data-photo-id', fixture.smartFirst);
		await closeQuery(); await nextPage();
		await expect(library.locator('[data-photo-id]')).toHaveCount(fixture.smartCount - fixture.smartFirstPageCount);
		await openQuery(); await apply(); await closeQuery();
		const firstSmart = library.locator(`[data-photo-id="${fixture.smartFirst}"]`);
		await firstSmart.focus(); await page.keyboard.press('0');
		await expect(library.locator('[data-photo-id]')).toHaveCount(fixture.smartFirstPageCount - 1);
		await expect(firstSmart).toHaveCount(0);
		const retained = await observe(page, [fixture.smartFirst, fixture.sparsePhotoId]);
		for (const original of retained) { expect(original.actualSha256).toBe(fixture.originalSha256); expect(original.expectedSha256).toBe(fixture.originalSha256); }
		expect(retained[0].rating).toBe(0);

		await openQuery(); await dialog.getByRole('combobox', { name: copy.filter, exact: true }).selectOption('');
		await dialog.getByRole('combobox', { name: copy.sort, exact: true }).selectOption('capture-time');
		await dialog.getByRole('combobox', { name: copy.direction, exact: true }).selectOption('descending');
		await apply(); await expect(library.locator('[data-photo-id]')).toHaveCount(53);
		await expect(library.locator('[data-photo-id]').first()).toHaveAttribute('data-photo-id', 'query-photo-055');
		await closeQuery(); await nextPage();
		await expect(library.locator('[data-photo-id]')).toHaveCount(27);
		const unknownIds = await library.locator('[data-photo-id]').evaluateAll(elements => elements.map(element => element.dataset.photoId));
		expect(unknownIds.every(id => Number(id.slice(-3)) % 3 === 0)).toBe(true);
		expect(errors).toEqual([]);

		async function openQuery() {
			await app.locator('summary').filter({ hasText: copy.view }).focus(); await page.keyboard.press('Enter');
			await app.getByRole('button', { name: copy.query, exact: true }).focus(); await page.keyboard.press('Enter');
			await expect(dialog).toBeVisible(); await expect(dialog.locator('[data-query-close]')).toBeEnabled();
		}
		async function apply() {
			const applyButton = dialog.getByRole('button', { name: copy.apply, exact: true });
			await expect(applyButton).toBeEnabled(); await applyButton.focus(); await expect(applyButton).toBeFocused(); await page.keyboard.press('Enter');
			await expect(library).toHaveAttribute('aria-busy', 'false'); await expect(dialog.getByRole('alert')).toHaveCount(0);
		}
		async function chooseDefinition(id) {
			const choice = dialog.locator(`[data-definition-choose="${id}"]`);
			await expect(choice).toBeEnabled(); await choice.focus(); await expect(choice).toBeFocused(); await page.keyboard.press('Enter');
			await expect(choice).toHaveAttribute('aria-pressed', 'true');
		}
		async function closeQuery() { await dialog.locator('[data-query-close]').focus(); await page.keyboard.press('Enter'); await expect(dialog).toHaveCount(0); }
		async function nextPage() {
			await app.locator('summary').filter({ hasText: copy.view }).click();
			await app.getByRole('button', { name: copy.next, exact: true }).focus(); await page.keyboard.press('Enter');
		}
	});
}

test('search index rebuilding requires explicit menu demand and leaves retained originals unchanged', async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'The roadmap defers the full WebKit storage workflow until native Blob/OPFS support is qualified.');
	test.setTimeout(90_000);
	const { app, fixture } = await setup(page, 'en'), copy = copies[0][1];
	await page.evaluate(async catalogId => {
		const api = await import(new URL('/__lightscaper_photo_query_fixture.js', location.href).href); await api.invalidatePhotoLibraryQueryIndexNativeV1(catalogId);
	}, fixture.catalogId);
	await app.locator('summary').filter({ hasText: copy.view }).click(); await app.getByRole('button', { name: copy.query, exact: true }).click();
	const dialog = page.getByRole('dialog', { name: copy.query, exact: true });
	await expect(dialog.getByText(copy.required, { exact: true })).toBeVisible();
	await expect(dialog.getByRole('button', { name: copy.apply, exact: true })).toBeDisabled();
	await expect(app.locator('[data-photo-library]')).toHaveCount(0);
	await dialog.getByRole('button', { name: copy.build, exact: true }).focus(); await page.keyboard.press('Enter');
	await expect(dialog.getByRole('button', { name: copy.apply, exact: true })).toBeEnabled({ timeout: 20_000 });
	await dialog.getByRole('button', { name: copy.apply, exact: true }).click();
	await expect(app.locator('[data-photo-id]')).toHaveCount(64);
	const originals = await observe(page, [fixture.sparsePhotoId]);
	expect(originals[0].actualSha256).toBe(fixture.originalSha256); expect(originals[0].revision).toBe(0);
});

async function setup(page, locale) {
	const result = await build({ entryPoints: [fileURLToPath(new URL('../helpers/lightscaper-photo-query-native-fixture.ts', import.meta.url))],
		bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
	await page.route('**/__lightscaper_photo_query_fixture.js', async route => {
		await route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0].text });
	});
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS
		? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper
		: browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`);
	const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
	const fixture = await page.evaluate(async () => {
		const api = await import(new URL('/__lightscaper_photo_query_fixture.js', location.href).href); return api.seedPhotoLibraryQueryNativeV1();
	});
	return { app, fixture };
}
async function observe(page, photoIds) {
	return page.evaluate(async ids => {
		const api = await import(new URL('/__lightscaper_photo_query_fixture.js', location.href).href); return api.readPhotoLibraryQueryOriginalsNativeV1(ids);
	}, photoIds);
}
