/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('DTMF refuses timing that gives a tone less than one source sample', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'DTMF tones');
	const dialog = page.getByRole('dialog', { name: 'DTMF tones', exact: true });
	const duration = dialog.getByRole('group', { name: 'Duration (seconds)', exact: true });
	await duration.locator('.timecode-digit').first().click();
	await page.keyboard.type('000000001');
	await page.keyboard.press('Enter');
	await expect(duration.locator('.timecode__display')).toHaveText('00h00m00.001s');
	const duty = dialog.getByRole('textbox', { name: 'Duty cycle', exact: true });
	await duty.fill('1');
	await duty.press('Tab');
	await expect(duty).toHaveValue('1');
	await expect(dialog.getByRole('button', { name: 'Generate', exact: true })).toBeDisabled();
	await expect(dialog.getByRole('alert')).toContainText('at least one sample');
	await duty.fill('100');
	await duty.press('Tab');
	await expect(dialog.getByRole('button', { name: 'Generate', exact: true })).toBeEnabled();
	await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});
