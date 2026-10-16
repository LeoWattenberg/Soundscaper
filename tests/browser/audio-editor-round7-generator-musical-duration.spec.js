/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeWorkspacePanel, collectClientErrors,
	importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('one generated bar follows the tempo at its ordinary insertion playhead', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/en/');
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption('music');
	await importFiles(editor, [createWavFixture({ name: 'musical-duration.wav', duration: 8, frequency: 440 })]);
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
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	const generateBar = async () => {
		await chooseCommandAction(page, editor, 'Generate', 'Tone');
		const tone = page.getByRole('dialog', { name: 'Tone', exact: true });
		const duration = tone.locator('[data-generator-field="durationSeconds"]');
		await duration.getByRole('button', { name: 'Duration (seconds): format', exact: true }).click();
		await page.getByRole('menuitem', { name: 'beats:bars', exact: true }).click();
		await duration.locator('.timecode-digit').first().click();
		await page.keyboard.type('0011');
		await page.keyboard.press('Enter');
		await expect(duration.locator('.timecode-digit')).toHaveText(['0', '0', '1', '1']);
		await tone.getByRole('button', { name: 'Generate', exact: true }).click();
		await expect(tone).toBeHidden();
		const properties = await openClipProperties(page, editor);
		await properties.locator('summary').filter({ hasText: 'Media settings' }).click({ position: { x: 16, y: 4 } });
		return properties;
	};
	let properties = await generateBar();
	await expect(properties.locator('[data-clip-field="durationFrame"] [data-timecode-direct-entry]')).toHaveValue('192000');
	await closeWorkspacePanel(editor, 'clip-properties');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const playhead = editor.locator('[data-editor-tool-toolbar] [data-time-display]');
	await playhead.locator('.timecode-digit').nth(5).click();
	await page.keyboard.press('4');
	await page.keyboard.press('Enter');
	await expect(playhead.locator('.timecode-digit')).toHaveText(['0', '0', '0', '0', '0', '4', '0', '0']);
	properties = await generateBar();
	await expect(properties.locator('[data-clip-field="durationFrame"] [data-timecode-direct-entry]')).toHaveValue('96000');
	expect(errors).toEqual([]);
});
