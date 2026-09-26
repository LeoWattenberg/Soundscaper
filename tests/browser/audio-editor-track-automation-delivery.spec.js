/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseDropdown,
	clipByName,
	collectClientErrors,
	disableNativeSavePicker,
	importFiles,
	openExportDialog,
	readDownloadBytes,
	registerAudioEditorHooks,
	waitForEditor,
} from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

const TONE_AMPLITUDE = 0.25;
const RAMP_END_GAIN = 0.2;

test.describe('Soundscaper track automation delivery', () => {
	registerAudioEditorHooks();

	test('renders a UI-authored gain ramp into the downloaded WAV after reload', async ({ page }) => {
		test.setTimeout(90_000);
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		const tone = createWavFixture({
			name: 'automation-delivery-tone.wav',
			frequency: 400,
			duration: 1,
			channelCount: 1,
			channelAmplitudes: [TONE_AMPLITUDE],
		});
		let editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [tone]);
		let row = clipByName(editor, tone.name).locator('xpath=ancestor::div[@data-track-row]');

		await chooseTrackMenuAction(page, editor, row, 'Add automation');
		let overlay = row.locator('[data-track-automation-overlay]');
		const curve = overlay.locator('[data-automation-insert-point]').first();
		await curve.focus();
		await page.keyboard.press('i');
		let points = overlay.locator('[data-automation-point-id]');
		await expect(points).toHaveCount(2);
		for (let step = 0; step < 8; step += 1) {
			await points.last().press('Shift+ArrowDown');
		}
		await expect(points.last()).toHaveAttribute('aria-valuenow', String(RAMP_END_GAIN));
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', {
			timeout: 15_000,
		});

		const projectId = await editor.getAttribute('data-project-id');
		expect(projectId).toBeTruthy();
		await page.reload();
		editor = await waitForEditor(page);
		await expect(editor).toHaveAttribute('data-project-id', projectId);
		row = clipByName(editor, tone.name).locator('xpath=ancestor::div[@data-track-row]');
		await chooseTrackMenuAction(page, editor, row, 'Add automation');
		overlay = row.locator('[data-track-automation-overlay]');
		points = overlay.locator('[data-automation-point-id]');
		await expect(points).toHaveCount(2);
		await expect(points.last()).toHaveAttribute('aria-valuenow', String(RAMP_END_GAIN));

		const dialog = await openExportDialog(page, editor);
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const download = dialog.locator('[data-export-download]');
		await expect(download).toBeVisible({ timeout: 20_000 });
		const probe = await decodeRmsWindows(page, await readDownloadBytes(page, download));

		expect(probe.duration).toBeCloseTo(1, 3);
		expect(probe.channelCount).toBe(2);
		expect(probe.earlyRms).toBeGreaterThan(probe.lateRms);
		const earlyStartGain = 1 - 0.8 * 0.05 / 0.5;
		const earlyEndGain = 1 - 0.8 * 0.2 / 0.5;
		const earlyGainRms = Math.sqrt((earlyStartGain ** 2
			+ earlyStartGain * earlyEndGain + earlyEndGain ** 2) / 3);
		expect(probe.lateRms / probe.earlyRms)
			.toBeCloseTo(RAMP_END_GAIN / earlyGainRms, 2);
		// Center-panning the mono tone into stereo applies equal-power sqrt(1/2)
		// channel gain; the tone itself contributes the other RMS sqrt(1/2).
		expect(probe.lateRms).toBeCloseTo(TONE_AMPLITUDE * RAMP_END_GAIN / 2, 3);
		expect(errors).toEqual([]);
	});
});

async function decodeRmsWindows(page, bytes) {
	return page.evaluate(async (values) => {
		const context = new AudioContext({ sampleRate: 48_000 });
		try {
			const audio = await context.decodeAudioData(Uint8Array.from(values).buffer);
			const rms = (startSeconds, endSeconds) => {
				const start = Math.round(startSeconds * audio.sampleRate);
				const end = Math.min(audio.length, Math.round(endSeconds * audio.sampleRate));
				let energy = 0;
				let samples = 0;
				for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
					const data = audio.getChannelData(channel);
					for (let frame = start; frame < end; frame += 1) {
						energy += data[frame] ** 2;
						samples += 1;
					}
				}
				return Math.sqrt(energy / samples);
			};
			return {
				channelCount: audio.numberOfChannels,
				duration: audio.duration,
				earlyRms: rms(0.05, 0.2),
				lateRms: rms(0.7, 0.9),
			};
		} finally {
			await context.close();
		}
	}, Array.from(bytes));
}
