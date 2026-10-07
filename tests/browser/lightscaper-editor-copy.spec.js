/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { expect, test } from './helpers/browser-coverage-fixture.js';

const catalog = JSON.parse(readFileSync(new URL('../../src/common/i18n/translations/ar.json', import.meta.url), 'utf8'));
const keys = { menu: 'photoMenuLabel', file: 'photoFileMenu', view: 'photoViewMenu', importer: 'photoImportPhotos',
	choose: 'photoChooseFiles', close: 'photoCancelAction' };
const copy = Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, catalog.entries[key]?.[2]]));

test('the published Arabic photo menu and lazy importer use the small translated catalog without a timeline copy chunk', async ({ page }) => {
	const origin = JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper;
	const errors = [], scripts = [];
	page.on('pageerror', error => { errors.push(error.message); });
	page.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
	expect(copy.file).toBeTruthy(); expect(copy.file).not.toBe('File');
	expect(catalog.entries.photoImportPhotos[1]).toBe('Import photos');
	await page.goto(`${origin}/ar/`);
	const app = page.locator('[data-lightscaper-bound="true"]');
	await expect(app).toBeVisible();
	await expect(app.locator('[data-photo-library]')).toHaveCount(0);
	const menu = app.getByRole('navigation', { name: copy.menu, exact: true });
	await expect(menu.locator('summary').filter({ hasText: copy.view })).toBeVisible();
	await menu.locator('summary').filter({ hasText: copy.file }).focus(); await page.keyboard.press('Enter');
	await menu.getByRole('button', { name: copy.importer, exact: true }).focus(); await page.keyboard.press('Enter');
	const dialog = page.getByRole('dialog', { name: copy.importer, exact: true });
	await expect(dialog).toBeVisible(); await expect(dialog.getByLabel(copy.choose)).toBeVisible();
	await dialog.locator('.lightscaper-dialog-actions').getByRole('button', { name: copy.close, exact: true }).click();
	await expect(dialog).toHaveCount(0);
	expect(scripts.filter(url => /\/editor-copy-[^/]+\.js/u.test(url))).toEqual([]);
	expect(errors).toEqual([]);
});
