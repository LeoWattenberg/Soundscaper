/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('Nyquist numeric cancellation leaves idle Escape available to close its dialog', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Nyquist', 'Risset Drum']);
	const dialog = page.getByRole('dialog', { name: 'Risset Drum', exact: true });
	const amplitude = dialog.getByRole('spinbutton', { name: 'Amplitude (0 - 1)', exact: true });
	const original = await amplitude.inputValue();
	await amplitude.fill('0.5');
	await amplitude.press('Escape');
	await expect(amplitude).toHaveValue(original);
	await expect(dialog).toBeVisible();
	await expect(amplitude).toBeFocused();
	await amplitude.press('Escape');
	await expect(dialog).toBeHidden();
});
