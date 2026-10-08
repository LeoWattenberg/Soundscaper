/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('Chirp interpolation does not change when the user presses modified navigation keys', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Chirp');
	const dialog = page.getByRole('dialog', { name: 'Chirp', exact: true });
	const interpolation = dialog.getByRole('radiogroup', { name: 'Interpolation', exact: true });
	const linear = interpolation.getByRole('radio', { name: 'Linear', exact: true });
	const logarithmic = interpolation.getByRole('radio', { name: 'Logarithmic', exact: true });
	await linear.focus();
	for (const chord of ['Control+ArrowRight', 'Alt+ArrowDown', 'Meta+ArrowLeft']) {
		await linear.press(chord);
		await expect(linear).toHaveAttribute('aria-checked', 'true');
		await expect(logarithmic).toHaveAttribute('aria-checked', 'false');
		await expect(linear).toBeFocused();
	}
	await linear.press('ArrowRight');
	await expect(logarithmic).toBeFocused();
	await expect(logarithmic).toHaveAttribute('aria-checked', 'true');
	await logarithmic.press('ArrowLeft');
	await expect(linear).toBeFocused();
	await expect(linear).toHaveAttribute('aria-checked', 'true');
});
