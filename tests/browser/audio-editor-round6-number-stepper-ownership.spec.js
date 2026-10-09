/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const inputMethod of ['ordinary arrows', 'modified arrow', 'composing arrow', 'composing Enter']) test(`Generate Tone releases ${inputMethod} in its shared frequency stepper`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const dialog = page.getByRole('dialog', { name: 'Tone', exact: true });
	await dialog.getByRole('group', { name: 'Duration (seconds)', exact: true }).locator('.timecode-digit').first().click();
	await page.keyboard.type('000001000');
	await page.keyboard.press('Enter');
	const frequency = dialog.locator('[data-generator-field="frequency"] input');
	await frequency.fill('1000');
	await frequency.click();
	await frequency.press('ArrowUp');
	await expect(frequency).toHaveValue('1001');
	if (inputMethod === 'modified arrow') await frequency.press('Control+ArrowUp');
	else if (inputMethod.startsWith('composing')) await frequency.evaluate((element, key) => {
		element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, isComposing: true }));
		element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
	}, inputMethod === 'composing arrow' ? 'ArrowUp' : 'Enter');
	await expect(frequency).toHaveValue('1001');
	await expect(dialog.locator('[data-generator-field="frequency"] .number-stepper')).toHaveClass(/number-stepper--editing/u);
	await frequency.press('ArrowDown');
	await expect(frequency).toHaveValue('1000');
	await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(dialog).toBeHidden();
	const samples = await exportSamples(page, editor);
	const amplitudeAt = frequencyHz => {
		let real = 0; let imaginary = 0;
		for (let frame = 0; frame < samples.length; frame += 1) {
			const angle = 2 * Math.PI * frequencyHz * frame / 48_000;
			real += samples[frame] * Math.cos(angle); imaginary += samples[frame] * Math.sin(angle);
		}
		return 2 * Math.hypot(real, imaginary) / samples.length;
	};
	expect(samples).toHaveLength(48_000);
	expect(amplitudeAt(1000)).toBeGreaterThan(.5);
	expect(amplitudeAt(1001)).toBeLessThan(.01);
});
