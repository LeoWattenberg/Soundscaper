/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
// Unmodified FFmpeg 6.1.1 output: lavfi green 64x48/25fps/1s and
// sine 1000Hz/48kHz, libx264/yuv420p + AAC/128k + faststart.
// The delayed fixture uses -itsoffset 0.5 before the 0.5s audio input.
// https://ffmpeg.org/ffmpeg.html documents this input timestamp offset.
function rms(samples, start, end) {
	const first = Math.round(start * 48_000), last = Math.round(end * 48_000);
	let sum = 0;
	for (let i = first; i < last; i++) sum += samples[i] ** 2;
	return Math.sqrt(sum / (last - first));
}
test('ordinary video import keeps its recorded delayed audio aligned with the picture', async ({ page }, testInfo) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const bytes = Buffer.from(await readFile(new URL('./fixtures/ffmpeg-delayed-camera-audio.mp4.base64', import.meta.url), 'utf8'), 'base64');
	await importFiles(editor, [{ name: 'delayed-camera-audio.mp4', mimeType: 'video/mp4', buffer: bytes }]);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const samples = await exportSamples(page, editor);
	await testInfo.attach('imported-audio-timing.json', { body: JSON.stringify({ frames: samples.length, early: rms(samples, 0.1, 0.15), late: rms(samples, 0.6, 0.65) }), contentType: 'application/json' });
	expect(samples.length).toBe(48_000);
	expect(rms(samples, 0.1, 0.15)).toBeLessThan(0.001);
	expect(rms(samples, 0.6, 0.65)).toBeGreaterThan(0.05);
});

test('ordinary aligned camera audio keeps its first and last tone without duplicating encoder priming', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const bytes = Buffer.from(await readFile(new URL('./fixtures/ffmpeg-aligned-camera-audio.mp4.base64', import.meta.url), 'utf8'), 'base64');
	await importFiles(editor, [{ name: 'aligned-camera-audio.mp4', mimeType: 'video/mp4', buffer: bytes }]);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const samples = await exportSamples(page, editor);
	expect(samples.length).toBe(48_000);
	expect(rms(samples, 0.1, 0.15)).toBeGreaterThan(0.05);
	expect(rms(samples, 0.9, 0.95)).toBeGreaterThan(0.05);
});
