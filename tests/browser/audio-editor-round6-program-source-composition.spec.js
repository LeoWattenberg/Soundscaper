/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('canceling input-method composition in Program preserves subsequent Tab indentation', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const dialog = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await dialog.getByRole('button', { name: 'New program', exact: true }).click();
	const source = dialog.getByRole('textbox', { name: 'Program', exact: true });
	await source.fill('// とう');
	const prevented = await source.evaluate(field => {
		const event = new KeyboardEvent('keydown', {
			key: 'Escape', code: 'Escape', bubbles: true, cancelable: true, isComposing: true,
		});
		field.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(prevented).toBe(false);
	await expect(source).toBeFocused();
	await source.fill('// 東京');
	await source.press('End');
	await source.press('Tab');
	await expect(source).toHaveValue('// 東京  ');
	await expect(source).toBeFocused();
	await source.press('Escape');
	await source.press('Tab');
	await expect(source).not.toBeFocused();
	await expect(dialog).toBeVisible();
});
