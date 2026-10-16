/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('output bus renaming keeps the native composing Enter in its text field', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Add track', exact: true }).click();
	await page.locator('.add-track-flyout').getByRole('menuitem', { name: 'Send track', exact: true }).click();
	const row = editor.locator('[data-output-track-row][data-output-scope="send"]').first();
	const name = row.locator('.track-control-panel__track-name-text');
	const original = await name.innerText();
	await name.dblclick();
	const input = row.getByRole('textbox');
	await expect(input).toBeFocused();
	await input.fill('とう');
	const prevented = await input.evaluate(field => {
		const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, isComposing: true });
		field.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(prevented).toBe(false);
	await expect(input).toBeFocused();
	await expect(name).toHaveText(original);
	await input.fill('東京の送信');
	await input.press('Enter');
	await expect(input).toHaveCount(0);
	await expect(name).toHaveText('東京の送信');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(name).toHaveText(original);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(name).toHaveText('東京の送信');
});
