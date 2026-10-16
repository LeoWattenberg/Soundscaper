/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clickClipInterior,
	clipByName, closeClipProperties, disableNativeSavePicker, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('Nyquist Crossfade Tracks keeps one fade direction across split clips on one track', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recordings = [440, 880].map((frequency, index) => createWavFixture({
		name: `crossfade-microphone-${index}.wav`, frequency, duration: 2,
		channelCount: 1, channelAmplitudes: [.2],
	}));
	await importFiles(editor, recordings);
	const split = editor.getByRole('button', { name: 'Split tool', exact: true });
	await split.click();
	await clickClipInterior(page, clipByName(editor, recordings[0].name), .5);
	await split.click();
	const first = clipByName(editor, recordings[0].name);
	await expect(first).toHaveCount(2);
	const properties = await openClipProperties(page, editor, clipByName(editor, recordings[1].name));
	await properties.getByText('Media settings', { exact: true }).click();
	const start = properties.locator('[data-clip-field="startFrame"]');
	await start.locator('.timecode-digit').first().click();
	await page.keyboard.type('000001200');
	await page.keyboard.press('Enter');
	await expect(start.locator('.timecode__display')).toHaveText('00h00m01.200s');
	await closeClipProperties(properties);
	await first.nth(0).locator('.clip-header').click();
	await first.nth(1).locator('.clip-header').click({ modifiers: ['Shift'] });
	await clipByName(editor, recordings[1].name).locator('.clip-header').click({ modifiers: ['Shift'] });
	await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(3);
	await chooseNestedCommandAction(page, editor, 'Effect', ['Nyquist', 'Crossfade Tracks']);
	const dialog = page.getByRole('dialog', { name: 'Crossfade Tracks', exact: true });
	await dialog.getByRole('combobox', { name: 'Fade direction', exact: true })
		.selectOption({ label: 'Alternating Out / In' });
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 20_000 });
	const samples = await exportSamples(page, editor);
	expect(amplitude(samples, 880, 1.25, 1.35) / amplitude(samples, 880, 2.9, 3)).toBeLessThan(.2);
	expect(amplitude(samples, 440, 1.05, 1.15) / amplitude(samples, 440, 1.7, 1.8)).toBeGreaterThan(2);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const restored = await exportSamples(page, editor);
	expect(amplitude(restored, 880, 1.25, 1.35) / amplitude(restored, 880, 2.9, 3)).toBeCloseTo(1, 2);
});

function amplitude(samples, frequency, start, end) {
	let sine = 0;
	let cosine = 0;
	const first = Math.round(start * 48_000);
	const last = Math.round(end * 48_000);
	for (let frame = first; frame < last; frame++) {
		const phase = 2 * Math.PI * frequency * frame / 48_000;
		sine += samples[frame] * Math.sin(phase);
		cosine += samples[frame] * Math.cos(phase);
	}
	return 2 * Math.hypot(sine, cosine) / (last - first);
}

test('a normal Nyquist track-index program applies one gain to both clips on its owning track', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'track-index-recording.wav', frequency: 440,
		duration: 2, channelCount: 1, channelAmplitudes: [.2] });
	await importFiles(editor, [recording]);
	const split = editor.getByRole('button', { name: 'Split tool', exact: true });
	await split.click();
	await clickClipInterior(page, clipByName(editor, recording.name), .5);
	await split.click();
	const clips = clipByName(editor, recording.name);
	await expect(clips).toHaveCount(2);
	await clips.nth(0).locator('.clip-header').click();
	await clips.nth(1).locator('.clip-header').click({ modifiers: ['Shift'] });
	await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(2);
	await chooseCommandAction(page, editor, 'Tools', 'Nyquist prompt');
	const prompt = page.getByRole('dialog', { name: 'Nyquist prompt', exact: true });
	await prompt.getByRole('textbox', { name: 'Nyquist source', exact: true })
		.fill("(mult *track* (get '*track* 'index))");
	await prompt.getByRole('button', { name: 'Run', exact: true }).click();
	await expect(prompt.locator('.kw-audio-editor__nyquist-output')).toContainText('48000 frames', { timeout: 20_000 });
	await prompt.getByRole('button', { name: 'Cancel', exact: true }).click();
	const samples = await exportSamples(page, editor);
	expect(amplitude(samples, 440, 1.2, 1.8) / amplitude(samples, 440, .2, .8)).toBeCloseTo(1, 2);
});
