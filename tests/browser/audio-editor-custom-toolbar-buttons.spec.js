/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	clipByName,
	collectClientErrors,
	getMenuItem,
	importFiles,
	openNestedCommandMenu,
	waitForEditor,
} from './audio-editor-test-helpers.js';
import { TRACK_MENU_TRIGGER } from './helpers/track-menu.js';

const firstTone = createWavFixture({ name: 'custom-button-first.wav', frequency: 330, duration: 8 });
const secondTone = createWavFixture({ name: 'custom-button-second.wav', frequency: 660, duration: 8 });
const UNDO_ACTION = 'action://trackedit/undo';
const REDO_ACTION = 'action://trackedit/redo';

async function openCustomization(page, editor) {
	await editor.getByRole('button', { name: 'Customize toolbar', exact: true }).click();
	const customization = page.getByRole('dialog', { name: 'Customize toolbar', exact: true });
	await expect(customization).toBeVisible();
	return customization;
}

async function openCustomButtonDialog(page, editor, name = null) {
	const customization = await openCustomization(page, editor);
	await customization.getByRole('menuitem', {
		name: name ? `Edit ${name}` : 'Custom button',
		exact: true,
	}).click();
	const dialog = page.getByRole('dialog', { name: 'Custom button', exact: true });
	await expect(dialog).toBeVisible();
	await expect(customization).toBeHidden();
	return dialog;
}

async function configureButton(dialog, { name, action, icon = 'CUT' }) {
	await dialog.getByLabel('Name', { exact: true }).fill(name);
	await dialog.getByRole('combobox', { name: 'Action', exact: true }).selectOption(action);
	await dialog.getByLabel('Search symbols', { exact: true }).fill(icon);
	await dialog.getByRole('button', { name: icon, exact: true }).click();
}

async function saveButton(dialog) {
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).toBeHidden();
}

async function selectMiddleOfClip(page, editor, name) {
	const clip = clipByName(editor, name);
	await clip.scrollIntoViewIfNeeded();
	const bounds = await clip.boundingBox();
	expect(bounds).not.toBeNull();
	const y = bounds.y + bounds.height * 0.55;
	await page.mouse.move(bounds.x + bounds.width * 0.25, y);
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width * 0.75, y, { steps: 5 });
	await page.mouse.up();
	await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(1);
}

async function selectClipTrack(editor, name) {
	const row = clipByName(editor, name).locator('xpath=ancestor::div[@data-track-row]');
	await row.locator('.track-control-panel__track-name-text').click();
	await expect(row.locator('[data-track-lane]')).toHaveAttribute('data-selected', 'true');
	return row;
}

async function expectTrackLockAction(page, row, label) {
	await row.getByRole('button', { name: TRACK_MENU_TRIGGER }).first().click();
	const menu = page.locator('.audio-editor-track-menu');
	await expect(menu).toBeVisible();
	await expect(getMenuItem(menu, label)).toBeEnabled();
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
}

test.describe('custom toolbar buttons', () => {
	test('chooses symbols from the full font and cancels without adding a button', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const dialog = await openCustomButtonDialog(page, editor);
		await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
		await configureButton(dialog, { name: 'Cancelled custom action', action: 'delete-leave-gap', icon: 'ACCIACCATURA' });
		await expect(dialog.getByRole('button', { name: 'ACCIACCATURA', exact: true })).toContainText('\uF427');
		await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
		await dialog.getByLabel('Name', { exact: true }).fill('   ');
		await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
		await dialog.getByLabel('Name', { exact: true }).fill('Cancelled custom action');
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(dialog).toBeHidden();
		await expect(editor.getByRole('button', { name: 'Cancelled custom action', exact: true })).toHaveCount(0);

		const reopened = await openCustomButtonDialog(page, editor);
		await expect(reopened.getByLabel('Name', { exact: true })).toHaveValue('');
		await page.keyboard.press('Escape');
		await expect(reopened).toBeHidden();
		await expect(editor.getByRole('button', { name: 'Cancelled custom action', exact: true })).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('persists a button and applies its action to each current selection', async ({ page }) => {
		test.setTimeout(60_000);
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');
		const dialog = await openCustomButtonDialog(page, editor);
		await dialog.getByLabel('Search actions', { exact: true }).fill('leave gap');
		const action = dialog.getByRole('combobox', { name: 'Action', exact: true });
		await expect(action.locator('option[value="delete-leave-gap"]')).toContainText('Edit');
		await expect(action.locator('option[value="delete-leave-gap"]')).toContainText('Delete and leave gap');
		await configureButton(dialog, { name: 'Lift selected audio', action: 'delete-leave-gap' });
		await saveButton(dialog);
		let button = editor.getByRole('button', { name: 'Lift selected audio', exact: true });
		await expect(button).toBeVisible();
		await expect(button).toContainText('\uF39A');
		await expect(button).toBeDisabled();

		await page.reload();
		editor = await waitForEditor(page);
		button = editor.getByRole('button', { name: 'Lift selected audio', exact: true });
		await expect(button).toBeVisible();
		await expect(button).toContainText('\uF39A');
		await expect(button).toBeDisabled();
		await importFiles(editor, [firstTone, secondTone]);
		await chooseCommandAction(page, editor, 'Select', 'Select none');
		await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(0);
		await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(0);
		await expect(button).toBeDisabled();
		const deleteMenu = await openNestedCommandMenu(page, editor, 'Edit', ['Delete']);
		await expect(getMenuItem(deleteMenu, 'Delete and leave gap')).toBeDisabled();
		await page.keyboard.press('Escape');
		await page.keyboard.press('Escape');

		await selectMiddleOfClip(page, editor, firstTone.name);
		await expect(button).toBeEnabled();
		await button.click();
		await expect(clipByName(editor, firstTone.name)).toHaveCount(2);
		await expect(clipByName(editor, secondTone.name)).toHaveCount(1);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(clipByName(editor, firstTone.name)).toHaveCount(1);

		await selectMiddleOfClip(page, editor, secondTone.name);
		await button.click();
		await expect(clipByName(editor, firstTone.name)).toHaveCount(1);
		await expect(clipByName(editor, secondTone.name)).toHaveCount(2);
		expect(errors).toEqual([]);
	});

	test('binds a context menu command to the current track as its target changes', async ({ page }) => {
		test.setTimeout(60_000);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const dialog = await openCustomButtonDialog(page, editor);
		await configureButton(dialog, { name: 'Toggle current track lock', action: 'track-lock-toggle', icon: 'LOCK_CLOSED' });
		await saveButton(dialog);
		await importFiles(editor, [firstTone, secondTone]);
		const button = editor.getByRole('button', { name: 'Toggle current track lock', exact: true });
		const firstRow = await selectClipTrack(editor, firstTone.name);
		await expect(button).toBeEnabled();
		await button.click();
		await expectTrackLockAction(page, firstRow, 'Unlock track');
		const secondRow = await selectClipTrack(editor, secondTone.name);
		await expectTrackLockAction(page, secondRow, 'Lock track');
		await button.click();
		await expectTrackLockAction(page, secondRow, 'Unlock track');

		await selectClipTrack(editor, firstTone.name);
		await button.click();
		await expectTrackLockAction(page, firstRow, 'Lock track');
		await expectTrackLockAction(page, secondRow, 'Unlock track');
		expect(errors).toEqual([]);
	});

	test('edits, hides, restores, and removes a saved custom button', async ({ page }) => {
		test.setTimeout(60_000);
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');
		let dialog = await openCustomButtonDialog(page, editor);
		await configureButton(dialog, { name: 'My undo', action: UNDO_ACTION });
		await saveButton(dialog);
		dialog = await openCustomButtonDialog(page, editor, 'My undo');
		await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('My undo');
		await expect(dialog.getByRole('combobox', { name: 'Action', exact: true })).toHaveValue(UNDO_ACTION);
		await configureButton(dialog, { name: 'My redo', action: REDO_ACTION, icon: 'ACCIACCATURA' });
		await saveButton(dialog);
		await expect(editor.getByRole('button', { name: 'My undo', exact: true })).toHaveCount(0);
		await expect(editor.getByRole('button', { name: 'My redo', exact: true })).toContainText('\uF427');

		let customization = await openCustomization(page, editor);
		const visibility = customization.getByRole('checkbox', { name: 'My redo', exact: true });
		await expect(visibility).toHaveAttribute('aria-checked', 'true');
		await visibility.click();
		await expect(visibility).toHaveAttribute('aria-checked', 'false');
		await expect(editor.getByRole('button', { name: 'My redo', exact: true })).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(customization).toBeHidden();
		await page.reload();
		editor = await waitForEditor(page);
		await expect(editor.getByRole('button', { name: 'My redo', exact: true })).toHaveCount(0);
		customization = await openCustomization(page, editor);
		await expect(visibility).toHaveAttribute('aria-checked', 'false');
		await visibility.click();
		await page.keyboard.press('Escape');
		await expect(customization).toBeHidden();
		await expect(editor.getByRole('button', { name: 'My redo', exact: true })).toContainText('\uF427');

		dialog = await openCustomButtonDialog(page, editor, 'My redo');
		await expect(dialog.getByRole('combobox', { name: 'Action', exact: true })).toHaveValue(REDO_ACTION);
		await dialog.getByRole('button', { name: 'Remove button', exact: true }).click();
		await expect(dialog).toBeHidden();
		await expect(editor.getByRole('button', { name: 'My redo', exact: true })).toHaveCount(0);
		await page.reload();
		editor = await waitForEditor(page);
		customization = await openCustomization(page, editor);
		await expect(customization.getByRole('checkbox', { name: 'My redo', exact: true })).toHaveCount(0);
		await expect(customization.getByRole('menuitem', { name: 'Edit My redo', exact: true })).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('keeps multiple buttons for the same action independent', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		for (const name of ['First custom undo', 'Second custom undo']) {
			const dialog = await openCustomButtonDialog(page, editor);
			await configureButton(dialog, { name, action: UNDO_ACTION });
			await saveButton(dialog);
		}
		await expect(editor.getByRole('button', { name: 'First custom undo', exact: true })).toHaveCount(1);
		await expect(editor.getByRole('button', { name: 'Second custom undo', exact: true })).toHaveCount(1);
		const dialog = await openCustomButtonDialog(page, editor, 'First custom undo');
		await dialog.getByRole('button', { name: 'Remove button', exact: true }).click();
		await expect(dialog).toBeHidden();
		await expect(editor.getByRole('button', { name: 'First custom undo', exact: true })).toHaveCount(0);
		await expect(editor.getByRole('button', { name: 'Second custom undo', exact: true })).toHaveCount(1);
	});
});
