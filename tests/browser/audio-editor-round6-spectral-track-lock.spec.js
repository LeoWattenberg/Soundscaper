/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('the spectral dialog offers editing only for available selected audio targets', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const clip = clipByName(editor, monoTone.name);
	const track = clip.locator('xpath=ancestor::div[@data-track-row][1]');
	await page.keyboard.press('ControlOrMeta+a');
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	const open = async () => {
		await editor.getByRole('button', { name: 'Spectrogram options', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Select spectral frequency range', exact: true }).click();
	};
	await open();
	const dialog = page.getByRole('dialog', { name: 'Spectral selection', exact: true });
	await dialog.getByRole('button', { name: 'Spectral Amplify', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clip).toHaveCount(1);
	await chooseTrackMenuAction(page, editor, track, 'Lock track');
	await open();
	await expect(dialog.getByRole('button', { name: 'Select range', exact: true })).toBeEnabled();
	await expect(dialog.getByRole('button', { name: 'Spectral Amplify', exact: true })).toBeDisabled();
	await expect(dialog.getByRole('button', { name: 'Spectral Delete', exact: true })).toBeDisabled();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(dialog).toBeHidden();
	await chooseTrackMenuAction(page, editor, track, 'Unlock track');
	await open();
	await expect(dialog.getByRole('button', { name: 'Spectral Amplify', exact: true })).toBeEnabled();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});
