/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';

test('Timed recording one-bar duration follows the programme insertion tempo', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/en/');
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption('music');
	await importFiles(editor, [createWavFixture({ name: 'Recording programme.wav', duration: 8 })]);
	const tempo = editor.getByRole('spinbutton', { name: 'Project tempo (BPM)', exact: true });
	await tempo.fill('60'); await tempo.press('Enter');
	await editor.getByRole('button', { name: 'Musical timeline', exact: true }).click();
	const musical = page.getByRole('dialog', { name: 'Musical timeline', exact: true });
	await musical.getByRole('button', { name: 'Add tempo event', exact: true }).click();
	const event = musical.getByRole('form', { name: 'Tempo event 2', exact: true });
	await expect(event.locator('[name="beatNum"]')).toHaveValue('4');
	await event.getByRole('spinbutton', { name: 'Tempo (BPM) numerator', exact: true }).fill('120');
	await event.getByRole('button', { name: 'Save', exact: true }).click();
	await page.keyboard.press('Escape');
	const playhead = editor.locator('[data-editor-tool-toolbar] [data-time-display]');
	await playhead.locator('.timecode-digit').nth(5).click();
	await page.keyboard.press('4'); await page.keyboard.press('Enter');
	await expect(playhead.locator('.timecode-digit')).toHaveText(['0', '0', '0', '0', '0', '4', '0', '0']);
	await editor.getByRole('button', { name: 'Record options', exact: true }).click();
	await page.getByRole('dialog', { name: 'Record options', exact: true })
		.getByRole('button', { name: 'Timed recording', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Set up timed recording', exact: true });
	const dateTimes = dialog.locator('input[type="datetime-local"]');
	const start = new Date(Date.now() + 3_600_000); start.setSeconds(0, 0);
	const localStart = new Date(start.getTime() - start.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
	await dateTimes.first().fill(localStart);
	const duration = dialog.getByRole('group', { name: 'Duration', exact: true });
	await enter('000005000');
	await expect.poll(rangeMilliseconds).toBe(5000);
	await duration.getByRole('button', { name: 'Duration: format', exact: true }).click();
	await page.getByRole('menuitem', { name: 'beats:bars', exact: true }).click();
	await enter('0011');
	await expect.poll(rangeMilliseconds).toBe(2000);
	await expect(dialog.getByRole('alert')).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(dialog).toBeHidden(); expect(errors).toEqual([]);

	async function enter(digits) {
		await duration.locator('.timecode-digit').first().click();
		await page.keyboard.type(digits); await page.keyboard.press('Enter');
	}
	async function rangeMilliseconds() {
		return new Date(await dateTimes.nth(1).inputValue()).getTime()
			- new Date(await dateTimes.first().inputValue()).getTime();
	}
});
