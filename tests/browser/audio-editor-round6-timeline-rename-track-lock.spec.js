/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('inline timeline clip rename respects track lock and restores ordinary rename on unlock', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const original = clipByName(editor, toneA.name);
	const clipId = await original.getAttribute('data-clip-id');
	const clip = editor.locator(`[data-clip-id="${clipId}"][role="group"]`);
	const track = clip.locator('xpath=ancestor::div[@data-track-row]');
	await clip.locator('.clip-header').click();
	await clip.press('F2');
	const input = clip.getByRole('textbox', { name: 'Clip name', exact: true });
	await expect(input).toBeFocused();
	await input.fill('Programme');
	await input.press('Enter');
	await expect(clipByName(editor, 'Programme')).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(original).toBeVisible();
	await chooseTrackMenuAction(page, editor, track, 'Lock track');
	await clip.locator('.clip-header').click();
	await clip.press('F2');
	await expect(input).toHaveCount(0);
	await clip.locator('.clip-header__name').dblclick();
	await expect(input).toHaveCount(0);
	await expect(original).toBeVisible();
	await chooseTrackMenuAction(page, editor, track, 'Unlock track');
	await clip.locator('.clip-header__name').dblclick();
	await expect(input).toBeFocused();
	await input.fill('Restored programme');
	await input.press('Enter');
	await expect(clipByName(editor, 'Restored programme')).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(original).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(clipByName(editor, 'Restored programme')).toBeVisible();
});
