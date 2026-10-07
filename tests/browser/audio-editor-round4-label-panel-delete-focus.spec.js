/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('deleting labels in their manager retains the next row and creation keyboard actions', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Manage labels');
	const panel = editor.locator('[data-workspace-panel="labels"]');
	const add = panel.getByRole('button', { name: 'New label', exact: true });
	await add.click();
	await add.click();
	const remove = panel.getByRole('button', { name: /^Delete label:/ });
	await expect(remove).toHaveCount(2);
	await remove.first().focus();
	await remove.first().press('Enter');
	await expect(remove).toHaveCount(1);
	await expect(remove).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(remove).toHaveCount(0);
	await expect(add).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(remove).toHaveCount(1);
});
