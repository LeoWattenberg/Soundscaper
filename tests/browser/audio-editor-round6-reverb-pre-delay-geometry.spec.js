/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, commitInput, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test('a sub-sample Reverb pre-delay edit retains its already audible tail', async ({ page }) => {
	await page.addInitScript(() => {
		window.__round6ReverbOutput = [];
		const connect = AudioNode.prototype.connect;
		AudioNode.prototype.connect = function (destination, ...ports) {
			const result = Reflect.apply(connect, this, [destination, ...ports]);
			if (destination === this.context.destination && this.context instanceof AudioContext) {
				const analyser = this.context.createAnalyser(); analyser.fftSize = 2048;
				Reflect.apply(connect, this, [analyser, ...ports]);
				const samples = new Float32Array(analyser.fftSize);
				const interval = setInterval(() => {
					if (this.context.state === 'closed') { clearInterval(interval); return; }
					analyser.getFloatTimeDomainData(samples);
					let peak = 0; for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
					window.__round6ReverbOutput.push({ time: this.context.currentTime, peak, sampleRate: this.context.sampleRate });
				}, 20);
			}
			return result;
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'Reverb recording with quiet tail.wav', frequency: 1000, duration: 12, sampleRate: 44_100,
		channelCount: 1, channelAmplitudes: [.6] });
	recording.buffer.fill(0, 44 + Math.round(.3 * 44_100) * 2);
	await importFiles(editor, [recording]);
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Reverb (Audacity)');
	const dialog = page.getByRole('dialog', { name: 'Reverb (Audacity)', exact: true });
	for (const [name, value] of [['preDelay', '10'], ['reverberance', '100'], ['roomSize', '100'], ['wetGainDb', '6']]) {
		await commitInput(dialog.locator(`[data-effect-param="${name}"] input[type="number"]`), value);
	}
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => {
		const first = window.__round6ReverbOutput.find(({ peak }) => peak > .2)?.time ?? Infinity;
		return window.__round6ReverbOutput.some(({ time, peak }) => time > first + .8 && peak > .04);
	})).toBe(true);
	const changedAt = await page.evaluate(() => Math.max(...window.__round6ReverbOutput.map(({ time }) => time)));
	const preDelay = dialog.locator('[data-effect-param="preDelay"] input[type="number"]');
	await commitInput(preDelay, '10.01');
	await expect(preDelay).toHaveValue('10.01');
	const sampleRate = await page.evaluate(() => window.__round6ReverbOutput.at(-1).sampleRate);
	expect(Math.round(10 * sampleRate / 1000)).toBe(Math.round(10.01 * sampleRate / 1000));
	console.log('ordinary Reverb realized pre-delay geometry', { sampleRate,
		beforeFrames: Math.round(10 * sampleRate / 1000), afterFrames: Math.round(10.01 * sampleRate / 1000) });
	await expect.poll(() => page.evaluate(time => Math.max(0, ...window.__round6ReverbOutput
		.filter(sample => sample.time > time + .5).map(({ peak }) => peak)), changedAt)).toBeGreaterThan(.04);
	console.log('ordinary same-frame Reverb pre-delay output', await page.evaluate(time => ({
		beforePeak: Math.max(...window.__round6ReverbOutput.filter(sample => sample.time <= time).map(({ peak }) => peak)),
		afterPeak: Math.max(...window.__round6ReverbOutput.filter(sample => sample.time > time + .5).map(({ peak }) => peak)),
	}), changedAt));
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
