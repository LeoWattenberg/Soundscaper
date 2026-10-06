/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

test('beats and bars timecode follows the project tempo and time signature', async ({ page }) => {
	const editor = await bootEditor(page, '/en/');
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption('music');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const tone = page.getByRole('dialog', { name: 'Tone', exact: true });
	await tone.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(tone).toBeHidden();
	const tempo = editor.getByRole('spinbutton', { name: 'Project tempo (BPM)', exact: true });
	await tempo.fill('60');
	await tempo.press('Tab');
	const display = editor.locator('[data-editor-tool-toolbar] [data-time-display]');
	await display.locator('.timecode-digit').nth(5).click();
	await page.keyboard.press('2');
	await page.keyboard.press('Enter');
	await display.locator('.timecode__format-button').click();
	await page.getByRole('menuitem', { name: 'beats:bars', exact: true }).click();
	await expect(display.locator('.timecode-digit')).toHaveText(['0', '0', '0', '3']);
	const numerator = editor.getByRole('spinbutton', { name: 'Time signature: numerator', exact: true });
	const denominator = editor.getByRole('spinbutton', { name: 'Time signature: denominator', exact: true });
	await numerator.fill('3');
	await denominator.fill('8');
	await denominator.press('Tab');
	await expect(display.locator('.timecode-digit')).toHaveText(['0', '0', '1', '2']);
	await display.locator('.timecode-digit').last().click();
	await page.keyboard.press('ArrowUp');
	await display.locator('.timecode__format-button').click();
	await page.getByRole('menuitem', { name: 'seconds + milliseconds', exact: true }).click();
	await expect(display.locator('.timecode-digit')).toHaveText(['0', '0', '0', '0', '0', '2', '5', '0', '0']);
});
