/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('removing a nested folder returns keyboard navigation to its surviving parent', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseTrackMenuAction(page, editor, null, 'Move selection into new folder');
	const parent = editor.getByRole('treeitem', { name: 'Folder Folder 1, level 1', exact: true });
	await parent.press('Shift+F10');
	const menu = page.locator('.audio-editor-track-folder-menu');
	await menu.getByRole('menuitem', { name: 'New folder', exact: true }).press('Enter');
	const child = editor.getByRole('treeitem', { name: 'Folder Folder 2, level 2', exact: true });
	await child.press('Shift+F10');
	await menu.getByRole('menuitem', { name: 'Delete folder, keep tracks', exact: true }).press('Enter');
	await expect(child).toHaveCount(0);
	await expect(parent).toBeFocused();
	await page.keyboard.press('ArrowLeft');
	await expect(parent).toHaveAttribute('aria-expanded', 'false');
});
