/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('returning to Program restores Tab indentation after leaving with the mouse', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const dialog = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await dialog.getByRole('button', { name: 'New program', exact: true }).click();
	const source = dialog.getByRole('textbox', { name: 'Program', exact: true });
	await source.fill("sound.log.info('Initial');");
	await source.press('Escape');
	await expect(source).toBeFocused();
	await dialog.getByRole('textbox', { name: 'Program name', exact: true }).click();
	await source.click();
	const insertion = await source.evaluate(field => ({
		value: field.value, start: field.selectionStart, end: field.selectionEnd,
	}));
	await source.press('Tab');
	await expect(source).toHaveValue(`${insertion.value.slice(0, insertion.start)}  ${insertion.value.slice(insertion.end)}`);
	await expect(source).toBeFocused();
	await source.press('Escape');
	await source.press('Tab');
	await expect(source).not.toBeFocused();
});
