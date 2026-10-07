/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, commitInput, importFiles } from './audio-editor-test-helpers.js';

test('a horizontal EQ keyboard edit preserves gain outside the displayed range', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['EQ and filters', 'Filter Curve EQ']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await dialog.getByText('Curve points (Hz:dB)', { exact: true }).first().click();
	const curve = dialog.getByRole('textbox', { name: 'Curve points (Hz:dB)', exact: true });
	await commitInput(curve, '100:-20');
	const minimum = dialog.getByRole('spinbutton', { name: 'Minimum gain (dB)', exact: true });
	await minimum.fill('-10');
	await minimum.press('Tab');
	await page.keyboard.press('Shift+Tab');
	await expect(minimum).toBeFocused();
	await page.keyboard.press('Shift+Tab');
	await page.keyboard.press('Shift+Tab');
	const point = dialog.getByRole('group', { name: 'Equalization curve', exact: true }).getByRole('button');
	await expect(point).toBeFocused();
	await expect(point).toHaveAttribute('aria-label', '100.0 Hz, -20.0 dB');
	await page.keyboard.press('ArrowRight');
	await expect(point).toHaveAttribute('aria-label', /Hz, -20\.0 dB$/u);
	await expect(point).not.toHaveAttribute('aria-label', /^100\.0 Hz/u);
	await expect(curve).not.toHaveValue('100:-20');
});
