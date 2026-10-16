/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, closeClipProperties,
	importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('Clip properties retains live track lock and unlock admission', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	const track = clip.locator('xpath=ancestor::div[@data-track-row]');
	const panel = await openClipProperties(page, editor, clip);
	await panel.locator('[data-clip-properties-drawer="media"] summary').click();
	const name = panel.locator('[data-clip-field="name"] input');
	await expect(name).toBeEnabled();
	await name.fill('Programme');
	await name.press('Enter');
	await expect(clipByName(editor, 'Programme')).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clip).toBeVisible();
	await chooseTrackMenuAction(page, editor, track, 'Lock track');
	await expect(name).toBeDisabled();
	await expect(panel.locator('[data-clip-field="inverted"]').getByRole('checkbox')).toHaveAttribute('aria-disabled', 'true');
	await expect(panel.locator('.audio-editor-source-ruler__transport').getByRole('button', { name: 'Play', exact: true })).toBeEnabled();
	await chooseTrackMenuAction(page, editor, track, 'Unlock track');
	await expect(name).toBeEnabled();
	await name.fill('Restored programme');
	await name.press('Enter');
	await expect(clipByName(editor, 'Restored programme')).toBeVisible();
	await closeClipProperties(panel);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clip).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(clipByName(editor, 'Restored programme')).toBeVisible();
});
