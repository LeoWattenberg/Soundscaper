/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, readFile, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles, disableNativeSavePicker } from './audio-editor-test-helpers.js';

test('Plot spectrum displays the measured peak of a high-frequency tone', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'high-tone.wav', frequency: 10_000,
		duration: 0.8, channelCount: 2 })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Analyze', 'Plot spectrum');
	const dialog = page.getByRole('dialog', { name: 'Plot spectrum', exact: true });
	await expect(dialog.locator('[data-analysis-report="spectrum"]')).toBeVisible();
	const downloadPromise = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const download = await downloadPromise;
	const path = await download.path();
	if (!path) throw new Error('Missing exported spectrum report');
	const report = JSON.parse(await readFile(path, 'utf8')).report;
	expect(Math.abs(report.peak.frequency - 10_000)).toBeLessThan(25);
	const points = await dialog.locator('[data-analysis-spectrum] polyline').getAttribute('points');
	const plottedPeakDb = -Math.min(...points.split(' ').map((point) => Number(point.split(',')[1]))) / 150 * 120;
	expect(Math.abs(plottedPeakDb - report.peak.db)).toBeLessThan(1);
});
