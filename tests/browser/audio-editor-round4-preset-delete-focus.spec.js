/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openParametricEqSelectionEffect } from './audio-editor-test-helpers.js';

test('deleting a custom effect preset returns keyboard control to the preset picker', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await clip.focus();
	await clip.press('Enter');
	const dialog = await openParametricEqSelectionEffect(page, editor);
	await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Save as new preset', exact: true }).click();
	const prompt = page.getByRole('dialog', { name: 'Save as new preset', exact: true });
	await prompt.getByRole('textbox').fill('Keyboard room');
	await prompt.getByRole('textbox').press('Enter');
	await expect(prompt).toBeHidden();
	const picker = dialog.getByRole('button', { name: 'Preset', exact: true });
	await expect(picker).toContainText('Keyboard room');
	const remove = dialog.getByRole('button', { name: 'Delete preset', exact: true });
	await remove.focus();
	await remove.press('Enter');
	await expect(picker).toContainText('No preset');
	await expect(remove).toBeDisabled();
	await expect(picker).toBeFocused();
	await picker.press('Enter');
	await expect(page.getByRole('option', { name: 'No preset', exact: true })).toBeVisible();
	await expect(page.getByRole('option', { name: 'Keyboard room (custom)', exact: true })).toHaveCount(0);
});
