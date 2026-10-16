/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('Selected Visual Inspector accepts ordinary uppercase RGBA text at Apply', async ({ page }) => {
	// Three inspector round trips include live preview work under CI coverage.
	test.setTimeout(60_000);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Solid']);
	const clip = editor.getByRole('group', { name: 'Video clip: Solid', exact: true });
	await clip.focus();
	await clip.press('Enter');
	const open = async () => {
		await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Selected Visual Inspector']);
		return page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	};
	let dialog = await open();
	let color = dialog.locator('[data-visual-inspector-color]');
	await color.fill('#123456ff');
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText('Selected visual updated.');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	dialog = await open();
	color = dialog.locator('[data-visual-inspector-color]');
	await expect(color).toHaveValue('#123456ff');
	await color.fill('#AABBCCDD');
	await expect(color).toHaveValue('#AABBCCDD');
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText('Selected visual updated.');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	dialog = await open();
	await expect(dialog.locator('[data-visual-inspector-color]')).toHaveValue('#aabbccdd');
});
