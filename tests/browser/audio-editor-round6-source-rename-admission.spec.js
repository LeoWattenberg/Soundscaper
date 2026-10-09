/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, closeClipProperties, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('the existing Source header follows the Clip properties mutation admission', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	const track = clip.locator('xpath=ancestor::div[@data-track-row]');
	const panel = await openClipProperties(page, editor, clip);
	const sourceHeader = panel.locator('.audio-editor-source-clip .clip-header');
	await sourceHeader.locator('.clip-header__name').dblclick();
	const input = sourceHeader.getByRole('textbox', { name: 'Clip name', exact: true });
	await input.fill('Source programme');
	await input.press('Enter');
	await expect(clipByName(editor, 'Source programme')).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clip).toBeVisible();
	await chooseTrackMenuAction(page, editor, track, 'Lock track');
	await expect(panel.getByRole('button', { name: 'Trim source end', exact: true })).toBeDisabled();
	await sourceHeader.locator('.clip-header__name').dblclick();
	await expect(input).toHaveCount(0);
	await chooseTrackMenuAction(page, editor, track, 'Unlock track');
	await sourceHeader.locator('.clip-header__name').dblclick();
	await input.fill('Restored source name');
	await input.press('Enter');
	await closeClipProperties(panel);
	await expect(clipByName(editor, 'Restored source name')).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clip).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(clipByName(editor, 'Restored source name')).toBeVisible();
});
