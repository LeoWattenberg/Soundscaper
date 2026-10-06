/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

test('spectral amplification requires a gain inside its displayed bounds', async ({ page }) => {
	test.setTimeout(60_000);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const tone = page.getByRole('dialog', { name: 'Tone', exact: true });
	const duration = tone.getByRole('group', { name: 'Duration (seconds)', exact: true });
	await duration.locator('.timecode-digit').first().click();
	await page.keyboard.type('000001000');
	await page.keyboard.press('Enter');
	await expect(duration.locator('.timecode__display')).toHaveText('00h00m01.000s');
	await tone.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(tone).toBeHidden();
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	await editor.getByRole('button', { name: 'Spectrogram options', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Select spectral frequency range', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Spectral selection', exact: true });
	const gain = dialog.getByRole('textbox', { name: /^Gain \(dB\)/u });
	const apply = dialog.getByRole('button', { name: 'Spectral Amplify', exact: true });
	await gain.fill('100');
	await expect(apply).toBeDisabled();
	await gain.fill('-100');
	await expect(apply).toBeDisabled();
	await gain.fill('-60');
	await expect(apply).toBeEnabled();
	await apply.click();
	await expect(dialog).toBeHidden({ timeout: 20_000 });
});
