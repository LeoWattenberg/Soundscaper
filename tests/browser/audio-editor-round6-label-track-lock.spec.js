/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('locked timeline labels preserve selection and restore writing after unlock', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await page.keyboard.press('Control+b');
	const input = editor.getByRole('textbox', { name: /^Edit labels:/u });
	await input.fill('Intro');
	await input.press('Enter');
	const track = editor.locator('[data-label-track]');
	const label = track.locator('[data-label-id]').first();
	await label.press('F2');
	await input.fill('Edited intro');
	await input.press('Enter');
	await expect(label).toHaveAttribute('aria-label', 'Edit labels: Edited intro');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(label).toHaveAttribute('aria-label', 'Edit labels: Intro');
	await chooseTrackMenuAction(page, editor, track, 'Lock track');
	await label.press('F2');
	await expect(input).toHaveCount(0);
	await expect(track.getByRole('button', { name: 'Add label', exact: true })).toBeDisabled();
	await label.click();
	await expect(label).toHaveAttribute('data-selected-label', 'true');
	await chooseTrackMenuAction(page, editor, track, 'Unlock track');
	await label.press('F2');
	await expect(input).toBeFocused();
	await input.fill('Restored intro');
	await input.press('Enter');
	await expect(label).toHaveAttribute('aria-label', 'Edit labels: Restored intro');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(label).toHaveAttribute('aria-label', 'Edit labels: Intro');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(label).toHaveAttribute('aria-label', 'Edit labels: Restored intro');
});
