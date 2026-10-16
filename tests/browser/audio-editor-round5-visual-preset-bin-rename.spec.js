/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, waitForEditor } from './audio-editor-test-helpers.js';

test('a saved Title preset retains its text and styling after its Bin model is renamed', async ({ page }) => {
	// Repeated inspector visits, history checks and reload retain precise coverage.
	test.setTimeout(180_000);
	let editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Title/Text']);
	let title = editor.getByRole('group', { name: 'Video clip: Title', exact: true });
	const inspector = async () => {
		await title.press('Enter');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Selected Visual Inspector']);
		return page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	};
	const changeTitle = async (text, size, color) => {
		const dialog = await inspector();
		await dialog.getByRole('textbox', { name: 'Text', exact: true }).fill(text);
		await dialog.getByRole('spinbutton', { name: 'Font size', exact: true }).fill(size);
		await dialog.getByRole('textbox', { name: 'RGBA color', exact: true }).fill(color);
		await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(dialog.getByRole('status').last()).toHaveText('Selected visual updated.');
		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	};
	const library = async () => {
		await title.press('Enter');
		await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Save Visual Preset']);
		return page.getByRole('dialog', { name: 'Selected Visual Presets', exact: true });
	};
	await changeTitle('Saved title', '40', '#ff0000ff');
	let dialog = await library();
	await dialog.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Saved title');
	await dialog.getByRole('button', { name: 'Save selected generator preset', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Selected visual preset saved.');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await changeTitle('Changed title', '72', '#00ff00ff');
	let name = editor.locator('[data-project-bin-item]').first().locator('[data-project-bin-name]');
	await expect(name).toHaveValue('Saved title Model');
	await name.fill('Renamed preset model');
	await name.press('Enter');
	await expect(name).toHaveValue('Renamed preset model');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(name).toHaveValue('Saved title Model');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(name).toHaveValue('Renamed preset model');
	dialog = await library();
	await dialog.getByRole('combobox', { name: 'Saved visual preset', exact: true }).selectOption({ label: 'Saved title' });
	await dialog.getByRole('button', { name: 'Apply to selected generator', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Selected authored state applied.');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	const expectTitle = async (text, size, color) => {
		const dialog = await inspector();
		await expect(dialog.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue(text);
		await expect(dialog.getByRole('spinbutton', { name: 'Font size', exact: true })).toHaveValue(size);
		await expect(dialog.getByRole('textbox', { name: 'RGBA color', exact: true })).toHaveValue(color);
		await expect(dialog.locator('[data-visual-inspector-preset] option', { hasText: 'Saved title' })).toHaveCount(1);
		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	};
	await expectTitle('Saved title', '40', '#ff0000ff');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expectTitle('Changed title', '72', '#00ff00ff');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expectTitle('Saved title', '40', '#ff0000ff');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.reload();
	await waitForEditor(page);
	editor = page.locator('[data-audio-editor]');
	title = editor.getByRole('group', { name: 'Video clip: Title', exact: true });
	name = editor.locator('[data-project-bin-item]').first().locator('[data-project-bin-name]');
	await expect(name).toHaveValue('Renamed preset model');
	await expectTitle('Saved title', '40', '#ff0000ff');
});
