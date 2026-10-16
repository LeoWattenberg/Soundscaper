/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, collectClientErrors } from './audio-editor-test-helpers.js';

test('configured workspace commands release native notes conversion and resume after completion', async ({ page }) => {
	const clientErrors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const command = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await command.getByRole('textbox').first().fill('F7');
	await command.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(command.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await editor.getByRole('group', { name: 'Playhead', exact: true }).focus();
	await page.keyboard.press('F7');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	await chooseNestedCommandAction(page, editor, 'Window', ['Recording notes']);
	const notes = editor.getByRole('textbox', { name: 'Recording notes', exact: true });
	await notes.fill('Take one');
	await notes.press('F7');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	await notes.fill('とう');
	for (const nativeState of [{ isComposing: true, keyCode: 118 }, { isComposing: false, keyCode: 229 }]) {
		const prevented = await notes.evaluate((field, state) => {
			const event = new KeyboardEvent('keydown', { key: 'F7', code: 'F7', bubbles: true,
				cancelable: true, isComposing: state.isComposing, keyCode: state.keyCode });
			field.dispatchEvent(event);
			return event.defaultPrevented;
		}, nativeState);
		expect(prevented).toBe(false);
		await expect(editor.locator('[data-label-track]')).toHaveCount(0);
		await expect(notes).toBeFocused();
		await expect(notes).toHaveValue('とう');
	}
	await notes.fill('東京の録音');
	await notes.press('F7');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	expect(clientErrors).toEqual([]);
});
