/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('confirming a program name keeps its keyboard editing position', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	const name = manager.getByRole('textbox', { name: 'Program name', exact: true });
	await name.fill('Keyboard program');
	await name.press('Enter');
	await expect(manager.locator('.audio-editor-macros-palette__library')).toContainText('Keyboard program');
	await expect(name).toBeFocused();
	await name.press('End');
	await name.pressSequentially(' encore');
	await name.press('Enter');
	await expect(manager.locator('.audio-editor-macros-palette__library')).toContainText('Keyboard program encore');
	await expect(name).toBeFocused();
	await name.press('Tab');
	await expect(manager.getByRole('textbox', { name: 'Program', exact: true })).toBeFocused();
});
