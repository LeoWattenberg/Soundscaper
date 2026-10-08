/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, readFile, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeDialog, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';

for (const duration of [2, 2048 / 48_000]) {
	test(`Plot spectrum calibrates an ordinary ${duration === 2 ? 'long' : 'one-window'} recording`, async ({ page }) => {
		test.setTimeout(90_000);
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createWavFixture({ name: 'calibration-750Hz.wav', frequency: 750,
			duration, channelCount: 2, channelAmplitudes: [0.5, 0.5] })]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseCommandAction(page, editor, 'Analyze', 'Analyze selection');
		let dialog = page.getByRole('dialog', { name: 'Analyze selection', exact: true });
		await expect(dialog.locator('[data-analysis-report="levels"]')).toBeVisible();
		const peak = Number.parseFloat(await dialog.locator('[data-analysis-value="peak"]').textContent());
		expect(peak).toBeGreaterThan(-6.1);
		expect(peak).toBeLessThan(-5.9);
		await closeDialog(dialog);
		await chooseCommandAction(page, editor, 'Analyze', 'Plot spectrum');
		dialog = page.getByRole('dialog', { name: 'Plot spectrum', exact: true });
		await expect(dialog.locator('[data-analysis-report="spectrum"]')).toBeVisible();
		const downloadPromise = page.waitForEvent('download');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const download = await downloadPromise;
		const report = JSON.parse(await readFile(await download.path(), 'utf8')).report;
		expect(report.peak.frequency).toBe(750);
		expect(Math.abs(report.peak.db - peak)).toBeLessThan(0.3);
	});
}
