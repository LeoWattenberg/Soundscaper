/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('Escape cancels a macro program name draft without closing its palette', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	const name = manager.getByRole('textbox', { name: 'Program name', exact: true });
	const original = await name.inputValue();
	await name.fill('Cancelled draft');
	await name.press('Escape');
	await expect(manager).toBeVisible();
	await expect(name).toHaveValue(original);
	await manager.getByRole('textbox', { name: 'Program', exact: true }).click();
	await expect(manager.locator('.audio-editor-macros-palette__library')).not.toContainText('Cancelled draft');
});
