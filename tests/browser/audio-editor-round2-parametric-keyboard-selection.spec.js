/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles, openParametricEqSelectionEffect } from './audio-editor-test-helpers.js';

test('editing a different parametric EQ band by keyboard selects it for the inspector', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const dialog = await openParametricEqSelectionEffect(page, editor);
	const graph = dialog.getByRole('application', { name: 'Parametric equalizer response', exact: true });
	const bands = graph.getByRole('button', { name: /^Band /u });
	await expect(bands).toHaveCount(4);
	await bands.first().focus();
	await bands.first().press('Tab');
	await expect(bands.nth(1)).toBeFocused();
	const before = await bands.nth(1).getAttribute('aria-label');
	const frequency = dialog.getByRole('spinbutton', { name: 'Frequency (Hz)', exact: true });
	const originalInspector = await frequency.inputValue();
	await page.keyboard.press('ArrowRight');
	await expect(bands.nth(1)).not.toHaveAttribute('aria-label', before);
	await expect(frequency).not.toHaveValue(originalInspector);
	await expect(bands.nth(1)).toHaveAttribute('aria-pressed', 'true');
	await expect(bands.first()).toHaveAttribute('aria-pressed', 'false');
});
