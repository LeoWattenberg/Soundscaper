/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test('a live Graphic EQ band edit preserves the already audible recording at unchanged filter geometry', async ({ page }) => {
	await page.addInitScript(() => {
		window.__round6EqOutput = [];
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
					window.__round6EqOutput.push({ time: event.playbackTime, rms: Math.sqrt(power / samples.length) });
				};
			}
			return result;
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'continuous Graphic EQ recording.wav',
		frequency: 1000, duration: 16, channelCount: 1, channelAmplitudes: [.6] })]);
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Graphic EQ');
	const dialog = page.getByRole('dialog', { name: 'Graphic EQ', exact: true });
	const band = dialog.getByRole('slider', { name: '1000 Hz', exact: true });
	await band.focus();
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.__round6EqOutput.some(sample => sample.rms > .2))).toBe(true);
	const healthyAt = await page.evaluate(() => window.__round6EqOutput.at(-1).time);
	await expect.poll(() => page.evaluate(time => window.__round6EqOutput.at(-1).time - time, healthyAt)).toBeGreaterThan(.3);
	const healthy = await page.evaluate(time => window.__round6EqOutput.filter(sample => sample.time > time), healthyAt);
	expect(Math.min(...healthy.map(sample => sample.rms))).toBeGreaterThan(.2);
	const changedAt = await page.evaluate(() => window.__round6EqOutput.at(-1).time);
	await band.focus();
	await band.press('ArrowUp');
	await expect(band).toHaveAttribute('aria-valuenow', '1');
	await expect.poll(() => page.evaluate(time => window.__round6EqOutput.at(-1).time - time, changedAt)).toBeGreaterThan(.4);
	const changed = await page.evaluate(time => window.__round6EqOutput.filter(sample => sample.time > time), changedAt);
	console.log('ordinary live Graphic EQ edit native output', {
		beforeMinimumRms: Math.min(...healthy.map(sample => sample.rms)),
		afterMinimumRms: Math.min(...changed.map(sample => sample.rms)),
		lostFrames: changed.filter(sample => sample.rms < .01).length * 256,
	});
	expect(Math.min(...changed.map(sample => sample.rms))).toBeGreaterThan(.2);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
