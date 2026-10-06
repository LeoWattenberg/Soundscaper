/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseDropdown, disableNativeSavePicker,
	openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { calculateAudioSpectrum } from '../../src/common/editor/audio-spectrum.ts';

test('generated pink noise keeps comparable energy in low-frequency octaves', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Noise');
	const generator = page.getByRole('dialog', { name: 'Noise', exact: true });
	await chooseDropdown(page, generator.locator('[data-generator-layout="noise"]').getByRole('group').first(), 'Pink');
	const duration = generator.getByRole('group', { name: 'Duration (seconds)', exact: true });
	await duration.locator('.timecode-digit').first().click();
	await page.keyboard.type('000016000');
	await page.keyboard.press('Enter');
	await generator.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(generator).toBeHidden({ timeout: 20_000 });
	const dialog = await openExportDialog(page, editor);
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 30_000 });
	const bytes = await readDownloadBytes(page, link);
	const blob = new Blob([bytes]);
	const descriptor = await inspectWavBlobPcm(blob);
	const channels = Array.from({ length: descriptor.channelCount }, () => new Float32Array(descriptor.frameCount));
	await streamWavBlobPcm(blob, { descriptor, onChunk: (chunk, metadata) => {
		chunk.forEach((samples, channel) => channels[channel].set(samples, metadata.frameOffset));
	} });
	const spectrum = calculateAudioSpectrum(channels, descriptor.sampleRate, { size: 65_536, average: true });
	const energy = (low) => spectrum.bins.filter(bin => bin.frequency >= low && bin.frequency < low * 2)
		.reduce((sum, bin) => sum + bin.amplitude ** 2, 0);
	const ratio = energy(20) / energy(80);
	expect(ratio).toBeGreaterThan(0.5);
	expect(ratio).toBeLessThan(2);
});
