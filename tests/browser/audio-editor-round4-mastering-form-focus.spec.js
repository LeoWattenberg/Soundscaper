/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, longTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('committing a mastering sequence name keeps its field available for continued keyboard editing', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [longTone]);
	await chooseCommandAction(page, editor, 'Tools', 'Mastering sequences');
	const mastering = page.getByRole('dialog', { name: 'Mastering sequences', exact: true });
	await mastering.getByRole('button', { name: 'New sequence', exact: true }).click();
	const name = mastering.getByRole('form', { name: 'Sequence name', exact: true }).getByRole('textbox');
	await name.fill('Album order');
	await name.press('Enter');
	await expect(name).toHaveValue('Album order');
	await expect(name).toBeFocused();
	await page.keyboard.type(' encore');
	await expect(name).toHaveValue('Album order encore');
	await page.keyboard.press('Enter');
	await expect(mastering.getByRole('combobox', { name: 'Sequence', exact: true })
		.locator('option:checked')).toHaveText('Album order encore');
	await expect(name).toBeFocused();
});
