/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, closeDialog, importFiles } from './audio-editor-test-helpers.js';

for (const duration of [0.01, 0.02]) test(`Plot spectrum refuses an ordinary ${duration}s recording shorter than its configured window`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'short-calibration.wav', frequency: 750,
		duration, sampleRate: 48_000, channelCount: 2, channelAmplitudes: [0.5, 0.5] })]);
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
	await expect(dialog.locator('[data-analysis-report="spectrum"], [role="alert"]')).toHaveCount(1);
	const plotted = dialog.locator('[data-analysis-report="spectrum"]');
	if (await plotted.count()) {
		console.log(`Actual short-recording peak ${peak} dBFS; misleading Plot spectrum: ${await plotted.textContent()}`);
	}
	await expect(dialog.getByRole('alert')).toBeVisible();
	await expect(dialog.locator('[data-analysis-report="spectrum"]')).toHaveCount(0);
	await expect(page.getByRole('alert').filter({ hasText: 'at least 2048 samples' })).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeDisabled();
	if (duration === 0.01) return;
	await closeDialog(dialog);
	await chooseNestedCommandAction(page, editor, 'Select', ['Tracks', 'No tracks']);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Track display$/u }).click();
	const settings = preferences.locator('[data-spectrogram-settings]');
	await expect(settings).toHaveAttribute('data-spectrogram-target', 'defaults');
	await settings.getByLabel('Window size', { exact: true }).selectOption('512');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Analyze', 'Plot spectrum');
	dialog = page.getByRole('dialog', { name: 'Plot spectrum', exact: true });
	const corrected = dialog.locator('[data-analysis-report="spectrum"]');
	await expect(corrected).toContainText('750.0 Hz');
	await expect(corrected).toContainText('512 FFT');
	const correctedLevel = Number((await corrected.textContent()).match(/· (-?[\d.]+) dB/u)?.[1]);
	expect(Math.abs(correctedLevel - peak)).toBeLessThan(0.3);
	await expect(dialog.getByRole('alert')).toHaveCount(0);
	await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
});
