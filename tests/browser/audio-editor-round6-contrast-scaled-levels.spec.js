/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseDropdown, chooseNestedCommandAction, clipByName, clipField,
	closeClipProperties, commitInput, disableNativeSavePicker, importFiles, openClipProperties,
	openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../../src/common/editor/wav-import.js';

async function deliveredRms(page, editor) {
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '32-bit Float');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible();
	const blob = new Blob([await readDownloadBytes(page, link)]);
	const descriptor = await inspectWavBlobPcm(blob);
	let power = 0; let frames = 0;
	await streamWavBlobPcm(blob, { descriptor, onChunk: chunk => {
		for (const sample of chunk[0]) { power += sample ** 2; frames += 1; }
	} });
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	return Math.sqrt(power / frames);
}

test('ordinary equal attenuation preserves the foreground/background Contrast decision', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const foreground = createWavFixture({ name: 'Contrast foreground.wav', frequency: 440, duration: 1 });
	const background = createWavFixture({ name: 'Contrast background.wav', frequency: 440, duration: 1 });
	await importFiles(editor, [foreground, background]);
	const rows = await Promise.all([foreground, background].map(async wav => {
		const id = await clipByName(editor, wav.name).locator('xpath=ancestor::div[@data-track-row]').getAttribute('data-track-id');
		return editor.locator(`[data-track-row][data-track-id="${id}"]`);
	}));
	const properties = await openClipProperties(page, editor, clipByName(editor, background.name));
	await properties.getByText('Normalize', { exact: true }).click();
	await commitInput(clipField(properties, 'gain'), '-30');
	await expect(clipField(properties, 'gain')).toHaveValue('-30.00');
	await closeClipProperties(properties);
	await rows[1].getByRole('button', { name: 'Mute', exact: true }).click();
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Analyze', 'Contrast');
	const contrast = page.getByRole('dialog', { name: 'Contrast', exact: true });
	const report = contrast.locator('[data-analysis-report="contrast"]');
	await contrast.getByRole('button', { name: 'Measure foreground', exact: true }).click();
	await expect(report).toBeVisible();
	await rows[0].getByRole('button', { name: 'Mute', exact: true }).click();
	await rows[1].getByRole('button', { name: 'Mute', exact: true }).click();
	await contrast.getByRole('button', { name: 'Measure background', exact: true }).click();
	await expect(report).toContainText('30.00 dB');
	await expect(report).toContainText('Contrast meets the recommended 20 dB difference.');
	await contrast.getByRole('button', { name: 'Close', exact: true }).click();
	for (let application = 0; application < 2; application += 1) {
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Amplify']);
		const effect = page.getByRole('dialog', { name: 'Apply effect', exact: true });
		await commitInput(effect.locator('[data-effect-param="gainDb"] input[type="number"]'), '-50');
		await effect.getByRole('button', { name: 'Apply to selection', exact: true }).click();
		await expect(effect).toBeHidden({ timeout: 20_000 });
	}
	await rows[0].getByRole('button', { name: 'Mute', exact: true }).click();
	await rows[1].getByRole('button', { name: 'Mute', exact: true }).click();
	await chooseCommandAction(page, editor, 'Analyze', 'Contrast');
	await contrast.getByRole('button', { name: 'Measure foreground', exact: true }).click();
	await expect(report).toContainText('Foreground RMS: -112.1 dBFS');
	await rows[0].getByRole('button', { name: 'Mute', exact: true }).click();
	await rows[1].getByRole('button', { name: 'Mute', exact: true }).click();
	await contrast.getByRole('button', { name: 'Measure background', exact: true }).click();
	await expect(contrast.getByRole('button', { name: 'Measure background', exact: true })).toBeEnabled();
	await contrast.getByRole('button', { name: 'Close', exact: true }).click();
	const backgroundRms = await deliveredRms(page, editor);
	await rows[0].getByRole('button', { name: 'Mute', exact: true }).click();
	await rows[1].getByRole('button', { name: 'Mute', exact: true }).click();
	const foregroundRms = await deliveredRms(page, editor);
	expect(backgroundRms).toBeGreaterThan(1e-8);
	expect(foregroundRms).toBeGreaterThan(1e-6);
	expect(20 * Math.log10(foregroundRms / backgroundRms)).toBeCloseTo(30, 4);
	await chooseCommandAction(page, editor, 'Analyze', 'Contrast');
	console.log('ordinary twice-attenuated Contrast report', {
		foregroundRms, backgroundRms, actualDifferenceDb: 20 * Math.log10(foregroundRms / backgroundRms),
		report: await report.innerText(),
	});
	await expect(report).toContainText('30.00 dB');
	await expect(report).toContainText('Contrast meets the recommended 20 dB difference.');
	await expect(report).toContainText('Background RMS: -120.0 dBFS');
	await contrast.getByRole('button', { name: 'Measure foreground', exact: true }).click();
	await rows[0].getByRole('button', { name: 'Mute', exact: true }).click();
	await contrast.getByRole('button', { name: 'Measure background', exact: true }).click();
	await expect(report).toContainText('Difference: ∞ dB');
	await expect(report).toContainText('Contrast meets the recommended 20 dB difference.');
	await contrast.getByRole('button', { name: 'Measure foreground', exact: true }).click();
	await expect(report).toContainText('Difference: 0.00 dB');
	await expect(report).toContainText('Contrast is below the recommended 20 dB difference.');
	await rows[1].getByRole('button', { name: 'Mute', exact: true }).click();
	await contrast.getByRole('button', { name: 'Measure background', exact: true }).click();
	await expect(report).toContainText('Difference: −∞ dB');
	await expect(report).toContainText('Contrast is below the recommended 20 dB difference.');
	await contrast.getByRole('button', { name: 'Close', exact: true }).click();
});
