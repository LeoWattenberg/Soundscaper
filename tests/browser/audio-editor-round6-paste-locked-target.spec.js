/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, getMenuItem, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('Edit Paste retains its healthy copy while refusing a locked destination', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone, toneA]);
	const source = clipByName(editor, monoTone.name);
	const destination = clipByName(editor, toneA.name);
	await source.locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await destination.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(editor).toHaveAttribute('data-clip-count', '3');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await destination.locator('.clip-header').click();
	const track = destination.locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, track, 'Lock track');
	await editor.getByRole('menuitem', { name: 'Edit', exact: true }).click();
	const menu = page.getByRole('menu', { name: 'Edit', exact: true });
	const paste = getMenuItem(menu, 'Paste');
	await paste.focus();
	await paste.press('ArrowRight');
	const submenu = paste.getByRole('menu');
	await expect(submenu).toBeVisible();
	await expect(getMenuItem(submenu, 'Paste')).toBeDisabled();
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
	await chooseTrackMenuAction(page, editor, track, 'Unlock track');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(editor).toHaveAttribute('data-clip-count', '3');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor).toHaveAttribute('data-clip-count', '3');
});
