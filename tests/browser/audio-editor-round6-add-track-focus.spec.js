/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';

test('keyboard Add track returns focus to its trigger after creating a track', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const add = editor.getByRole('button', { name: 'Add track', exact: true });
	await add.focus();
	await add.press('Enter');
	const flyout = page.locator('.add-track-flyout');
	const audio = flyout.getByRole('menuitem', { name: 'Audio track', exact: true });
	await expect(audio).toBeFocused();
	const count = await editor.locator('[data-track-row]').count();
	await audio.press('Enter');
	await expect(editor.locator('[data-track-row]')).toHaveCount(count + 1);
	await expect(flyout).toBeHidden();
	await expect(add).toBeFocused();
	await page.keyboard.press('Space');
	await expect(audio).toBeFocused();
	await audio.press('ArrowDown');
	await expect(flyout.getByRole('menuitem', { name: 'Video track', exact: true })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(flyout).toBeHidden();
	await expect(add).toBeFocused();
});
