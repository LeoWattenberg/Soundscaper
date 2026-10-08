/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('saved visual preset removal stays available without a selected generator and supports Undo', async ({ page }) => {
	test.setTimeout(60_000);
	const editor = await bootEditor(page, '/framescaper/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Solid']);
	await editor.getByRole('group', { name: 'Video clip: Solid', exact: true }).press('Enter');
	const openPresets = async () => {
		await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Save Visual Preset']);
		return page.getByRole('dialog', { name: 'Selected Visual Presets', exact: true });
	};
	let dialog = await openPresets();
	await dialog.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Old delivery look');
	await dialog.getByRole('button', { name: 'Save selected generator preset', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Selected visual preset saved.');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(dialog).toBeHidden();
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	dialog = await openPresets();
	let picker = dialog.getByRole('combobox', { name: 'Saved visual preset', exact: true });
	await expect(picker).toBeEnabled();
	await expect(dialog.getByRole('button', { name: 'Save selected generator preset', exact: true })).toBeDisabled();
	await expect(dialog.getByRole('button', { name: 'Apply to selected generator', exact: true })).toBeDisabled();
	const removal = dialog.getByRole('button', { name: 'Remove visual preset', exact: true });
	await removal.focus();
	await removal.press('Enter');
	await expect(picker.getByRole('option', { name: 'Old delivery look', exact: true })).toHaveCount(0);
	await expect(picker).toBeFocused();
	await expect(removal).toBeDisabled();
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	dialog = await openPresets();
	picker = dialog.getByRole('combobox', { name: 'Saved visual preset', exact: true });
	await expect(picker.getByRole('option', { name: 'Old delivery look', exact: true })).toHaveCount(1);
	await expect(dialog.getByRole('button', { name: 'Apply to selected generator', exact: true })).toBeDisabled();
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	dialog = await openPresets();
	picker = dialog.getByRole('combobox', { name: 'Saved visual preset', exact: true });
	await expect(picker.getByRole('option', { name: 'Old delivery look', exact: true })).toHaveCount(0);
	await expect(dialog.getByRole('button', { name: 'Remove visual preset', exact: true })).toBeDisabled();
	await expect(picker).toBeEnabled();
});

test('finishing presets apply to a visual occurrence and remain removable with audio selected', async ({ page }) => {
	test.setTimeout(60_000);
	const editor = await bootEditor(page, '/framescaper/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Solid']);
	await editor.getByRole('group', { name: 'Video clip: Solid', exact: true }).press('Enter');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Grading & Finishing Presets']);
	let dialog = page.getByRole('dialog', { name: 'Grading & Finishing Presets', exact: true });
	await dialog.getByRole('textbox', { name: 'Canonical finishing document', exact: true }).fill(JSON.stringify({
		videoVisualPresentations: [], videoFinishingPresets: [{ schemaVersion: 1, kind: 'video-finishing-preset',
			id: 'delivery-finish', name: 'Delivery finish', template: { enabled: true, opacity: 0.5, blendMode: 'screen', grade: null } }],
	}));
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Finishing state updated.');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	const openPresets = async () => {
		await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Save Visual Preset']);
		return page.getByRole('dialog', { name: 'Selected Visual Presets', exact: true });
	};
	dialog = await openPresets();
	await dialog.getByRole('combobox', { name: 'Saved finishing preset', exact: true }).selectOption({ label: 'Delivery finish' });
	await dialog.getByRole('button', { name: 'Apply as fresh presentation', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Selected authored state applied.');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await importFiles(editor, [createWavFixture({ name: 'voice.wav', duration: 1 })]);
	await editor.getByRole('group', { name: /^voice\.wav clip, starts/u }).press('Enter');
	dialog = await openPresets();
	let picker = dialog.getByRole('combobox', { name: 'Saved finishing preset', exact: true });
	await picker.selectOption({ label: 'Delivery finish' });
	await expect(dialog.getByRole('button', { name: 'Apply as fresh presentation', exact: true })).toBeDisabled();
	const removal = dialog.getByRole('button', { name: 'Remove finishing preset', exact: true });
	await removal.focus();
	await removal.press('Enter');
	await expect(picker.getByRole('option', { name: 'Delivery finish', exact: true })).toHaveCount(0);
	await expect(picker).toBeFocused();
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	dialog = await openPresets();
	picker = dialog.getByRole('combobox', { name: 'Saved finishing preset', exact: true });
	await expect(picker.getByRole('option', { name: 'Delivery finish', exact: true })).toHaveCount(1);
	await expect(dialog.getByRole('button', { name: 'Apply as fresh presentation', exact: true })).toBeDisabled();
});
