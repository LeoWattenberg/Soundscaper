/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, commitInput,
	importFiles } from './audio-editor-test-helpers.js';

test('Filter Curve EQ keeps an unattainable inverse from replacing the authored curve', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['EQ and filters', 'Filter Curve EQ']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await dialog.getByText('Curve points (Hz:dB)', { exact: true }).first().click();
	const curve = dialog.getByRole('textbox', { name: 'Curve points (Hz:dB)', exact: true });
	await commitInput(curve, '100:-80\n10000:-80');
	await expect(curve).toHaveValue('100:-80, 10000:-80');
	const invert = dialog.getByRole('button', { name: 'Invert', exact: true });
	await expect(invert).toBeDisabled();
	await expect(invert.locator('..')).toHaveAttribute('title', /Adjust gains below -60 dB/u);
	await expect(curve).toHaveValue('100:-80, 10000:-80');
	await commitInput(curve, '100:-60\n10000:12');
	await expect(invert).toBeEnabled();
	await invert.click();
	await expect(curve).toHaveValue('100:60, 10000:-12');
	await invert.click();
	await expect(curve).toHaveValue('100:-60, 10000:12');
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});
