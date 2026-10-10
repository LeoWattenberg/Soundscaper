/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('right clicking a folder name draft keeps text editing instead of opening folder actions', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseTrackMenuAction(page, editor, null, 'Move selection into new folder');
	const folder = editor.locator('[data-track-folder-row]').first();
	await expect(folder).toHaveAttribute('aria-label', 'Folder Folder 1, level 1');
	await folder.press('F2');
	const input = editor.getByRole('textbox', { name: 'Rename folder', exact: true });
	await input.fill('Draft folder');
	await input.click({ button: 'right' });
	await expect(page.locator('.audio-editor-track-folder-menu')).toHaveCount(0);
	await expect(input).toHaveValue('Draft folder');
	await input.press('Enter');
	await expect(folder).toHaveAttribute('aria-label', 'Folder Draft folder, level 1');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(folder).toHaveAttribute('aria-label', 'Folder Folder 1, level 1');
});
