/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles, openParametricEqSelectionEffect } from './audio-editor-test-helpers.js';

test('Parametric EQ retains numeric native composition until the final completed draft', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const dialog = await openParametricEqSelectionEffect(page, editor);
	const selected = dialog.locator('[data-parametric-eq]').getByRole('region', { name: 'Selected band', exact: true });
	await selected.getByRole('combobox', { name: 'Type', exact: true }).selectOption('peaking');
	const gain = selected.getByLabel('Gain (dB)', { exact: true });
	await gain.fill('3');
	await gain.press('Enter');
	await expect(gain).toHaveValue('3');
	await gain.fill('4');
	const prevented = await gain.evaluate(field => {
		const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, isComposing: true });
		field.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(prevented).toBe(false);
	await expect(gain).toHaveValue('4');
	await expect(gain).toBeFocused();
	await gain.fill('6');
	await gain.press('Enter');
	await expect(gain).toHaveValue('6');
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});
