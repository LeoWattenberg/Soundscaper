/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseDropdown, chooseNestedCommandAction,
	disableNativeSavePicker } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('Loudness normalization lowers an ordinary generated high-frequency square tone', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const generator = page.getByRole('dialog', { name: 'Tone', exact: true });
	await chooseDropdown(page, generator.getByRole('group', { name: 'Waveform', exact: true }), 'Square');
	const frequency = generator.getByRole('textbox', { name: 'Frequency (Hz)', exact: true });
	await frequency.fill('10000');
	await frequency.press('Tab');
	const duration = generator.getByRole('group', { name: 'Duration (seconds)', exact: true });
	await duration.locator('.timecode-digit').first().click();
	await page.keyboard.type('000001000');
	await page.keyboard.press('Enter');
	await generator.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(generator).toBeHidden();
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Loudness Normalization']);
	const effect = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await effect.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(effect).toBeHidden({ timeout: 20_000 });
	const samples = await exportSamples(page, editor);
	const peak = samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
	expect(peak).toBeGreaterThan(0.01);
	expect(peak).toBeLessThan(0.08);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const original = await exportSamples(page, editor);
	expect(original.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0)).toBeGreaterThan(0.79);
});
