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

	test(`${locale}: saved metadata filter culling crosses the page boundary and survives explicit Use after reload`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'The roadmap defers native WebKit Blob/OPFS catalog workflows.'); test.setTimeout(120_000);
		const { app, copy, fixture, errors } = await open(page, locale);
		await view(page, app, copy, copy.photoShowLibrary);
		const library = app.locator('[data-photo-library]'), cards = library.locator('[data-photo-id]');
		await expect(cards).toHaveCount(64);
		await view(page, app, copy, copy.photoSaveCurrentFilter);
		const dialog = named(page, 'dialog', copy.photoSavedFiltersTitle), filterName = `${locale} unflagged two-pixel photos`;
		await expect(named(dialog, 'button', copy.photoSavedFilterNew)).toBeEnabled();
		await named(dialog, 'textbox', copy.photoSavedFilterName).fill(filterName);
		await choose(page, named(dialog, 'combobox', copy.photoQueryFilter), 'flag');
		await choose(page, named(dialog, 'combobox', copy.photoFlag), 'unflagged');
		await choose(page, named(dialog, 'combobox', copy.photoQuerySort), 'file-name');
		await choose(page, named(dialog, 'combobox', copy.photoQueryDirection), 'ascending');
		await keyboard(page, named(dialog, 'button', copy.photoMetadataAddCondition));
		const condition = named(dialog, 'group', '1');
		await choose(page, named(condition, 'combobox', copy.photoMetadataColumn), 'width');
		await named(condition, 'spinbutton', copy.photoMetadataMinimum).fill('2');
		await named(condition, 'spinbutton', copy.photoMetadataMaximum).fill('2');
		await keyboard(page, named(dialog, 'button', copy.photoSavedFilterSave));
		await expect(dialog.locator('[data-saved-receipt]')).toHaveText(copy.photoSavedFilterSaved);
		await keyboard(page, named(dialog, 'button', copy.photoSavedFilterUse));
		await expectIds(library, descending(79, 16)); await closeSaved(page, dialog, copy);
		const before = await observeNativePhotoCullingOriginals(page, [id(79), id(17), id(16), id(15), id(14)]);
		await auto(page, app, copy); await keyboard(page, card(library, 16));
		await photo(page, app, copy, `${copy.photoFlag}: ${copy.photoPick}`);
		const next = card(library, 15);
		await expect(next).toBeFocused(); await expect(next).toHaveAttribute('aria-pressed', 'true');
		await expectIds(library, descending(15, 0)); await expect(card(library, 16)).toHaveCount(0);
		await next.press('4'); await expect(card(library, 14)).toBeFocused();
		await expect(card(library, 14)).toHaveAttribute('aria-pressed', 'true'); await expectIds(library, descending(15, 0));
		await page.reload(); await expect(app).toBeVisible(); await expect(app.locator('[data-photo-library],canvas')).toHaveCount(0);
		await view(page, app, copy, copy.photoSavedFiltersTitle);
		const restored = named(page, 'dialog', copy.photoSavedFiltersTitle), selection = named(restored, 'radio', filterName);
		await expect(selection).toBeEnabled(); await selection.focus(); await page.keyboard.press('Space'); await expect(selection).toBeChecked();
		await keyboard(page, named(restored, 'button', copy.photoSavedFilterLoad));
		await expect(named(restored, 'textbox', copy.photoSavedFilterName)).toHaveValue(filterName);
		await expect(named(restored, 'combobox', copy.photoQueryFilter)).toHaveValue('flag');
		await expect(named(restored, 'combobox', copy.photoFlag)).toHaveValue('unflagged');
		await expect(named(restored, 'combobox', copy.photoQuerySort)).toHaveValue('file-name');
		await expect(named(restored, 'combobox', copy.photoQueryDirection)).toHaveValue('ascending');
		const restoredCondition = named(restored, 'group', '1');
		await expect(named(restoredCondition, 'combobox', copy.photoMetadataColumn)).toHaveValue('width');
		await expect(named(restoredCondition, 'spinbutton', copy.photoMetadataMinimum)).toHaveValue('2');
		await expect(named(restoredCondition, 'spinbutton', copy.photoMetadataMaximum)).toHaveValue('2');
		await keyboard(page, named(restored, 'button', copy.photoSavedFilterUse));
		// Excluded photo016 still consumes one of the saved scanner's 64 candidate reads.
		await expectIds(library, descending(79, 17)); await expect(card(library, 16)).toHaveCount(0);
		await closeSaved(page, restored, copy); await view(page, app, copy, copy.photoNextPage);
		await expectIds(library, descending(15, 0)); await expect(card(library, 15)).toContainText(`${copy.photoRating}: 4`);
		await view(page, app, copy, copy.photoSavedFiltersTitle);
		const all = named(page, 'dialog', copy.photoSavedFiltersTitle);
		await keyboard(page, named(all, 'button', copy.photoSavedFilterShowAll));
		await expectIds(library, ascending(0, 63));
		await expect(card(library, 16)).toHaveAttribute('data-photo-flag', 'pick');
		await expect(card(library, 16)).toContainText(copy.photoPick); await closeSaved(page, all, copy);
		await retained(page, before, fixture, { [id(15)]: 4 }, [id(16)]); expect(errors).toEqual([]);
	});

	test(`${locale}: collapsed stack culling crosses its audited page boundary and skips the hidden member`, async ({ page, browserName }) => {
		test.skip(browserName === 'webkit', 'The roadmap defers native WebKit Blob/OPFS catalog workflows.'); test.setTimeout(120_000);
		const { app, copy, fixture, errors } = await open(page, locale);
		await view(page, app, copy, copy.photoShowLibrary);
		const library = app.locator('[data-photo-library]'); await expectIds(library, ascending(0, 63));
		const before = await observeNativePhotoCullingOriginals(page, [id(61), id(62), id(63), id(64), id(65)]);
		await keyboard(page, card(library, 62)); await card(library, 63).focus(); await page.keyboard.press('Control+Space');
		await expect(card(library, 62)).toHaveAttribute('aria-pressed', 'true'); await expect(card(library, 63)).toHaveAttribute('aria-pressed', 'true');
		await photo(page, app, copy, copy.photoStackCreate);
		const stack = named(page, 'dialog', copy.photoStackTitle), cover = stackMember(page, stack, 62), member = stackMember(page, stack, 63);
		await keyboard(page, named(cover, 'button', copy.photoStackMakeCover));
		await expect(cover.getByText(copy.photoStackCover, { exact: true })).toBeVisible();
		await expect(member.getByText(copy.photoStackCover, { exact: true })).toHaveCount(0);
		await keyboard(page, named(stack, 'button', copy.photoStackSave));
		await expect(stack.locator('[data-stack-ack]')).toHaveText(copy.photoStackCreated); await closeStack(page, stack, copy);
		await view(page, app, copy, copy.photoStackCollapseView);
		// One stack audit plus candidate/member reads reaches the 64-work limit before cover062 is authenticated.
		await expectIds(library, ascending(0, 61)); await auto(page, app, copy);
		await keyboard(page, card(library, 61)); await card(library, 61).press('4');
		const landing = [62, ...ascending(64, 79)];
		await expect(card(library, 62)).toBeFocused(); await expect(card(library, 62)).toHaveAttribute('aria-pressed', 'true');
		await expectIds(library, landing); await expect(card(library, 63)).toHaveCount(0);
		await card(library, 62).press('5'); await expect(card(library, 64)).toBeFocused();
		await expect(card(library, 64)).toHaveAttribute('aria-pressed', 'true'); await expectIds(library, landing);
		await card(library, 64).press('3'); await expect(card(library, 65)).toBeFocused();
		await expect(card(library, 65)).toHaveAttribute('aria-pressed', 'true'); await expectIds(library, landing);
		await expect(card(library, 63)).toHaveCount(0);
		await page.reload(); await expect(app).toBeVisible(); await expect(app.locator('[data-photo-library],canvas')).toHaveCount(0);
		await view(page, app, copy, copy.photoShowLibrary); await expectIds(library, ascending(0, 63));
		await expect(card(library, 61)).toContainText(`${copy.photoRating}: 4`); await expect(card(library, 62)).toContainText(`${copy.photoRating}: 5`);
		await keyboard(page, card(library, 62)); await photo(page, app, copy, copy.photoStackEdit);
		const restored = named(page, 'dialog', copy.photoStackTitle);
		await expect(named(restored, 'button', copy.photoStackSave)).toBeEnabled();
		await expect(restored.getByRole('listitem').locator('span')).toHaveText([fileName(62), fileName(63)]);
		await expect(stackMember(page, restored, 62).getByText(copy.photoStackCover, { exact: true })).toBeVisible();
		await expect(stackMember(page, restored, 63).getByText(copy.photoStackCover, { exact: true })).toHaveCount(0);
		await closeStack(page, restored, copy); await view(page, app, copy, copy.photoStackCollapseView);
		await expectIds(library, ascending(0, 61)); await view(page, app, copy, copy.photoNextPage);
		await expectIds(library, landing); await expect(card(library, 63)).toHaveCount(0);
		await expect(card(library, 64)).toContainText(`${copy.photoRating}: 3`);
		await retained(page, before, fixture, { [id(61)]: 4, [id(62)]: 5, [id(64)]: 3 }); expect(errors).toEqual([]);
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
async function retained(page, before, fixture, ratings, otherRevisions = []) {
	const after = await observeNativePhotoCullingOriginals(page, before.map(row => row.photoId));
	for (let index = 0; index < after.length; index++) {
		const row = after[index], previous = before[index];
		expect(row.actualSha256).toBe(fixture.originalSha256); expect(row.expectedSha256).toBe(previous.expectedSha256); expect(row.byteLength).toBe(previous.byteLength);
		expect(row.rating).toBe(ratings[row.photoId] ?? previous.rating);
		expect(row.revision).toBe(previous.revision + (Object.hasOwn(ratings, row.photoId) || otherRevisions.includes(row.photoId) ? 1 : 0));
	}
}
function id(index) { return `query-photo-${String(index).padStart(3, '0')}`; }
function fileName(index) { return `Photo-${String(80 - index).padStart(3, '0')}.png`; }
function ascending(first, last) { return Array.from({ length: last - first + 1 }, (_, index) => first + index); }
function descending(first, last) { return ascending(last, first).reverse(); }
function card(library, index) { return library.locator(`[data-photo-id="${id(index)}"]`); }
function named(scope, role, name) { return scope.getByRole(role, { name, exact: true }); }
function stackMember(page, dialog, index) { return dialog.getByRole('listitem').filter({ has: page.getByText(fileName(index), { exact: true }) }); }
async function expectIds(library, indices) {
	await expect(library).toHaveAttribute('aria-busy', 'false');
	await expect.poll(() => library.locator('[data-photo-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-photo-id')))).toEqual(indices.map(id));
	await expect(library).toHaveAttribute('aria-busy', 'false');
}
async function keyboard(page, control) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter'); }
async function choose(page, control, value) {
	await expect(control).toBeEnabled(); const options = await control.locator('option').evaluateAll(nodes => nodes.map(node => node.value)), index = options.indexOf(value);
	expect(index).toBeGreaterThanOrEqual(0); await control.focus(); await expect(control).toBeFocused();
	await page.keyboard.press('Home'); for (let offset = 0; offset < index; offset++) await page.keyboard.press('ArrowDown');
	await expect(control).toHaveValue(value);
}
async function closeSaved(page, dialog, copy) { await keyboard(page, named(dialog.locator('form .lightscaper-dialog-actions'), 'button', copy.photoCloseMetadata)); await expect(dialog).toHaveCount(0); }
async function closeStack(page, dialog, copy) { await keyboard(page, named(dialog.locator('[data-photo-stack-dialog] .lightscaper-dialog-actions'), 'button', copy.photoCloseMetadata)); await expect(dialog).toHaveCount(0); }
async function menu(page, app, name) { await keyboard(page, app.getByRole('navigation').getByText(name, { exact: true })); }
async function view(page, app, copy, action) { await menu(page, app, copy.photoViewMenu); await keyboard(page, named(app, 'button', action)); }
async function photo(page, app, copy, action) { await menu(page, app, copy.photoFileMenu); await menu(page, app, copy.photoPhotoMenu); await keyboard(page, named(app, 'button', action)); }
async function auto(page, app, copy) {
	await menu(page, app, copy.photoFileMenu); await menu(page, app, copy.photoPhotoMenu);
	const control = named(app, 'button', copy.photoAutoAdvance); await expect(control).toHaveAttribute('aria-pressed', 'false');
	await keyboard(page, control);
}
