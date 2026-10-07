/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
} from './audio-editor-test-helpers.js';

async function openMask(page, editor) {
	await chooseNestedCommandAction(page, editor, 'Effect', ['Edit Video Mask/Matte']);
	const dialog = page.getByRole('dialog', { name: 'Selected Mask / Matte', exact: true });
	await expect(dialog).toBeVisible();
	return dialog;
}

async function createSolidMask(page) {
	const editor = await bootEditor(page, '/framescaper/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Solid']);
	const clip = editor.getByRole('group', { name: 'Video clip: Solid', exact: true });
	await expect(clip).toBeVisible();
	await clip.press('Enter');
	const dialog = await openMask(page, editor);
	await dialog.getByRole('combobox', { name: 'Shape', exact: true }).selectOption('ellipse');
	await dialog.getByRole('spinbutton', { name: 'Width', exact: true }).fill('0.5');
	await dialog.getByRole('spinbutton', { name: 'Height', exact: true }).fill('0.25');
	await dialog.getByRole('button', { name: 'Create and attach mask', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Selected authored state applied.');
	return { editor, dialog };
}

test('updating an attached mask saves its changed geometry', async ({ page }) => {
	const { editor, dialog } = await createSolidMask(page);
	await dialog.getByRole('spinbutton', { name: 'Width', exact: true }).fill('0.6');
	await dialog.getByRole('button', { name: 'Update attached mask', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Selected authored state applied.');
	await page.keyboard.press('Escape');
	let reopened = await openMask(page, editor);
	await expect(reopened.getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('0.6');
	await page.keyboard.press('Escape');
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	reopened = await openMask(page, editor);
	await expect(reopened.getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('0.5');
});

test('reopening attached mask authoring shows its saved shape and extents', async ({ page }) => {
	const { editor } = await createSolidMask(page);
	await page.keyboard.press('Escape');
	const reopened = await openMask(page, editor);
	await expect(reopened.getByRole('combobox', { name: 'Shape', exact: true })).toHaveValue('ellipse');
	await expect(reopened.getByRole('spinbutton', { name: 'Width', exact: true })).toHaveValue('0.5');
	await expect(reopened.getByRole('spinbutton', { name: 'Height', exact: true })).toHaveValue('0.25');
});

test('Escape discards a recording offset draft before closing preferences', async ({ page }) => {
	const editor = await bootEditor(page, '/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Audio settings$/u }).click();
	const offset = preferences.getByRole('spinbutton').last();
	await expect(offset).toHaveValue('0');
	await offset.fill('123');
	await offset.press('Escape');
	await expect(preferences).toBeVisible();
	await expect(offset).toHaveValue('0');
	await offset.press('Tab');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	await preferences.getByRole('tab', { name: /Audio settings$/u }).click();
	await expect(preferences.getByRole('spinbutton').last()).toHaveValue('0');
});

test('an idle recording offset field leaves a later Escape available to preferences', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Audio settings$/u }).click();
	const offset = preferences.getByRole('spinbutton', { name: 'Recording offset (ms)', exact: true });
	await offset.fill('123');
	await offset.press('Escape');
	await expect(preferences).toBeVisible();
	await expect(offset).toHaveValue('0');
	await offset.press('Escape');
	await expect(preferences).toBeHidden();
});
