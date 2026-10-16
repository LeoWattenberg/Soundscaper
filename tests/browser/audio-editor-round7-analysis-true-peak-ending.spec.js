/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('Analyze selection includes the ending true peak of an ordinary Fade In', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'high frequency recording.wav', sampleRate: 48_000,
		frequency: 12_000, duration: 1, channelCount: 1, channelAmplitudes: [.5] })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Fading', 'Fade In']);
	await expect(editor.locator('[data-status]')).toHaveText('Applied the Audacity effect.');
	const end = editor.getByRole('group', { name: 'Selection end', exact: true });
	await end.locator('.timecode__format-button').click();
	await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
	await expect(end.locator('.timecode-digit')).toHaveText([...('48000'.padStart(12, '0'))]);
	await end.locator('.timecode-digit').nth(7).click();
	await page.keyboard.press('3');
	await expect(end.locator('.timecode-digit')).toHaveText([...('38000'.padStart(12, '0'))]);
	await end.locator('.timecode-digit').nth(8).click();
	await page.keyboard.press('6');
	await page.keyboard.press('Enter');
	await expect(end.locator('.timecode-digit')).toHaveText([...('36000'.padStart(12, '0'))]);
	await chooseCommandAction(page, editor, 'Analyze', 'Analyze selection');
	const analysis = page.getByRole('dialog', { name: 'Analyze selection', exact: true });
	await expect(analysis.locator('[data-analysis-value="peak"]')).toHaveText('-11.5 dBFS');
	await expect(analysis.locator('[data-analysis-value="truePeak"]')).toHaveText('-11.4 dBTP');
});
