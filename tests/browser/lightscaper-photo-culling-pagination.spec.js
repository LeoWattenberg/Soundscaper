/* SPDX-License-Identifier: AGPL-3.0-only */

import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { expect, test, installNativeImageHandoffRuntime, seedNativePhotoCullingLibrary,
	observeNativePhotoCullingOriginals } from './helpers/lightscaper-image-handoff-native-fixture.js';

for (const locale of ['en', 'de']) {
	test(`${locale}: plain culling crosses a real 64-row boundary after an earlier manual rating`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'The roadmap defers native WebKit Blob/OPFS catalog workflows.'); test.setTimeout(120_000);
		const { app, copy, fixture, errors } = await open(page, locale);
		await view(page, app, copy, copy.photoShowLibrary);
		const library = app.locator('[data-photo-library]'), cards = library.locator('[data-photo-id]');
		await expect(cards).toHaveCount(64);
		const first = card(library, 0), edge = card(library, 63), next = card(library, 64);
		const before = await observeNativePhotoCullingOriginals(page, [id(0), id(63), id(64), id(65)]);
		await first.click(); await first.press('5'); await expect(first).toBeFocused(); await expect(first).toContainText(`${copy.photoRating}: 5`);
		await expect(cards).toHaveCount(64); await expect(edge).toHaveCount(1);
		await auto(page, app, copy); await edge.click(); await edge.press('4');
		await expect(next).toBeFocused(); await expect(next).toHaveAttribute('aria-pressed', 'true');
		await expect(cards).toHaveCount(16); await expect(cards.first()).toHaveAttribute('data-photo-id', id(64));
		await next.press('3'); await expect(card(library, 65)).toBeFocused(); await expect(card(library, 65)).toHaveAttribute('aria-pressed', 'true');
		await retained(page, before, fixture, { [id(0)]: 5, [id(63)]: 4, [id(64)]: 3 });
		expect(errors).toEqual([]);
	});

	test(`${locale}: filename query culling retains its pre-edit next photo across the page boundary`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'The roadmap defers native WebKit Blob/OPFS catalog workflows.'); test.setTimeout(120_000);
		const { app, copy, fixture, errors } = await open(page, locale);
		await view(page, app, copy, copy.photoQueryTitle);
		const dialog = named(page, 'dialog', copy.photoQueryTitle), library = app.locator('[data-photo-library]');
		await named(dialog, 'combobox', copy.photoQuerySort).selectOption('file-name');
		await keyboard(page, named(dialog, 'button', copy.photoQueryApply)); await expect(library).toHaveAttribute('aria-busy', 'false');
		await keyboard(page, dialog.locator('[data-query-close]')); await expect(dialog).toHaveCount(0);
		const cards = library.locator('[data-photo-id]'); await expect(cards).toHaveCount(64);
		await expect(cards.first()).toHaveAttribute('data-photo-id', fixture.filenameAscendingFirst);
		await expect(cards.last()).toHaveAttribute('data-photo-id', id(16));
		const before = await observeNativePhotoCullingOriginals(page, [id(79), id(16), id(15), id(14)]);
		await auto(page, app, copy); const first = card(library, 79); await first.click(); await first.press('3');
		await expect(card(library, 78)).toBeFocused(); await expect(cards).toHaveCount(64); await expect(first).toHaveCount(1);
		const edge = card(library, 16); await edge.click(); await edge.press('5');
		const next = card(library, 15); await expect(next).toBeFocused(); await expect(next).toHaveAttribute('aria-pressed', 'true');
		await expect(cards).toHaveCount(16); await expect(cards.first()).toHaveAttribute('data-photo-id', id(15));
		await next.press('4'); await expect(card(library, 14)).toBeFocused(); await expect(card(library, 14)).toHaveAttribute('aria-pressed', 'true');
		await expect(card(library, 79)).toHaveCount(0);
		await retained(page, before, fixture, { [id(79)]: 3, [id(16)]: 5, [id(15)]: 4 }); expect(errors).toEqual([]);
	});
}

async function open(page, locale) {
	const errors = []; page.on('pageerror', error => { errors.push(error.message); });
	await installNativeImageHandoffRuntime(page);
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/${locale}/`); const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
	await expect(app.locator('[data-photo-library],canvas')).toHaveCount(0);
	const fixture = await seedNativePhotoCullingLibrary(page); expect(fixture.count).toBe(80);
	return { app, copy: bundledLightscaperEditorCopyForLocale(locale), fixture, errors };
}
async function retained(page, before, fixture, ratings) {
	const after = await observeNativePhotoCullingOriginals(page, before.map(row => row.photoId));
	for (let index = 0; index < after.length; index++) {
		const row = after[index], previous = before[index];
		expect(row.actualSha256).toBe(fixture.originalSha256); expect(row.expectedSha256).toBe(previous.expectedSha256); expect(row.byteLength).toBe(previous.byteLength);
		expect(row.rating).toBe(ratings[row.photoId] ?? previous.rating);
		expect(row.revision).toBe(previous.revision + (Object.hasOwn(ratings, row.photoId) ? 1 : 0));
	}
}
function id(index) { return `query-photo-${String(index).padStart(3, '0')}`; }
function card(library, index) { return library.locator(`[data-photo-id="${id(index)}"]`); }
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
async function menu(page, app, name) { await keyboard(page, app.getByRole('navigation').getByText(name, { exact: true })); }
async function view(page, app, copy, action) { await menu(page, app, copy.photoViewMenu); await keyboard(page, named(app, 'button', action)); }
async function auto(page, app, copy) {
	await menu(page, app, copy.photoFileMenu); await menu(page, app, copy.photoPhotoMenu);
	const control = named(app, 'button', copy.photoAutoAdvance); await expect(control).toHaveAttribute('aria-pressed', 'false');
	await keyboard(page, control);
}
