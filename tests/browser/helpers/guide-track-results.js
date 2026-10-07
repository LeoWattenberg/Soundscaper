/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';
import { sourcePeakChannels } from './stored-source-probes.js';

/** Verify channel structure and whole-track outcomes beyond the recipe's counts. */
export async function verifyGuideTrackResults(page, id) {
	const editor = page.locator('[data-audio-editor]');
	const clipRole = { name: / clip, starts at [\d.]+ seconds?, [\d.]+ seconds? long$/u };
	const clips = editor.getByRole('group', clipRole);
	if (id === 'split-stereo-to-centered-mono') {
		for (const side of ['Left', 'Right']) {
			const controls = editor.getByRole('group', { name: `guide-music-loop — ${side} track controls`, exact: true });
			await expect(controls.getByRole('group', { name: 'Pan', exact: true }).getByRole('slider'))
				.toHaveAttribute('aria-valuenow', '0');
			await expect.poll(async () => (await sourcePeakChannels(page, `guide-music-loop.wav — ${side}`)).channelCount)
				.toBe(1);
		}
		for (const clip of await clips.all()) await expect(clip).toHaveAttribute('aria-label', /starts at 0 seconds, 2 seconds long$/u);
	}
	if (id === 'combine-mono-tracks-into-stereo') {
		await expect.poll(async () => (await sourcePeakChannels(page, 'guide-quiet-take — Stereo')).channelCount).toBe(2);
		const peaks = await sourcePeakChannels(page, 'guide-quiet-take — Stereo');
		// The quiet left recording and the clicky right recording have distinct
		// peaks, so reversed channels cannot pass a channel-count assertion alone.
		expect(peaks.channels[0].maximum).toBeCloseTo(0.05, 3);
		expect(peaks.channels[1].maximum).toBeCloseTo(0.9, 3);
		await expect(clips).toHaveAttribute('aria-label', /starts at 0 seconds, 2 seconds long$/u);
	}
	if (id === 'duplicate-a-whole-track') {
		const rows = editor.locator('[data-track-row]').filter({ has: page.locator('.clip-display') });
		await expect(rows).toHaveCount(2);
		for (const row of await rows.all()) {
			const pieces = row.getByRole('group', clipRole);
			await expect(pieces).toHaveCount(2);
			await expect(pieces.nth(0)).toHaveAttribute('aria-label', /starts at 0 seconds, 1 second long$/u);
			await expect(pieces.nth(1)).toHaveAttribute('aria-label', /starts at 1 second, 1 second long$/u);
		}
	}
	if (id === 'remove-a-track') {
		await expect(clips).toHaveAttribute('aria-label', /^guide-music-loop(?:\.wav)? clip, starts at 0 seconds, 2 seconds long$/u);
		await expect(editor.locator('.track-control-panel__track-name-text').filter({ hasText: 'guide-second-loop' })).toHaveCount(0);
	}
}
