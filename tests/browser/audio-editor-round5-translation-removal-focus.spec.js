/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('removing the final filtered translation change restores its message-search focus', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Help', 'Contribute translations');
	const dialog = page.getByRole('dialog', { name: 'Community translations', exact: true });
	const search = dialog.getByRole('searchbox', { name: 'Find a message', exact: true });
	await search.fill('play');
	await dialog.getByRole('listbox', { name: /^Messages \(/u }).selectOption('play');
	await expect(dialog.getByRole('textbox', { name: 'Your translation', exact: true })).toBeVisible();
	await dialog.getByRole('textbox', { name: 'Your translation', exact: true }).fill('Wiedergabe Test');
	await dialog.getByRole('button', { name: 'Save draft', exact: true }).click();
	await expect(dialog).toContainText('Draft saved locally.');
	await dialog.getByRole('combobox', { name: 'Show messages', exact: true }).selectOption('changed');
	const remove = dialog.getByRole('button', { name: 'Remove this change', exact: true });
	await remove.focus();
	await remove.press('Enter');
	await expect(remove).toHaveCount(0);
	await expect(search).toBeFocused();
	await search.press('ControlOrMeta+A');
	await search.press('Backspace');
	await expect(search).toHaveValue('');
});
