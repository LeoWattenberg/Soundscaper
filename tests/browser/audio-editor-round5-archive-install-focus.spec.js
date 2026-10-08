/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, openNestedCommandMenu } from './audio-editor-test-helpers.js';

test('published Nyquist installation preserves its replacement keyboard action', async ({ page }) => {
	test.setTimeout(60_000);
	const editor = await bootEditor(page, '/embed/en/');
	const menu = await openNestedCommandMenu(page, editor, 'Effect', ['Nyquist']);
	await menu.getByRole('menuitem', { name: 'Get effects', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Get effects', exact: true });
	await dialog.getByRole('searchbox', { name: 'Search effects' }).fill('Ten Band EQ');
	const install = dialog.getByRole('button', { name: 'Install Ten Band EQ', exact: true });
	await expect(install).toBeVisible({ timeout: 20_000 });
	await install.focus(); await install.press('Enter');
	const remove = dialog.getByRole('button', { name: 'Remove Ten Band EQ', exact: true });
	await expect(remove).toBeVisible({ timeout: 20_000 });
	await expect(remove).toBeFocused();
	await remove.press('Enter');
	await expect(install).toBeFocused();
	await install.press('Enter');
	await expect(remove).toBeVisible({ timeout: 20_000 });
	await expect(remove).toBeFocused();
});
