/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const operation of ['Split into new track', 'Split stereo track']) test(`${operation} retains the volume automation of the audio it moves`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await clip.locator('.clip-header').click();
	const originalRow = clip.locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, originalRow, 'Add automation');
	const points = originalRow.locator('[data-automation-point-id]');
	await originalRow.getByRole('button', { name: /^Insert automation point:/u }).press('Enter');
	await expect(points).toHaveCount(2);
	for (let index = 0; index < 2; index += 1) {
		await points.nth(index).focus();
		for (let step = 0; step < 5; step += 1) await page.keyboard.press('Shift+ArrowDown');
		await expect(points.nth(index)).toHaveAttribute('aria-valuenow', '0.5');
	}
	const before = await exportSamples(page, editor);
	await clip.locator('.clip-header').click();
	if (operation === 'Split into new track') {
		await chooseNestedCommandAction(page, editor, 'Select', ['Region', 'Track start to end']);
		await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', operation]);
	} else await chooseTrackMenuAction(page, editor, originalRow, ['Track channels', 'Split stereo to left/right mono']);
	await expect(editor.locator('[data-track-row]')).toHaveCount(3);
	const after = await exportSamples(page, editor);
	const energy = samples => samples.reduce((total, sample) => total + sample * sample, 0);
	expect(after.length).toBe(before.length);
	expect(Math.sqrt(energy(after) / energy(before))).toBeCloseTo(1, 2);
});
