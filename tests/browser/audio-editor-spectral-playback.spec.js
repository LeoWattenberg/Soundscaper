/* SPDX-License-Identifier: AGPL-3.0-only */

import { writeFile } from 'node:fs/promises';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';

const spectralCommand = 'Play selected frequencies';
const scenarios = [
	{ name: 'broad band', minimumFrequency: 300, maximumFrequency: 900, outOfBandFrequency: 4_096 },
	{ name: 'narrow band', minimumFrequency: 500, maximumFrequency: 524, outOfBandFrequency: 620 },
];

test.use({ browserCoverage: false });

for (const scenario of scenarios) {
	const mixedTone = createMixedToneFixture(scenario.outOfBandFrequency);
	test(`menu auditions a ${scenario.name} and Stop restores full-band listening without edits`, async ({ page }) => {
		await verifySpectralPlayback(page, mixedTone, scenario);
	});
}

async function verifySpectralPlayback(page, mixedTone, scenario) {
	await installOutputSpectrumProbe(page, scenario.outOfBandFrequency);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [mixedTone]);
	const play = editor.locator('[data-transport="play"]');
	const stop = editor.getByRole('button', { name: 'Stop', exact: true });
	await play.getByRole('button', { name: 'Play options', exact: true }).click();
	const options = page.getByRole('menu', { name: 'Play options', exact: true });
	await expect(options.getByRole('menuitem', { name: spectralCommand, exact: true })).toHaveAttribute('aria-disabled', 'true');
	await page.keyboard.press('Escape');
	await play.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(async () => (await spectrum(page)).outOfBand).toBeGreaterThan(-40);
	const normal = await spectrum(page);
	expect(normal.inBand).toBeGreaterThan(-40);
	await stop.click();

	const clipId = await clipByName(editor, mixedTone.name).getAttribute('data-clip-id');
	const clip = editor.locator(`[role="group"][data-clip-id="${clipId}"]`);
	const track = clip.locator('xpath=ancestor::div[@data-track-row]');
	await track.getByRole('button', { name: 'Track menu', exact: true }).click();
	const display = page.locator('.audio-editor-track-menu').getByRole('menuitem', { name: /^Track visualization(?:\s|$)/u });
	await display.focus();
	await page.keyboard.press('ArrowRight');
	await display.getByRole('menu').getByRole('menuitem', { name: 'Spectrogram', exact: true }).click();
	await clip.locator('.clip-header__name').dblclick();
	const clipName = clip.getByRole('textbox', { name: 'Clip name', exact: true });
	await clipName.fill('Listening history check');
	await clipName.press('Enter');
	await expect(clip).toContainText('Listening history check');
	await clip.focus();
	await page.keyboard.press('Control+a');
	await editor.getByRole('button', { name: 'Spectrogram options', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Select spectral frequency range', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Spectral selection', exact: true });
	await dialog.getByRole('textbox', { name: /^Minimum frequency \(Hz\)/u }).fill(String(scenario.minimumFrequency));
	await dialog.getByRole('textbox', { name: /^Maximum frequency \(Hz\)/u }).fill(String(scenario.maximumFrequency));
	await dialog.getByRole('button', { name: 'Select range', exact: true }).click();
	const selection = track.locator('[data-spectral-selection]');
	await expect(selection).toBeVisible();
	const selectionStyle = await selection.getAttribute('style');
	const undo = editor.getByRole('button', { name: 'Undo', exact: true });
	const undoDisabled = await undo.isDisabled();

	await play.getByRole('button', { name: 'Play options', exact: true }).click();
	await expect(options.getByRole('menuitem', { name: spectralCommand, exact: true })).toHaveAttribute('aria-disabled', 'false');
	await options.getByRole('menuitem', { name: spectralCommand, exact: true }).click();
	await expect(play.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await expect.poll(async () => (await spectrum(page)).inBand).toBeGreaterThan(normal.inBand - 4);
	await expect.poll(async () => (await spectrum(page)).outOfBand).toBeLessThan(normal.outOfBand - 20);
	const filtered = await spectrum(page);
	expect(filtered.inBand - filtered.outOfBand).toBeGreaterThan(20);
	await stop.click();
	await expect(selection).toHaveAttribute('style', selectionStyle);
	expect(await undo.isDisabled()).toBe(undoDisabled);
	await expect(editor).toHaveAttribute('data-clip-count', '1');

	await play.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(async () => (await spectrum(page)).outOfBand).toBeGreaterThan(normal.outOfBand - 3);
	await expect.poll(async () => (await spectrum(page)).inBand).toBeGreaterThan(normal.inBand - 3);
	const restored = await spectrum(page);
	const spectrumPath = test.info().outputPath('playback-spectrum.json');
	await writeFile(spectrumPath, JSON.stringify({ scenario, normal, filtered, restored }));
	await test.info().attach('playback-spectrum', {
		path: spectrumPath, contentType: 'application/json',
	});
	await stop.click();
	await expect(selection).toHaveAttribute('style', selectionStyle);
	expect(await undo.isDisabled()).toBe(undoDisabled);
	// The next Undo still reverses the clip rename made before listening.
	await undo.click();
	await expect(clip).toContainText(mixedTone.name);
	expect(errors).toEqual([]);
}

async function installOutputSpectrumProbe(page, outOfBandFrequency) {
	await page.addInitScript((frequencyOutsideBand) => {
		const connect = AudioNode.prototype.connect;
		AudioNode.prototype.connect = function (destination, ...ports) {
			if (destination === this.context.destination && this.context instanceof AudioContext) {
				const analyser = this.context.createAnalyser();
				analyser.fftSize = 16_384;
				analyser.smoothingTimeConstant = 0;
				connect.call(this, analyser, ...ports);
				connect.call(analyser, destination);
				window.spectralPlaybackSpectrum = () => {
					const bins = new Float32Array(analyser.frequencyBinCount);
					analyser.getFloatFrequencyData(bins);
					const peak = (frequency) => {
						const index = Math.round(frequency * analyser.fftSize / this.context.sampleRate);
						return Math.max(...bins.slice(Math.max(0, index - 2), index + 3));
					};
					return { inBand: peak(512), outOfBand: peak(frequencyOutsideBand) };
				};
				return destination;
			}
			return connect.call(this, destination, ...ports);
		};
	}, outOfBandFrequency);
}

async function spectrum(page) {
	return page.evaluate(() => window.spectralPlaybackSpectrum?.() ?? { inBand: -Infinity, outOfBand: -Infinity });
}

function createMixedToneFixture(outOfBandFrequency) {
	const sampleRate = 48_000;
	const fixture = createWavFixture({ name: `spectral-playback-mixture-${outOfBandFrequency}.wav`, frequency: 512, duration: 10, sampleRate, channelCount: 1 });
	for (let frame = 0; frame < (fixture.buffer.length - 44) / 2; frame += 1) {
		const sample = 0.175 * (Math.sin(2 * Math.PI * 512 * frame / sampleRate)
			+ Math.sin(2 * Math.PI * outOfBandFrequency * frame / sampleRate));
		fixture.buffer.writeInt16LE(Math.round(sample * 32_767), 44 + frame * 2);
	}
	return fixture;
}
