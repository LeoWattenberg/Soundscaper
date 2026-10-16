/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('keyboard context-menu completion returns focus before the chosen action closes the menu', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const row = clipByName(editor, monoTone.name).locator('xpath=ancestor::div[@data-track-row][1]');
	const trigger = row.getByRole('button', { name: 'Track menu', exact: true });
	await trigger.press('Enter');
	const menu = page.locator('.audio-editor-track-menu');
	await expect(menu).toBeVisible();
	await menu.getByRole('menuitem', { name: 'Enable multi-track recording', exact: true }).press('Enter');
	await expect(menu).toBeHidden();
	await expect(trigger).toBeFocused();
	await trigger.press('Space');
	await expect(menu).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(trigger).toBeFocused();
});
