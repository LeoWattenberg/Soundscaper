/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('Shift+F10 opens the focused folder menu for keyboard audibility controls', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseTrackMenuAction(page, editor, null, 'Move selection into new folder');
	const folder = editor.locator('[data-track-folder-row]').first();
	await folder.focus();
	await page.keyboard.press('Shift+F10');
	const menu = page.locator('.audio-editor-track-folder-menu');
	await expect(menu).toBeVisible();
	await menu.getByRole('menuitem', { name: 'Mute folder', exact: true }).press('Enter');
	await expect(folder.getByRole('button', { name: 'Mute folder', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
