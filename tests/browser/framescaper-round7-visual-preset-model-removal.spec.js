/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

const AUTHORING_OPTIONS = { timeout: 30_000 };

test('a saved visual preset still applies after its model card is removed from the project Bin', async ({ page }) => {
	// Repeated authored-state changes checkpoint the preview workers in Chromium
	// coverage runs; use the same budget as the visual-authoring menu workflows.
	test.setTimeout(180_000);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Title/Text']);
	const title = editor.getByRole('group', { name: 'Video clip: Title', exact: true });
	const closeDialog = async dialog => {
		await dialog.getByRole('button', { name: 'Close', exact: true }).press('Enter');
		await expect(dialog).toBeHidden(AUTHORING_OPTIONS);
	};
	const inspector = async () => {
		await title.press('Enter');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Selected Visual Inspector']);
		return page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	};
	const changeTitle = async (text, size) => {
		const dialog = await inspector();
		await dialog.getByRole('textbox', { name: 'Text', exact: true }).fill(text);
		await dialog.getByRole('spinbutton', { name: 'Font size', exact: true }).fill(size);
		await dialog.getByRole('button', { name: 'Apply', exact: true }).press('Enter');
		await expect(dialog.getByRole('status').last()).toHaveText('Selected visual updated.', AUTHORING_OPTIONS);
		await closeDialog(dialog);
	};
	const library = async () => {
		await title.press('Enter');
		await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Save Visual Preset']);
		return page.getByRole('dialog', { name: 'Selected Visual Presets', exact: true });
	};
	const expectTitle = async (text, size) => {
		const dialog = await inspector();
		await expect(dialog.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue(text);
		await expect(dialog.getByRole('spinbutton', { name: 'Font size', exact: true })).toHaveValue(size);
		await closeDialog(dialog);
	};
	const applyPreset = async () => {
		const dialog = await library();
		await dialog.getByRole('combobox', { name: 'Saved visual preset', exact: true }).selectOption({ label: 'Saved title' });
		await expect(dialog.getByRole('button', { name: 'Apply to selected generator', exact: true })).toBeEnabled();
		await dialog.getByRole('button', { name: 'Apply to selected generator', exact: true }).press('Enter');
		await expect(dialog.getByRole('status')).toHaveText('Selected authored state applied.', AUTHORING_OPTIONS);
		await closeDialog(dialog);
	};
	await changeTitle('Saved title', '40');
	const saved = await library();
	await saved.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Saved title');
	await saved.getByRole('button', { name: 'Save selected generator preset', exact: true }).press('Enter');
	await expect(saved.getByRole('status')).toHaveText('Selected visual preset saved.', AUTHORING_OPTIONS);
	await closeDialog(saved);
	await changeTitle('Changed title', '72');
	await applyPreset();
	await expectTitle('Saved title', '40');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expectTitle('Changed title', '72');
	const donor = editor.locator('[data-project-bin-item]').first();
	await expect(donor.locator('[data-project-bin-name]')).toHaveValue('Saved title Model');
	await donor.getByRole('button', { name: /^More file actions:/u }).click();
	await page.getByRole('menuitem', { name: 'Remove from project', exact: true }).click();
	await page.getByRole('alertdialog', { name: 'Remove from project', exact: true })
		.getByRole('button', { name: 'Remove from project', exact: true }).click();
	await expect(editor.locator('[data-project-bin-item]')).toHaveCount(0);
	await applyPreset();
	await expectTitle('Saved title', '40');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expectTitle('Changed title', '72');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(donor.locator('[data-project-bin-name]')).toHaveValue('Saved title Model');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor.locator('[data-project-bin-item]')).toHaveCount(0);
	await applyPreset();
	await expectTitle('Saved title', '40');
});
