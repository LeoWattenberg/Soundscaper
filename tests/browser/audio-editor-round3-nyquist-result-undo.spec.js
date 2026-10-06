/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('one Undo restores audio and labels returned by one Nyquist run', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB]);
	const before = await exportSamples(page, editor);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Tools', 'Nyquist prompt');
	const dialog = page.getByRole('dialog', { name: 'Nyquist prompt', exact: true });
	await dialog.getByRole('textbox', { name: 'Nyquist source', exact: true })
		.fill("(if (= (get '*track* 'index) 1) (mult *track* -1) '((0 \"Analysis\")))");
	await dialog.getByRole('button', { name: 'Run', exact: true }).click();
	await expect(dialog.locator('.kw-audio-editor__nyquist-output')).toContainText('label(s)', { timeout: 30_000 });
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const after = await exportSamples(page, editor);
	expect(after).toHaveLength(before.length);
	const residual = after.reduce((peak, sample, index) => Math.max(peak, Math.abs(sample - before[index])), 0);
	expect(residual).toBeLessThan(0.0001);
});
