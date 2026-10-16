/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

for (const locale of ['en', 'ar']) test(`spreadsheet horizontal arrows follow the ordinary ${locale} cell layout`, async ({ page }) => {
	const editor = await bootEditor(page, `/embed/${locale}/`);
	await importFiles(editor, [toneA]);
	if (locale === 'ar') {
		await editor.getByRole('menubar').getByRole('menuitem', { name: 'نافذة', exact: true }).press('Enter');
		await page.getByRole('menu', { name: 'نافذة', exact: true }).getByRole('menuitemcheckbox', { name: 'جدول المقاطع', exact: true }).press('Enter');
	} else await chooseCommandAction(page, editor, 'Window', 'Clip spreadsheet');
	const grid = editor.locator('[data-workspace-panel="clip-spreadsheet"]').getByRole('grid');
	const name = grid.locator('[data-row="0"][data-column="name"]');
	const neighbor = grid.locator('[data-row="0"][data-column="track"]');
	await expect.poll(() => grid.evaluate(element => getComputedStyle(element).direction)).toBe(locale === 'ar' ? 'rtl' : 'ltr');
	await name.click();
	await expect(name).toBeFocused();
	const first = await name.boundingBox(), second = await neighbor.boundingBox();
	expect(first).not.toBeNull(); expect(second).not.toBeNull();
	if (locale === 'ar') expect(second.x).toBeLessThan(first.x);
	else expect(second.x).toBeGreaterThan(first.x);
	await page.keyboard.press(locale === 'ar' ? 'ArrowLeft' : 'ArrowRight');
	await expect(neighbor).toBeFocused();
	await page.keyboard.press(locale === 'ar' ? 'ArrowRight' : 'ArrowLeft');
	await expect(name).toBeFocused();
	await expect(editor.getByRole('alert')).toHaveCount(0);
});
