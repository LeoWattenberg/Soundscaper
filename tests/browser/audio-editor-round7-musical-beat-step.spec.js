/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';

test('native musical beat stepping reverses a forward bar crossing', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/en/');
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption('music');
	await importFiles(editor, [createWavFixture({ name: 'musical-beat-step.wav', duration: 8, frequency: 440 })]);
	const tempo = editor.getByRole('spinbutton', { name: 'Project tempo (BPM)', exact: true });
	await tempo.fill('60');
	await tempo.press('Enter');
	const playhead = editor.locator('[data-editor-tool-toolbar] [data-time-display]');
	await playhead.locator('.timecode-digit').nth(5).click();
	await page.keyboard.press('2');
	await page.keyboard.press('Enter');
	await expect(playhead.locator('.timecode-digit')).toHaveText(['0', '0', '0', '0', '0', '2', '0', '0']);
	await playhead.getByRole('button', { name: 'Playhead: Format', exact: true }).click();
	await page.getByRole('menuitem', { name: 'beats:bars', exact: true }).click();
	await expect(playhead.locator('.timecode-digit')).toHaveText(['0', '0', '0', '3']);
	await playhead.locator('.timecode-digit').last().click();
	await page.keyboard.press('ArrowDown');
	await expect(playhead.locator('.timecode-digit')).toHaveText(['0', '0', '0', '2']);
	await page.keyboard.press('ArrowUp');
	await expect(playhead.locator('.timecode-digit')).toHaveText(['0', '0', '0', '3']);
	await page.keyboard.press('4');
	await playhead.locator('.timecode-digit').last().click();
	await page.keyboard.press('ArrowUp');
	await expect(playhead.locator('.timecode-digit')).toHaveText(['0', '0', '1', '1']);
	await page.keyboard.press('ArrowDown');
	await expect(playhead.locator('.timecode-digit')).toHaveText(['0', '0', '0', '4']);
	await expect(editor.getByRole('slider', { name: 'Playhead', exact: true })).toHaveAttribute('aria-valuenow', '144000');
	expect(errors).toEqual([]);
});
