/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, commitInput, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test('a live Click Removal threshold edit preserves the already audible clean recording', async ({ page }) => {
	await page.addInitScript(() => {
		window.__round6ClickOutput = [];
		const connect = AudioNode.prototype.connect;
		AudioNode.prototype.connect = function (destination, ...ports) {
			const result = Reflect.apply(connect, this, [destination, ...ports]);
			if (destination === this.context.destination && this.context instanceof AudioContext) {
				const observer = this.context.createScriptProcessor(256, 2, 2);
				const silent = this.context.createGain(); silent.gain.value = 0;
				Reflect.apply(connect, this, [observer, ...ports]);
				Reflect.apply(connect, observer, [silent]);
				Reflect.apply(connect, silent, [this.context.destination]);
				observer.onaudioprocess = event => {
					const samples = event.inputBuffer.getChannelData(0);
					let power = 0;
					for (const sample of samples) power += sample ** 2;
					window.__round6ClickOutput.push({ time: event.playbackTime, rms: Math.sqrt(power / samples.length) });
				};
			}
			return result;
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'continuous Click Removal recording.wav',
		frequency: 1000, duration: 16, channelCount: 1, channelAmplitudes: [.6] })]);
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Click Removal');
	const dialog = page.getByRole('dialog', { name: 'Click Removal', exact: true });
	const threshold = dialog.locator('[data-effect-param="threshold"] input[type="number"]');
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.__round6ClickOutput.some(sample => sample.rms > .2))).toBe(true);
	const healthyAt = await page.evaluate(() => window.__round6ClickOutput.at(-1).time);
	await expect.poll(() => page.evaluate(time => window.__round6ClickOutput.at(-1).time - time, healthyAt)).toBeGreaterThan(.3);
	const healthy = await page.evaluate(time => window.__round6ClickOutput.filter(sample => sample.time > time), healthyAt);
	expect(Math.min(...healthy.map(sample => sample.rms))).toBeGreaterThan(.2);
	const changedAt = await page.evaluate(() => window.__round6ClickOutput.at(-1).time);
	await commitInput(threshold, '201');
	await expect(threshold).toHaveValue('201');
	await expect.poll(() => page.evaluate(time => window.__round6ClickOutput.at(-1).time - time, changedAt)).toBeGreaterThan(.6);
	const changed = await page.evaluate(time => window.__round6ClickOutput.filter(sample => sample.time > time), changedAt);
	console.log('ordinary live Click Removal edit native output', {
		beforeMinimumRms: Math.min(...healthy.map(sample => sample.rms)),
		afterMinimumRms: Math.min(...changed.map(sample => sample.rms)),
		lostFrames: changed.filter(sample => sample.rms < .01).length * 256,
	});
	expect(Math.min(...changed.map(sample => sample.rms))).toBeGreaterThan(.2);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
