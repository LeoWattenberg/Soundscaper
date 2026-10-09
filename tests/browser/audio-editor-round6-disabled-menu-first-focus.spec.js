/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('a label track menu skips its unavailable first command and closes with Escape', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'New label track']);
	const options = editor.locator('[data-label-track]').getByRole('button', { name: 'Track options', exact: true });
	await options.click();
	const menu = page.locator('.audio-editor-track-menu');
	await expect(menu).toBeVisible();
	await expect(menu.getByRole('menuitem', { name: 'Duplicate track', exact: true })).toBeDisabled();
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
	await expect(options).toBeFocused();
	await options.press('Enter');
	await expect(menu.getByRole('menuitem', { name: /^Move track(?:\s|$)/u })).toBeFocused();
	await page.keyboard.press('Home');
	await expect(menu.getByRole('menuitem', { name: /^Move track(?:\s|$)/u })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
	await expect(options).toBeFocused();
});
