/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('deleting the final macro program hands keyboard authoring to New program', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	const create = manager.getByLabel('New program', { exact: true });
	await create.click();
	const remove = manager.getByRole('button', { name: 'Delete program', exact: true });
	await remove.focus();
	await page.keyboard.press('Enter');
	await expect(manager.getByRole('textbox', { name: 'Program', exact: true })).toHaveCount(0);
	await expect(create).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(manager.getByRole('textbox', { name: 'Program', exact: true })).toBeVisible();
	await create.click();
	await remove.focus();
	await page.keyboard.press('Enter');
	await expect(remove).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(create).toBeFocused();
});
