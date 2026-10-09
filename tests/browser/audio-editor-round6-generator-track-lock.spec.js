/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('the ordinary Silence generator respects its selected locked source target', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	const track = clip.locator('xpath=ancestor::div[@data-track-row]');
	await clip.locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Generate', 'Silence');
	const dialog = page.getByRole('dialog', { name: 'Silence', exact: true });
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clip).toHaveCount(1);
	await chooseTrackMenuAction(page, editor, track, 'Lock track');
	await chooseCommandAction(page, editor, 'Generate', 'Silence');
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	const clipCount = Number(await editor.getAttribute('data-clip-count'));
	await chooseCommandAction(page, editor, 'Generate', 'Silence');
	await expect(dialog.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled();
	await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(editor).toHaveAttribute('data-clip-count', String(clipCount + 1));
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', String(clipCount));
	await chooseTrackMenuAction(page, editor, track, 'Unlock track');
	await clip.locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Generate', 'Silence');
	await expect(dialog.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});
