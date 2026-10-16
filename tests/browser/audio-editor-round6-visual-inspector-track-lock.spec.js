/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('Selected Visual Inspector respects an ordinary picture track lock', async ({ page }) => {
	test.setTimeout(90_000);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Solid']);
	const clip = editor.getByRole('group', { name: 'Video clip: Solid', exact: true });
	await clip.focus();
	await clip.press('Enter');
	const track = clip.locator('xpath=ancestor::div[@data-track-row]');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Selected Visual Inspector']);
	let dialog = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	const opacity = dialog.getByRole('spinbutton', { name: 'Opacity', exact: true });
	await expect(opacity).toBeEnabled();
	await opacity.fill('0.5');
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText('Selected visual updated.');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(dialog).toBeHidden();
	await chooseTrackMenuAction(page, editor, track, 'Lock track');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Selected Visual Inspector']);
	dialog = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	await expect(dialog.locator('[data-visual-inspector-color]')).toBeDisabled();
	await expect(dialog.getByRole('spinbutton', { name: 'Opacity', exact: true })).toBeEnabled();
	await dialog.getByRole('spinbutton', { name: 'Opacity', exact: true }).fill('0.75');
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText('Selected visual updated.');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(dialog).toBeHidden();
	await chooseTrackMenuAction(page, editor, track, 'Unlock track');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Selected Visual Inspector']);
	dialog = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	await expect(dialog.getByRole('spinbutton', { name: 'Opacity', exact: true })).toHaveValue('0.75');
	await expect(dialog.locator('[data-visual-inspector-color]')).toBeEnabled();
	await dialog.locator('[data-visual-inspector-color]').fill('#123456ff');
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText('Selected visual updated.');
});
