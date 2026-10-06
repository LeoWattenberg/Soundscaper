/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('spectral selection requires both frequency endpoints to contain a number', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await clip.focus();
	await clip.press('Enter');
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	await editor.getByRole('button', { name: 'Spectrogram options', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Select spectral frequency range', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Spectral selection', exact: true });
	const minimum = dialog.getByRole('textbox', { name: /^Minimum frequency \(Hz\)/u });
	await minimum.fill('');
	await expect(dialog.getByRole('button', { name: 'Select range', exact: true })).toBeDisabled();
	await expect(dialog.getByRole('button', { name: 'Spectral Delete', exact: true })).toBeDisabled();
	await expect(dialog.getByRole('button', { name: 'Spectral Amplify', exact: true })).toBeDisabled();
	await minimum.fill('0');
	await expect(dialog.getByRole('button', { name: 'Select range', exact: true })).toBeEnabled();
});
