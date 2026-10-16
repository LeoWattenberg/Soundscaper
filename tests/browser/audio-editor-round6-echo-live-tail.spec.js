/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, commitInput, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test('changing ordinary Echo decay retains the already audible repeating recording', async ({ page }) => {
	await page.addInitScript(() => {
		window.__round6EchoOutput = [];
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
					window.__round6EchoOutput.push({ time: this.context.currentTime, peak });
				}, 20);
			}
			return result;
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'Echo recording with quiet tail.wav', frequency: 330, duration: 12,
		channelCount: 1, channelAmplitudes: [.6] });
	recording.buffer.fill(0, 44 + Math.round(.3 * 48_000) * 2);
	await importFiles(editor, [recording]);
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Echo');
	const dialog = page.getByRole('dialog', { name: 'Echo', exact: true });
	await commitInput(dialog.locator('[data-effect-param="delaySeconds"] input'), '1');
	await commitInput(dialog.locator('[data-effect-param="decay"] input'), '.8');
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => {
		const first = window.__round6EchoOutput.find(({ peak }) => peak > .2)?.time ?? Infinity;
		return window.__round6EchoOutput.some(({ time, peak }) => time > first + 1 && peak > .1);
	})).toBe(true);
	const changedAt = await page.evaluate(() => Math.max(...window.__round6EchoOutput.map(({ time }) => time)));
	await commitInput(dialog.locator('[data-effect-param="decay"] input'), '.7');
	await expect.poll(() => page.evaluate(time => Math.max(0, ...window.__round6EchoOutput
		.filter(sample => sample.time > time + .5).map(({ peak }) => peak)), changedAt)).toBeGreaterThan(.04);
	console.log('ordinary live Echo change output', await page.evaluate(time => ({
		beforePeak: Math.max(...window.__round6EchoOutput.filter(sample => sample.time <= time).map(({ peak }) => peak)),
		afterPeak: Math.max(...window.__round6EchoOutput.filter(sample => sample.time > time + .5).map(({ peak }) => peak)),
	}), changedAt));
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
