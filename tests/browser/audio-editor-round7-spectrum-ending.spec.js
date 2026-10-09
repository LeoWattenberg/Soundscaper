/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, readFile, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeDialog, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';

test('Plot spectrum finds an audible tone at the end of a one-second recording', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'ending whistle.wav', frequency: 1500, duration: 1,
		channelCount: 1, channelAmplitudes: [.5] });
	for (let frame = 0; frame < 48_000; frame++) {
		if (frame < 47_200 || frame >= 47_800) recording.buffer.writeInt16LE(0, 44 + 2 * frame);
	}
	await importFiles(editor, [recording]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Analyze', 'Analyze selection');
	const levels = page.getByRole('dialog', { name: 'Analyze selection', exact: true });
	await expect(levels.locator('[data-analysis-report="levels"]')).toBeVisible();
	const peak = Number.parseFloat(await levels.locator('[data-analysis-value="peak"]').textContent());
	expect(peak).toBeGreaterThan(-10);
	await closeDialog(levels);
	await chooseCommandAction(page, editor, 'Analyze', 'Plot spectrum');
	const spectrum = page.getByRole('dialog', { name: 'Plot spectrum', exact: true });
	await expect(spectrum.locator('[data-analysis-report="spectrum"]')).toBeVisible();
	const downloadPromise = page.waitForEvent('download');
	await spectrum.getByRole('button', { name: 'Export', exact: true }).click();
	const download = await downloadPromise;
	const report = JSON.parse(await readFile(await download.path(), 'utf8')).report;
	expect(report.peak.frequency).toBe(1500);
	expect(report.peak.db).toBeGreaterThan(-45);
});
