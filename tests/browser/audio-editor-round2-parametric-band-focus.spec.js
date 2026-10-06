/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles, openParametricEqSelectionEffect } from './audio-editor-test-helpers.js';

test('deleting a focused parametric EQ band keeps keyboard editing in its graph', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const dialog = await openParametricEqSelectionEffect(page, editor);
	const graph = dialog.getByRole('application', { name: 'Parametric equalizer response', exact: true });
	const bands = graph.getByRole('button', { name: /^Band /u });
	await expect(bands).toHaveCount(4);
	await bands.last().focus();
	await bands.last().press('Delete');
	await expect(bands).toHaveCount(3);
	await expect(bands.last()).toBeFocused();
	const frequency = dialog.getByRole('spinbutton', { name: 'Frequency (Hz)', exact: true });
	const before = Number(await frequency.inputValue());
	await page.keyboard.press('ArrowRight');
	await expect.poll(async () => Number(await frequency.inputValue())).toBeGreaterThan(before);
});
