/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('Visual Inspector retains ordinary scientific opacity typing and Enter applies the completed value', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Solid']);
	const clip = editor.getByRole('group', { name: 'Video clip: Solid', exact: true });
	await clip.press('Enter');
	const open = async () => {
		await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Selected Visual Inspector']);
		return page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	};
	let dialog = await open();
	await dialog.getByRole('spinbutton', { name: 'Opacity', exact: true }).fill('0.5');
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText('Selected visual updated.');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	dialog = await open();
	const opacity = dialog.getByRole('spinbutton', { name: 'Opacity', exact: true });
	await expect(opacity).toHaveValue('0.5');
	await opacity.focus();
	await page.keyboard.press('ControlOrMeta+A');
	await page.keyboard.press('Backspace');
	await page.keyboard.type('2.5e-1');
	await expect(opacity).toHaveValue('2.5e-1');
	await page.keyboard.press('Enter');
	await expect(dialog.getByRole('status').last()).toHaveText('Selected visual updated.');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	dialog = await open();
	await expect(dialog.getByRole('spinbutton', { name: 'Opacity', exact: true })).toHaveValue('0.25');
});
