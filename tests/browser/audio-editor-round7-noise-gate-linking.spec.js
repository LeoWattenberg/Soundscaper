/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseDropdown, commitInput, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test.use({ browserCoverage: false });

test('linking a running Noise gate immediately shares its sounding channel gain', async ({ page }) => {
	await page.addInitScript(() => {
		window.__round7GateNodes = [];
		const NativeNode = AudioWorkletNode;
		const connect = AudioNode.prototype.connect;
		window.AudioWorkletNode = class extends NativeNode {
			constructor(...args) {
				super(...args);
				if (args[2]?.processorOptions?.type !== 'noise-gate' || !(this.context instanceof AudioContext)) return;
				const observed = { samples: [], linkedAt: null, params: args[2].processorOptions.params };
				window.__round7GateNodes.push(observed);
				const observer = this.context.createScriptProcessor(256, 2, 2);
				const silent = this.context.createGain(); silent.gain.value = 0;
				Reflect.apply(connect, this, [observer]);
				Reflect.apply(connect, observer, [silent]);
				Reflect.apply(connect, silent, [this.context.destination]);
				observer.onaudioprocess = event => {
					const rms = [0, 1].map(channel => {
						const input = event.inputBuffer.getChannelData(channel);
						return Math.sqrt(input.reduce((power, sample) => power + sample * sample, 0) / input.length);
					});
					observed.samples.push({ time: event.playbackTime, rms });
					if (observed.samples.length > 2000) observed.samples.shift();
				};
				const post = this.port.postMessage.bind(this.port);
				this.port.postMessage = (...messages) => {
					if (messages[0]?.type === 'configure') observed.params = messages[0].params;
					if (messages[0]?.type === 'configure' && messages[0].params?.stereoLink === 'linked') {
						observed.linkedAt = this.context.currentTime;
					}
					return post(...messages);
				};
			}
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'independent gate stereo recording.wav',
		frequency: 1000, duration: 16, channelCount: 2, channelAmplitudes: [.6, .006] })]);
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Noise gate');
	const dialog = page.getByRole('dialog', { name: 'Noise gate', exact: true });
	await commitInput(dialog.locator('[data-effect-param="attack"] input[type="number"]'), '1000');
	const linking = dialog.getByRole('group', { name: 'Stereo linking', exact: true });
	await chooseDropdown(page, linking, 'Independent channels');
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.__round7GateNodes.at(-1)?.samples.at(-1)?.rms[0] ?? 0)).toBeGreaterThan(.4);
	expect(await page.evaluate(() => window.__round7GateNodes.at(-1).params.attack)).toBe(1);
	const before = await page.evaluate(() => window.__round7GateNodes.at(-1).samples.at(-1).rms);
	expect(before[1] / before[0]).toBeLessThan(.001);
	const count = await page.evaluate(() => window.__round7GateNodes.length);
	await chooseDropdown(page, linking, 'Link channels');
	await expect.poll(() => page.evaluate(() => {
		const observed = window.__round7GateNodes.at(-1);
		return observed?.linkedAt !== null && observed?.samples.at(-1)?.time > observed.linkedAt + .35;
	})).toBe(true);
	const ratios = await page.evaluate(() => {
		const observed = window.__round7GateNodes.at(-1);
		return observed.samples.filter(sample => sample.time > observed.linkedAt + .15 && sample.time < observed.linkedAt + .35)
			.map(sample => sample.rms[1] / sample.rms[0]);
	});
	expect(ratios.length).toBeGreaterThan(4);
	console.log('ordinary Noise gate relinking native channel ratios', { before: before[1] / before[0], minimum: Math.min(...ratios), maximum: Math.max(...ratios) });
	expect(Math.min(...ratios)).toBeGreaterThan(.009);
	expect(Math.max(...ratios)).toBeLessThan(.011);
	expect(await page.evaluate(() => window.__round7GateNodes.length)).toBe(count);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
