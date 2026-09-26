/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';

import { chooseDropdown, closeDialog, openExportDialog } from '../audio-editor-test-helpers.js';

/** Inspect the committed WAV bytes from the linked-original desktop bridge. */
export async function exportLinkedAudioTone(page, editor) {
	const previousExports = await page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.exports.length);
	const dialog = await openExportDialog(page, editor, { label: 'Export video' });
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.exports.length), {
		timeout: 30_000,
	}).toBe(previousExports + 1);
	await closeDialog(dialog);
	return page.evaluate(async () => {
		const bytes = globalThis.__projectBinLinkedAudioFixture.exports.at(-1);
		const context = new AudioContext();
		try {
			const audio = await context.decodeAudioData(bytes.buffer.slice(0));
			const samples = audio.getChannelData(0);
			const start = Math.round(audio.sampleRate * 0.1);
			const end = Math.min(samples.length, Math.round(audio.sampleRate * 0.6));
			if (end - start < audio.sampleRate * 0.2) throw new Error('The linked export is too short to analyze.');
			return Object.fromEntries([330, 660].map((frequency) => {
				let cosine = 0;
				let sine = 0;
				for (let frame = start; frame < end; frame += 1) {
					const angle = 2 * Math.PI * frequency * frame / audio.sampleRate;
					cosine += samples[frame] * Math.cos(angle);
					sine += samples[frame] * Math.sin(angle);
				}
				return [frequency, 2 * Math.hypot(cosine, sine) / (end - start)];
			}));
		} finally {
			await context.close();
		}
	});
}

export function expectDominantLinkedTone(amplitudes, frequency) {
	expect(amplitudes[frequency], JSON.stringify(amplitudes)).toBeGreaterThan(0.1);
	expect(amplitudes[frequency]).toBeGreaterThan(amplitudes[frequency === 330 ? 660 : 330] * 8);
}
