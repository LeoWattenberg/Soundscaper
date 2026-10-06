/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

async function spectralDialog(page) {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const tone = page.getByRole('dialog', { name: 'Tone', exact: true });
	await tone.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(tone).toBeHidden();
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	await editor.getByRole('button', { name: 'Spectrogram options', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Select spectral frequency range', exact: true }).click();
	return page.getByRole('dialog', { name: 'Spectral selection', exact: true });
}

test('frequency step arrows preserve the value of scientific numeric input', async ({ page }) => {
	const dialog = await spectralDialog(page);
	const minimum = dialog.getByRole('textbox', { name: /^Minimum frequency \(Hz\)/u });
	await minimum.fill('1e3');
	await dialog.getByRole('button', { name: 'Increase value', exact: true }).nth(1).click();
	await expect(minimum).toHaveValue('1010');
});

test('frequency step arrows recover an out-of-range draft to the declared bounds', async ({ page }) => {
	const dialog = await spectralDialog(page);
	const minimum = dialog.getByRole('textbox', { name: /^Minimum frequency \(Hz\)/u });
	await minimum.fill('-100');
	await dialog.getByRole('button', { name: 'Increase value', exact: true }).nth(1).click();
	await expect(minimum).toHaveValue('0');
	const maximum = dialog.getByRole('textbox', { name: /^Maximum frequency \(Hz\)/u });
	await maximum.fill('25000');
	await dialog.getByRole('button', { name: 'Decrease value', exact: true }).nth(2).click();
	await expect(maximum).toHaveValue('24000');
});
