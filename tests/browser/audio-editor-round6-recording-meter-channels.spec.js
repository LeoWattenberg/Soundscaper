/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseDropdown, disableNativeSavePicker, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

test('the recording meter preserves an ordinary stereo microphone silent right channel', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
			enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'default',
				groupId: 'stereo-microphone', label: 'Stereo microphone' }],
			async getUserMedia() {
				const context = new AudioContext({ sampleRate: 48_000 });
				const oscillator = context.createOscillator();
				const gain = context.createGain();
				const merger = context.createChannelMerger(2);
				const destination = context.createMediaStreamDestination();
				oscillator.frequency.value = 440; gain.gain.value = .8;
				oscillator.connect(gain).connect(merger, 0, 0);
				merger.connect(destination); oscillator.start();
				await context.resume();
				return destination.stream;
			},
		} });
	});
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
	await page.getByRole('radio', { name: 'Stereo', exact: true }).click();
	await page.keyboard.press('Escape');
	const record = editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button');
	await record.click();
	await expect(record).toHaveAttribute('aria-label', 'Pause recording');
	await expect(editor.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
	await page.waitForTimeout(1000);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(record).toHaveAttribute('aria-pressed', 'false');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const exportDialog = await openExportDialog(page, editor);
	await chooseDropdown(page, exportDialog.locator('[data-export-field="bitDepth"]'), '32-bit Float');
	await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = exportDialog.locator('[data-export-download]');
	await expect(link).toBeVisible();
	const bytes = await readDownloadBytes(page, link);
	const levels = await page.evaluate(async data => {
		const context = new AudioContext({ sampleRate: 48_000 });
		try {
			const audio = await context.decodeAudioData(new Uint8Array(data).buffer);
			return Array.from({ length: audio.numberOfChannels }, (_, channel) =>
				audio.getChannelData(channel).reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0));
		} finally { await context.close(); }
	}, Array.from(bytes));
	expect(levels).toHaveLength(2);
	expect(levels[0]).toBeGreaterThan(.7);
	expect(levels[1]).toBe(0);
	await exportDialog.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseCommandAction(page, editor, 'Window', 'Recording meter');
	const panel = editor.locator('[data-workspace-panel="recording-meter"]');
	if (!await panel.count()) await chooseCommandAction(page, editor, 'Window', 'Recording meter');
	await panel.getByRole('button', { name: 'Record level', exact: true }).click();
	await page.getByRole('checkbox', { name: 'Show mic metering when not recording', exact: true }).check();
	await page.keyboard.press('Escape');
	const fills = panel.locator('.kw-audio-editor__playback-meter-peak');
	await expect(fills).toHaveCount(2);
	const level = fill => fill.evaluate(element => Number.parseFloat(getComputedStyle(element).getPropertyValue('--playback-meter-peak')));
	await expect.poll(() => level(fills.first())).toBeGreaterThan(80);
	await expect.poll(() => level(fills.nth(1))).toBe(0);
});
