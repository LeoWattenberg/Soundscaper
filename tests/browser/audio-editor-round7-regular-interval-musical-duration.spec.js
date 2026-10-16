/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, collectClientErrors,
	importFiles } from './audio-editor-test-helpers.js';

test('regular annotation intervals count a bar from their authored start after a tempo change', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/en/');
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption('music');
	await importFiles(editor, [createWavFixture({ name: 'interval-musical.wav', duration: 8, frequency: 440 })]);
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
	const markers = editor.getByRole('list', { name: 'Marker and region list', exact: true });
	for (const beats of [false, true]) {
		await chooseCommandAction(page, editor, 'Tools', 'Regular interval labels');
		const dialog = page.getByRole('dialog', { name: 'Regular interval labels', exact: true });
		const start = dialog.getByRole('group', { name: 'Start frame', exact: true });
		await start.locator('.timecode-digit').nth(5).click();
		await page.keyboard.press('4');
		await page.keyboard.press('Enter');
		await expect(start.locator('.timecode__display')).toHaveText('00h00m04.000s');
		await expect(dialog.getByRole('group', { name: 'End frame', exact: true }).locator('.timecode__display')).toHaveText('00h00m08.000s');
		const interval = dialog.getByRole('group', { name: 'Interval in frames', exact: true });
		if (beats) {
			await interval.getByRole('button', { name: 'Interval in frames: format', exact: true }).click();
			await page.getByRole('menuitem', { name: 'beats:bars', exact: true }).click();
			await interval.locator('.timecode-digit').first().click();
			await page.keyboard.type('0011');
			await page.keyboard.press('Enter');
			await expect(interval.locator('.timecode-digit')).toHaveText(['0', '0', '1', '1']);
		} else {
			await interval.locator('.timecode-digit').nth(5).click();
			await page.keyboard.press('2');
			await page.keyboard.press('Enter');
			await expect(interval.locator('.timecode__display')).toHaveText('00h00m02.000s');
		}
		await dialog.getByRole('button', { name: 'Create annotations', exact: true }).click();
		await expect(dialog).toBeHidden();
		if (!beats) await chooseNestedCommandAction(page, editor, 'Window', ['Markers']);
		await expect(markers.getByRole('listitem')).toHaveCount(2);
		await expect(markers).toContainText('Cue 1');
		await expect(markers).toContainText('Cue 2');
		await expect(markers.getByRole('listitem').locator('small').filter({ hasText: /^\d+\.\d{3} s$/u })).toHaveText(['4.000 s', '6.000 s']);
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(markers).toHaveCount(0);
	}
	expect(errors).toEqual([]);
});
