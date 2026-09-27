/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

test.describe('Soundscaper sound-activated playhead', () => {
	registerAudioEditorHooks();

	test('stays at written waveform end while the input is silent', async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
				enumerateDevices: async () => [{
					kind: 'audioinput', deviceId: 'default', groupId: 'fixture', label: 'Fixture microphone',
				}],
				getUserMedia: async () => {
					const context = new AudioContext();
					const destination = context.createMediaStreamDestination();
					const oscillator = context.createOscillator();
					const gain = context.createGain();
					gain.gain.value = 0;
					oscillator.connect(gain).connect(destination);
					oscillator.start();
					await context.resume();
					globalThis.__soundActivationPlayheadInput = { context, gain };
					const [track] = destination.stream.getAudioTracks();
					const getSettings = track.getSettings.bind(track);
					Object.defineProperty(track, 'getSettings', { configurable: true,
						value: () => ({ ...getSettings(), channelCount: 1, sampleRate: context.sampleRate, latency: 0 }) });
					return destination.stream;
				},
			} });
		});
		const editor = await bootEditor(page, '/embed/en/');
		await editor.getByRole('button', { name: 'Record options', exact: true }).click();
		await page.getByRole('dialog', { name: 'Record options', exact: true })
			.getByRole('button', { name: 'Sound-activated recording', exact: true }).click();
		const timeline = editor.locator('.audio-editor-timeline-panel');
		const playheadX = () => timeline.evaluate((node) =>
			Number.parseFloat(node.style.getPropertyValue('--timeline-playhead-x')));
		await expect.poll(playheadX).toBeGreaterThan(0);
		const startTime = await page.evaluate(() => globalThis.__soundActivationPlayheadInput.context.currentTime);
		const initialX = await playheadX();
		await expect.poll(() => page.evaluate(() => globalThis.__soundActivationPlayheadInput.context.currentTime))
			.toBeGreaterThan(startTime + 0.6);
		expect(await playheadX()).toBe(initialX);

		await page.evaluate(() => { globalThis.__soundActivationPlayheadInput.gain.gain.value = 0.5; });
		await expect.poll(playheadX).toBeGreaterThan(initialX + 2);
		await page.evaluate(() => { globalThis.__soundActivationPlayheadInput.gain.gain.value = 0; });
		const silenceTime = await page.evaluate(() => globalThis.__soundActivationPlayheadInput.context.currentTime);
		await expect.poll(() => page.evaluate(() => globalThis.__soundActivationPlayheadInput.context.currentTime))
			.toBeGreaterThan(silenceTime + 0.7);
		const stoppedX = await playheadX();
		await expect.poll(() => page.evaluate(() => globalThis.__soundActivationPlayheadInput.context.currentTime))
			.toBeGreaterThan(silenceTime + 1.3);
		expect(await playheadX()).toBe(stoppedX);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	});
});
