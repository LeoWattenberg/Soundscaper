/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, openClipProperties } from './audio-editor-test-helpers.js';

test('DTMF delivers the exact total duration entered in its dialog', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'DTMF tones');
	const generator = page.getByRole('dialog', { name: 'DTMF tones', exact: true });
	await generator.getByRole('textbox', { name: 'DTMF sequence', exact: true }).fill('1234567890');
	const duration = generator.getByRole('group', { name: 'Duration (seconds)', exact: true });
	await duration.locator('.timecode-digit').first().click();
	await page.keyboard.type('000001000');
	await page.keyboard.press('Enter');
	await expect(duration.locator('.timecode__display')).toHaveText('00h00m01.000s');
	await generator.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(generator).toBeHidden();
	const properties = await openClipProperties(page, editor);
	await properties.getByText('Media settings', { exact: true }).click();
	await expect(properties.locator('[data-clip-field="durationFrame"] [data-timecode-direct-entry]')).toHaveValue('48000');
});
