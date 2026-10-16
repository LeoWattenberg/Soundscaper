/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('assigned Replace track selection retains the selected recording extent', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await clip.locator('.clip-header').click();
	const end = editor.getByRole('group', { name: 'Selection end', exact: true }).locator('.timecode__display');
	await chooseNestedCommandAction(page, editor, 'Select', ['Tracks', 'Select all tracks']);
	await expect(end).toHaveText('00h00m00.800s');
	await clip.locator('.clip-header').click();
	await expect(clip.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('Replace track selection');
	const command = preferences.getByRole('group', { name: 'Replace track selection', exact: true }).locator('..');
	await command.getByRole('textbox').first().fill('Alt+R');
	await command.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(command.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await editor.getByRole('slider', { name: 'Playhead', exact: true }).press('Alt+R');
	await expect(end).toHaveText('00h00m00.800s');
	await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(1);
});
