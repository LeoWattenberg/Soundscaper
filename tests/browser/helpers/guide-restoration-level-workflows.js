/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';
import { exampleAudio } from '../../../handbook/guides/example-audio.mjs';
import { exportGuideSamples } from './guide-audio-results.js';
import { effectSourcePeak, sourcePeakChannels } from './stored-source-probes.js';

function clippedInputPlateauSamples() {
	const bytes = exampleAudio('clipped-take');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let count = 0;
	for (let offset = 44; offset < bytes.length; offset += 2) {
		if (Math.abs(view.getInt16(offset, true) / 32_767) >= 0.999) count += 1;
	}
	return count;
}

function rms(samples, sampleRate, startSeconds, endSeconds) {
	const start = Math.max(0, Math.floor(startSeconds * sampleRate));
	const end = Math.min(samples[0].length, Math.floor(endSeconds * sampleRate));
	let sum = 0;
	let count = 0;
	for (const channel of samples) {
		for (let frame = start; frame < end; frame += 1) {
			sum += channel[frame] ** 2;
			count += 1;
		}
	}
	return Math.sqrt(sum / count);
}

function peakAndFullScaleCount(channels) {
	let peak = 0;
	let fullScale = 0;
	for (const channel of channels) {
		for (const sample of channel) {
			peak = Math.max(peak, Math.abs(sample));
			if (Math.abs(sample) >= 0.999) fullScale += 1;
		}
	}
	return { peak, fullScale };
}

/** Check that each repair/level recipe leaves the expected edited material in the timeline. */
export async function verifyRestorationLevelWorkflowResults(page, id) {
	const editor = page.locator('[data-audio-editor]');
	const clips = editor.getByRole('group', { name: / clip, starts at [\d.]+ seconds?, [\d.]+ seconds? long$/u });
	if (id === 'remove-a-narrow-frequency-band') {
		await expect(clips).toHaveCount(3);
		await expect(clips.nth(0)).toHaveAttribute('aria-label', /starts at 0 seconds, 0\.5 seconds long$/u);
		await expect(clips.nth(1)).toHaveAttribute('aria-label', /starts at 0\.5 seconds, 1 second long$/u);
		await expect(clips.nth(2)).toHaveAttribute('aria-label', /starts at 1\.5 seconds, 0\.5 seconds long$/u);
		const audio = await exportGuideSamples(page);
		const untouched = rms(audio.channels, audio.sampleRate, 0.1, 0.35);
		const deleted = rms(audio.channels, audio.sampleRate, 0.75, 1.25);
		expect(untouched).toBeGreaterThan(0.22);
		expect(untouched).toBeLessThan(0.28);
		expect(deleted).toBeLessThan(untouched * 0.25);
		return;
	}
	if (id === 'boost-a-selected-frequency-band') {
		await expect(clips).toHaveCount(3);
		await expect(clips.nth(0)).toHaveAttribute('aria-label', /starts at 0 seconds, 0\.5 seconds long$/u);
		await expect(clips.nth(1)).toHaveAttribute('aria-label', /starts at 0\.5 seconds, 1 second long$/u);
		await expect(clips.nth(2)).toHaveAttribute('aria-label', /starts at 1\.5 seconds, 0\.5 seconds long$/u);
		const audio = await exportGuideSamples(page);
		const untouched = rms(audio.channels, audio.sampleRate, 0.1, 0.35);
		const boosted = rms(audio.channels, audio.sampleRate, 0.75, 1.25);
		expect(untouched).toBeGreaterThan(0.22);
		expect(untouched).toBeLessThan(0.28);
		expect(boosted).toBeGreaterThan(untouched * 1.45);
		return;
	}
	if (id === 'restore-clipped-peaks') {
		await expect(clips).toHaveCount(1);
		const audio = await exportGuideSamples(page);
		const { peak, fullScale } = peakAndFullScaleCount(audio.channels);
		expect(peak).toBeGreaterThan(0.24);
		expect(peak).toBeLessThan(0.999);
		expect(fullScale).toBe(0);
		const restoredPlateaus = audio.channels.reduce((total, channel) => total + channel.filter((sample) => Math.abs(sample) >= peak * 0.9999).length, 0);
		// The mono fixture is exported as two centered channels; compare counts
		// per channel so a stereo render cannot double the apparent plateau count.
		expect(restoredPlateaus / audio.channels.length).toBeLessThan(clippedInputPlateauSamples());
		return;
	}
	if (id === 'compress-long-pauses') {
		await expect(clips).toHaveCount(1);
		await expect(clips).toHaveAttribute('aria-label', /starts at 0 seconds, (?:[0-3](?:\.\d+)?) seconds long$/u);
		return;
	}
	if (id === 'normalize-to-an-rms-target') {
		await expect(clips).toHaveCount(1);
		const audio = await exportGuideSamples(page);
		const levelDb = 20 * Math.log10(rms(audio.channels, audio.sampleRate, 0, audio.duration));
		expect(levelDb).toBeGreaterThan(-20.2);
		expect(levelDb).toBeLessThan(-19.8);
		return;
	}
	if (id === 'invert-polarity-for-cancellation') {
		const rows = editor.locator('[data-track-row]').filter({ has: page.locator('.clip-display') });
		await expect(rows).toHaveCount(2);
		await expect(clips).toHaveCount(2);
		const [original, inverted, audio] = await Promise.all([
			sourcePeakChannels(page, 'guide-music-loop.wav'),
			effectSourcePeak(page, 'Invert'),
			exportGuideSamples(page),
		]);
		expect(original.channels[0].maximum).toBeGreaterThan(0.1);
		expect(inverted).toBeGreaterThan(0.1);
		expect(peakAndFullScaleCount(audio.channels).peak).toBeLessThan(1e-5);
	}
}
