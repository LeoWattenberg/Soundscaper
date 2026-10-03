/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, clipByName, collectClientErrors, importFiles, registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

const quietTone = createWavFixture({
	name: 'quiet-waveform-scale.wav', frequency: 440, channelCount: 1, channelAmplitudes: [0.02],
});
const otherTone = createWavFixture({
	name: 'other-waveform-scale.wav', frequency: 330, channelCount: 1, channelAmplitudes: [0.02],
});

async function openWaveformRulerMenu(page, track) {
	await track.locator('[data-track-ruler]').click({ button: 'right', position: { x: 20, y: 70 } });
	const menu = page.locator('.audio-editor-ruler-flyout');
	await expect(menu).toBeVisible();
	return menu;
}

async function chooseWaveformScale(page, track, label, format, amplitudeScale) {
	const menu = await openWaveformRulerMenu(page, track);
	const radio = menu.getByRole('radiogroup', { name: 'Ruler format', exact: true })
		.getByRole('radio', { name: label, exact: true });
	await radio.click();
	await expect(radio).toBeChecked();
	await expect(track.locator('[data-track-ruler]')).toHaveAttribute('data-ruler-format', format);
	await expect(track.locator('canvas.clip-body__waveform'))
		.toHaveAttribute('data-waveform-amplitude-scale', amplitudeScale);
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
}

// Measure the visible dark trace, excluding translucent zero lines and the
// colored selection fill. This checks the actual waveform raster, rather than
// a ruler label or a renderer option masquerading as a scale change.
async function waveformTrace(canvas) {
	return canvas.evaluate((element) => {
		const { width, height, data } = element.getContext('2d')
			.getImageData(0, 0, element.width, element.height);
		let top = height;
		let bottom = -1;
		let pixels = 0;
		let hash = 0;
		for (let y = 0; y < height; y++) {
			for (let x = Math.ceil(width * 0.1); x < width * 0.9; x++) {
				const offset = (y * width + x) * 4;
				const painted = data[offset + 3] >= 200
					&& Math.max(data[offset], data[offset + 1], data[offset + 2]) < 100;
				hash = (Math.imul(hash, 31) + Number(painted)) >>> 0;
				if (!painted) continue;
				top = Math.min(top, y);
				bottom = Math.max(bottom, y);
				pixels++;
			}
		}
		return { width, height, top, bottom, span: Math.max(0, bottom - top + 1), pixels, hash };
	});
}

registerAudioEditorHooks();

test('opts into a logarithmic dB waveform per track and restores both linear scales', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [quietTone, otherTone]);
	const clip = clipByName(editor, quietTone.name);
	const track = clip.locator('xpath=ancestor::div[@data-track-row]');
	const canvas = clip.locator('canvas.clip-body__waveform');
	const otherTrack = clipByName(editor, otherTone.name).locator('xpath=ancestor::div[@data-track-row]');
	const otherCanvas = otherTrack.locator('canvas.clip-body__waveform');
	await expect(track.locator('[data-track-ruler]')).toHaveAttribute('data-ruler-format', 'linear-db');
	await expect(canvas).toHaveAttribute('data-waveform-amplitude-scale', 'linear');
	await expect(canvas).toHaveAttribute('data-waveform-mode', 'summary');
	await expect.poll(async () => (await waveformTrace(canvas)).span).toBeGreaterThan(0);
	const linear = await waveformTrace(canvas);
	const otherLinear = await waveformTrace(otherCanvas);

	const menu = await openWaveformRulerMenu(page, track);
	const formats = menu.getByRole('radiogroup', { name: 'Ruler format', exact: true });
	await expect(formats.getByRole('radio')).toHaveCount(3);
	await expect(formats.getByRole('radio', { name: 'Linear (dB)', exact: true })).toBeChecked();
	await expect(formats.getByRole('radio', { name: 'Linear (amp)', exact: true })).not.toBeChecked();
	await expect(formats.getByRole('radio', { name: 'dB (logarithmic)', exact: true })).not.toBeChecked();
	await page.keyboard.press('Escape');
	await chooseWaveformScale(page, track, 'dB (logarithmic)', 'logarithmic-db', 'db');
	await expect.poll(async () => (await waveformTrace(canvas)).span).toBeGreaterThan(linear.span * 6);
	await expect(otherTrack.locator('[data-track-ruler]')).toHaveAttribute('data-ruler-format', 'linear-db');
	await expect(otherCanvas).toHaveAttribute('data-waveform-amplitude-scale', 'linear');
	expect(await waveformTrace(otherCanvas)).toEqual(otherLinear);

	for (const [label, format] of [['Linear (amp)', 'linear-amp'], ['Linear (dB)', 'linear-db']]) {
		await chooseWaveformScale(page, track, label, format, 'linear');
		await expect.poll(() => waveformTrace(canvas)).toEqual(linear);
		await chooseWaveformScale(page, track, 'dB (logarithmic)', 'logarithmic-db', 'db');
	}
	const halfWaveMenu = await openWaveformRulerMenu(page, track);
	await halfWaveMenu.getByText('Half wave', { exact: true }).click();
	await expect(clip.locator('.clip-body')).toHaveAttribute('data-half-wave', 'true');
	await page.keyboard.press('Escape');
	await expect.poll(async () => (await waveformTrace(canvas)).bottom)
		.toBeGreaterThan(linear.height * 0.9);
	const halfWave = await waveformTrace(canvas);
	expect(halfWave.span).toBeGreaterThan(linear.span * 6);
	expect(halfWave.top).toBeLessThan(linear.height * 0.75);
	await chooseWaveformScale(page, track, 'Linear (dB)', 'linear-db', 'linear');
	await expect.poll(async () => (await waveformTrace(canvas)).span).toBeLessThan(halfWave.span / 6);
	expect(errors).toEqual([]);
});

test('keeps logarithmic dB scaling when zooming from summary to connected samples and stems', async ({ page }) => {
	test.setTimeout(60_000);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [quietTone]);
	const clip = clipByName(editor, quietTone.name);
	const track = clip.locator('xpath=ancestor::div[@data-track-row]');
	const canvas = clip.locator('canvas.clip-body__waveform');
	const zoomIn = editor.getByRole('button', { name: 'Zoom in', exact: true });
	await chooseWaveformScale(page, track, 'dB (logarithmic)', 'logarithmic-db', 'db');
	for (let step = 0; step < 9; step++) await zoomIn.click();
	for (const mode of ['connecting-dots', 'stem']) {
		await expect(canvas).toHaveAttribute('data-waveform-mode', mode);
		await expect(canvas).toHaveAttribute('data-waveform-source', 'pcm');
		await expect(canvas).toHaveAttribute('data-waveform-amplitude-scale', 'db');
		const logarithmic = await waveformTrace(canvas);
		await chooseWaveformScale(page, track, 'Linear (dB)', 'linear-db', 'linear');
		const linear = await waveformTrace(canvas);
		expect(linear.span).toBeGreaterThan(0);
		expect(logarithmic.span).toBeGreaterThan(linear.span * 4);
		await chooseWaveformScale(page, track, 'dB (logarithmic)', 'logarithmic-db', 'db');
		await expect.poll(() => waveformTrace(canvas)).toEqual(logarithmic);
		if (mode === 'connecting-dots') {
			await zoomIn.click();
			await zoomIn.click();
		}
	}
	expect(errors).toEqual([]);
});
