/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

async function playingMixer(page, amplitudes) {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'channel-meter.wav', frequency: 440,
		duration: 6, channelCount: 2, channelAmplitudes: amplitudes })]);
	await chooseCommandAction(page, editor, 'Window', 'Mixer');
	const strip = editor.locator('.kw-audio-editor__mixer-channel--track').filter({ hasText: 'channel-meter' });
	await expect(strip).toHaveCount(1);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	return strip;
}

test('mixer stereo bars show independent left and right levels', async ({ page }) => {
	const strip = await playingMixer(page, [0.8, 0]);
	const fills = strip.locator('.mixer-channel__meter-fill');
	await expect.poll(async () => Number.parseFloat(await fills.first().evaluate((element) => element.style.top))).toBeLessThan(20);
	await expect.poll(async () => Number.parseFloat(await fills.nth(1).evaluate((element) => element.style.top))).toBe(100);
	const trackMeters = page.getByRole('group', { name: 'channel-meter track controls', exact: true }).locator('.track-meter');
	await expect(trackMeters).toHaveCount(2);
	await expect.poll(async () => Number.parseFloat(await trackMeters.first().evaluate((element) => element.style.getPropertyValue('--tm-volume-position')))).toBeLessThan(20);
	await expect.poll(async () => Number.parseFloat(await trackMeters.nth(1).evaluate((element) => element.style.getPropertyValue('--tm-volume-position')))).toBe(100);
});

test('mixer clipping indicators stay clear for a loud signal below full scale', async ({ page }) => {
	const strip = await playingMixer(page, [0.9, 0.9]);
	await expect.poll(async () => Number.parseFloat(await strip.locator('.mixer-channel__meter-fill').first().evaluate((element) => element.style.top))).toBeLessThan(5);
	await expect(strip.locator('.mixer-channel__meter-clip--active')).toHaveCount(0);
});
