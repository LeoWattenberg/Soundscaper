/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, disableNativeSavePicker,
	importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('Cancel during selection-effect rendering leaves the recording unchanged', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'room-recording.wav', frequency: 440,
		duration: 30, channelCount: 1, channelAmplitudes: [0.1] });
	await importFiles(editor, [recording]);
	const original = await exportSamples(page, editor);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Delay and reverb', 'Reverb']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(editor.locator('[data-editor-task-progress]')).toBeVisible();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(editor.locator('[data-editor-task-progress]')).toBeHidden({ timeout: 30_000 });
	const cancelled = await exportSamples(page, editor);
	expect(cancelled.length).toBe(original.length);
	let maximumDifference = 0;
	for (let frame = 0; frame < original.length; frame++) {
		maximumDifference = Math.max(maximumDifference, Math.abs(cancelled[frame] - original[frame]));
	}
	expect(maximumDifference).toBeLessThan(0.0001);
});
