/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openParametricEqSelectionEffect } from './audio-editor-test-helpers.js';

test('a refused EQ frequency replaces its draft with the saved bounded value', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await clip.focus();
	await clip.press('Enter');
	const dialog = await openParametricEqSelectionEffect(page, editor);
	const frequency = dialog.getByRole('spinbutton', { name: 'Frequency (Hz)', exact: true });
	await frequency.fill('10');
	await frequency.press('Enter');
	await frequency.fill('0');
	await frequency.press('Enter');
	await expect(frequency).toHaveValue('10');
});
