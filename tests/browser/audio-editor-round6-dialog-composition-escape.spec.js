/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('composing Escape keeps the project rename dialog and its unfinished draft open', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
	const dialog = page.getByRole('dialog', { name: 'Rename project', exact: true });
	const name = dialog.getByRole('textbox', { name: 'Project name', exact: true });
	await name.fill('とう');
	const prevented = await name.evaluate(input => {
		const event = new KeyboardEvent('keydown', {
			key: 'Escape', code: 'Escape', bubbles: true, cancelable: true, isComposing: true,
		});
		input.dispatchEvent(event);
		return event.defaultPrevented;
	});
	await expect(dialog).toBeVisible();
	expect(prevented).toBe(false);
	await expect(name).toHaveValue('とう');
	await expect(name).toBeFocused();
	await name.fill('東京の録音');
	await dialog.getByRole('button', { name: 'Save name', exact: true }).click();
	await expect(dialog).toBeHidden();
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
	await expect(name).toHaveValue('東京の録音');
	await name.press('Escape');
	await expect(dialog).toBeHidden();
});
