/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseDropdown, openExportDialog, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

async function saveAs(page, dialog, name) {
	await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Save as new preset', exact: true }).click();
	const prompt = page.getByRole('dialog', { name: 'Save as new preset', exact: true });
	await prompt.getByRole('textbox').fill(name);
	await prompt.getByRole('button', { name: 'Save preset', exact: true }).click();
	await expect(prompt).toBeHidden();
	await expect(dialog.getByRole('button', { name: 'Preset', exact: true })).toContainText(name);
	await expect(dialog.getByRole('button', { name: 'Save preset', exact: true })).toBeEnabled();
}

test('each same-name delivery preset selects its own saved format', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const tone = page.getByRole('dialog', { name: 'Tone', exact: true });
	await tone.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(tone).toBeHidden();
	const dialog = await openExportDialog(page, editor);
	const format = dialog.getByRole('group', { name: 'Format', exact: true });
	await chooseDropdown(page, format, 'WAV');
	await saveAs(page, dialog, 'Favorite');
	await chooseDropdown(page, format, 'FLAC');
	await saveAs(page, dialog, 'Favorite');
	await chooseDropdown(page, format, 'MP3');
	await dialog.getByRole('button', { name: 'Preset', exact: true }).click();
	await page.getByRole('option', { name: /^Favorite \(custom\)/u }).nth(1).click();
	await expect(format.getByRole('button')).toHaveText(/FLAC/u);
});
