/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('an empty label track exposes its existing options menu to Tab navigation', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'New label track']);
	const row = editor.locator('[data-label-track]');
	await expect(row).toHaveCount(1);
	const add = row.getByRole('button', { name: 'Add label', exact: true });
	const options = row.getByRole('button', { name: 'Track options', exact: true });
	await expect(options).toBeVisible();
	await add.focus();
	await add.press('Shift+Tab');
	await expect(options).toBeFocused();
	await page.keyboard.press('Enter');
	const menu = page.locator('.audio-editor-track-menu');
	await expect(menu).toBeVisible();
	await expect(menu.getByRole('menuitem', { name: /^Move track(?:\s|$)/u })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
	await expect(options).toBeFocused();
	await options.press('Tab');
	await expect(add).toBeFocused();
});
