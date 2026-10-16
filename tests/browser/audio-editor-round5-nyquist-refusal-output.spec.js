/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('a Nyquist refusal retains its controls and output for a corrected retry', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Nyquist', 'Adjustable Fade']);
	const dialog = page.getByRole('dialog', { name: 'Adjustable Fade', exact: true });
	const start = dialog.getByRole('spinbutton', { name: 'Start (or end)', exact: true });
	await start.fill('-1');
	await start.press('Tab');
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog.locator('pre')).toContainText('Percentage values cannot be negative.');
	await expect(start).toHaveValue('-1');
	await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
	await start.fill('0');
	await start.press('Tab');
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(editor.locator('[data-status]')).toContainText('Applied the Nyquist result.');
	await expect(dialog).toBeHidden();
});
