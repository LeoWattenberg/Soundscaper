/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openParametricEqSelectionEffect } from './audio-editor-test-helpers.js';

test('Enter in an effect preset name saves through the same form as the footer action', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await clip.focus();
	await clip.press('Enter');
	const dialog = await openParametricEqSelectionEffect(page, editor);
	await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Save as new preset', exact: true }).click();
	const prompt = page.getByRole('dialog', { name: 'Save as new preset', exact: true });
	const name = prompt.getByRole('textbox');
	await name.fill('Keyboard preset');
	await name.press('Enter');
	await expect(prompt).toBeHidden();
	await expect(dialog.getByRole('button', { name: 'Preset', exact: true })).toContainText('Keyboard preset');
});
