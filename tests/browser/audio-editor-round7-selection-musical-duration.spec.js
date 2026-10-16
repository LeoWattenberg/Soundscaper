/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';

test('Selection duration counts the musical interval at the selected start after a tempo change', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/en/');
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption('music');
	await importFiles(editor, [createWavFixture({ name: 'selection-musical-duration.wav', duration: 8, frequency: 440 })]);
	const tempo = editor.getByRole('spinbutton', { name: 'Project tempo (BPM)', exact: true });
	await tempo.fill('60');
	await tempo.press('Enter');
	await editor.getByRole('button', { name: 'Musical timeline', exact: true }).click();
	const musical = page.getByRole('dialog', { name: 'Musical timeline', exact: true });
	await musical.getByRole('button', { name: 'Add tempo event', exact: true }).click();
	const second = musical.getByRole('form', { name: 'Tempo event 2', exact: true });
	await expect(second.locator('[name="beatNum"]')).toHaveValue('4');
	await second.getByRole('spinbutton', { name: 'Tempo (BPM) numerator', exact: true }).fill('120');
	await second.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(second.getByRole('spinbutton', { name: 'Tempo (BPM) numerator', exact: true })).toHaveValue('120');
	await page.keyboard.press('Escape');
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const edge = name => editor.getByRole('group', { name: `Selection ${name}`, exact: true });
	const setEdge = async (name, digits) => {
		await edge(name).locator('.timecode-digit').nth(5).click();
		await page.keyboard.press(digits[5]);
		await page.keyboard.press('Enter');
		await expect(edge(name).locator('.timecode-digit')).toHaveText([...digits]);
	};
	await setEdge('end', '000004000');
	const duration = edge('duration');
	await expect(duration.locator('.timecode__display')).toHaveText('00h00m04.000s');
	await duration.locator('.timecode__format-button').click();
	await page.getByRole('menuitem', { name: 'beats:bars', exact: true }).click();
	await expect(duration.locator('.timecode-digit')).toHaveText(['0', '0', '1', '1']);
	await setEdge('end', '000006000');
	await setEdge('start', '000004000');
	await expect(edge('start').locator('.timecode__display')).toHaveText('00h00m04.000s');
	await expect(edge('end').locator('.timecode__display')).toHaveText('00h00m06.000s');
	await expect(duration.locator('.timecode-digit')).toHaveText(['0', '0', '1', '1']);
	expect(errors).toEqual([]);
});
