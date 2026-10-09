/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, disableNativeSavePicker,
	importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const toggle of [false, true]) test(`a selected recording spectral band leaves its overlapping neighbor unchanged${toggle ? ' after toggling' : ''}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'selected-spectral.wav', frequency: 440,
		duration: 2, channelCount: 1, channelAmplitudes: [.2] });
	const neighbor = createWavFixture({ name: 'untouched-spectral.wav', frequency: 880,
		duration: 2, channelCount: 1, channelAmplitudes: [.2] });
	await importFiles(editor, [recording, neighbor]);
	const clip = clipByName(editor, recording.name);
	const incoming = clipByName(editor, neighbor.name);
	const track = clip.locator('xpath=ancestor::*[@data-track-row][1]');
	const trackName = (await track.locator('.track-control-panel__track-name-text').textContent()).trim();
	await incoming.click({ button: 'right', position: { x: 32, y: 10 } });
	const move = page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: /^Move to track \(preserve time\)/u });
	await move.hover();
	await move.getByRole('menuitem', { name: trackName, exact: true }).click();
	const before = await exportSamples(page, editor);
	await track.getByRole('button', { name: 'Track menu', exact: true }).click();
	const display = page.locator('.audio-editor-track-menu').getByRole('menuitem', { name: /^Track visualization(?:\s|$)/u });
	await display.focus(); await page.keyboard.press('ArrowRight');
	await display.getByRole('menu').getByRole('menuitem', { name: 'Spectrogram', exact: true }).click();
	await clip.focus(); await clip.press('Enter');
	const spectral = await openSpectralDialog(page, editor);
	await spectral.getByRole('textbox', { name: /^Minimum frequency \(Hz\)/u }).fill('100');
	await spectral.getByRole('textbox', { name: /^Maximum frequency \(Hz\)/u }).fill('1000');
	await spectral.getByRole('button', { name: 'Select range', exact: true }).click();
	if (toggle) {
		await chooseNestedCommandAction(page, editor, 'Select', ['Spectral', 'Spectral selection']);
		await chooseNestedCommandAction(page, editor, 'Select', ['Spectral', 'Spectral selection']);
	}
	const amplify = await openSpectralDialog(page, editor);
	await expect(amplify.getByRole('textbox', { name: /^Minimum frequency \(Hz\)/u })).toHaveValue('100');
	await expect(amplify.getByRole('textbox', { name: /^Maximum frequency \(Hz\)/u })).toHaveValue('1000');
	await amplify.getByRole('button', { name: 'Spectral Amplify', exact: true }).click();
	await expect(amplify).toBeHidden({ timeout: 30_000 });
	const after = await exportSamples(page, editor);
	expect(toneAmplitude(after, 440) / toneAmplitude(before, 440)).toBeGreaterThan(1.8);
	expect(toneAmplitude(after, 880) / toneAmplitude(before, 880)).toBeCloseTo(1, 1);
});

async function openSpectralDialog(page, editor) {
	await editor.getByRole('button', { name: 'Spectrogram options', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Select spectral frequency range', exact: true }).click();
	return page.getByRole('dialog', { name: 'Spectral selection', exact: true });
}

function toneAmplitude(samples, frequency) {
	const middle = samples.slice(24_000, 72_000);
	let sine = 0;
	let cosine = 0;
	for (const [frame, sample] of middle.entries()) {
		const angle = 2 * Math.PI * frequency * frame / 48_000;
		sine += sample * Math.sin(angle);
		cosine += sample * Math.cos(angle);
	}
	return 2 * Math.hypot(sine, cosine) / middle.length;
}
