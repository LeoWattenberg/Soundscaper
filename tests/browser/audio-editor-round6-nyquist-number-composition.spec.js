/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

for (const key of ['Enter', 'Escape']) test(`Nyquist numeric ${key} leaves a native composition draft active`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Nyquist', 'Risset Drum']);
	const dialog = page.getByRole('dialog', { name: 'Risset Drum', exact: true });
	const amplitude = dialog.getByRole('spinbutton', { name: 'Amplitude (0 - 1)', exact: true });
	const original = await amplitude.inputValue();
	await amplitude.fill('0.5');
	await amplitude.press('Escape');
	await expect(amplitude).toHaveValue(original);
	await amplitude.fill(key === 'Enter' ? '2' : '0.5');
	await amplitude.evaluate((element, composingKey) => {
		element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: composingKey, isComposing: true }));
	}, key);
	await expect(dialog).toBeVisible();
	await expect(amplitude).toHaveValue(key === 'Enter' ? '2' : '0.5');
	await expect(amplitude).toBeFocused();
	await amplitude.dispatchEvent('compositionend');
	await amplitude.press('Escape');
	await expect(amplitude).toHaveValue(original);
	await expect(dialog).toBeVisible();
	await amplitude.press('Escape');
	await expect(dialog).toBeHidden();
});
