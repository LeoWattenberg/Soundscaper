/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker,
	importFiles, clipByName } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

const recordings = ['voice', 'music'].map((name, index) => createWavFixture({ name: `${name}.wav`,
	frequency: index ? 440 : 330, channelCount: 1, channelAmplitudes: [0.35] }));

test('Generate Tone replaces audio across all selected tracks in one undoable action', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, recordings);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await clipByName(editor, recordings[0].name).locator('.clip-header__name').click();
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const original = await exportSamples(page, editor);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const dialog = page.getByRole('dialog', { name: 'Tone', exact: true });
	await dialog.getByRole('textbox', { name: 'Amplitude', exact: true }).fill('0');
	await dialog.getByRole('textbox', { name: 'Amplitude', exact: true }).press('Tab');
	await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(dialog).toBeHidden();
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const silent = await exportSamples(page, editor);
	expect(Math.max(...silent.map(Math.abs))).toBeLessThan(0.0001);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const restored = await exportSamples(page, editor);
	expect(Math.max(...restored.map(Math.abs))).toBeCloseTo(Math.max(...original.map(Math.abs)), 4);
});
