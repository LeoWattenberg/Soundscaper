/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, commitInput, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test.use({ browserCoverage: false });

test('reducing live Noise gate attenuation keeps a below-threshold recording closed', async ({ page }) => {
	await page.addInitScript(() => {
		window.__round7GateFloorNodes = [];
		const NativeNode = AudioWorkletNode;
		const connect = AudioNode.prototype.connect;
		window.AudioWorkletNode = class extends NativeNode {
			constructor(...args) {
				super(...args);
				if (args[2]?.processorOptions?.type !== 'noise-gate' || !(this.context instanceof AudioContext)) return;
				const observed = { samples: [], changedAt: null };
				window.__round7GateFloorNodes.push(observed);
				const observer = this.context.createScriptProcessor(256, 1, 1);
				const silent = this.context.createGain(); silent.gain.value = 0;
				Reflect.apply(connect, this, [observer]);
				Reflect.apply(connect, observer, [silent]);
				Reflect.apply(connect, silent, [this.context.destination]);
				observer.onaudioprocess = event => {
					const input = event.inputBuffer.getChannelData(0);
					observed.samples.push({ time: event.playbackTime, peak: Math.max(...input.map(Math.abs)) });
					if (observed.samples.length > 1000) observed.samples.shift();
				};
				const post = this.port.postMessage.bind(this.port);
				this.port.postMessage = (...messages) => {
					if (messages[0]?.type === 'configure' && messages[0].params?.rangeDb === -60) observed.changedAt = this.context.currentTime;
					return post(...messages);
				};
			}
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'quiet gate floor recording.wav',
		frequency: 1000, duration: 16, channelCount: 1, channelAmplitudes: [.1] })]);
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Noise gate');
	const dialog = page.getByRole('dialog', { name: 'Noise gate', exact: true });
	for (const [parameter, value] of [['threshold', '-6'], ['attack', '1'],
		['hold', '0'], ['release', '4000'], ['rangeDb', '-80']]) {
		await commitInput(dialog.locator(`[data-effect-param="${parameter}"] input[type="number"]`), value);
	}
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.__round7GateFloorNodes.at(-1)?.samples.at(-1)?.peak ?? 0)).toBeGreaterThan(.000009);
	expect(await page.evaluate(() => window.__round7GateFloorNodes.at(-1).samples.at(-1).peak)).toBeLessThan(.000011);
	const count = await page.evaluate(() => window.__round7GateFloorNodes.length);
	await commitInput(dialog.locator('[data-effect-param="rangeDb"] input[type="number"]'), '-60');
	await expect.poll(() => page.evaluate(() => {
		const observed = window.__round7GateFloorNodes.at(-1);
		return observed?.changedAt !== null && observed?.samples.at(-1)?.time > observed.changedAt + .2;
	})).toBe(true);
	const peaks = await page.evaluate(() => {
		const observed = window.__round7GateFloorNodes.at(-1);
		return observed.samples.filter(sample => sample.time > observed.changedAt + .05 && sample.time < observed.changedAt + .2).map(sample => sample.peak);
	});
	expect(peaks.length).toBeGreaterThan(4);
	console.log('ordinary closed gate attenuation edit', { maximumPeak: Math.max(...peaks), expectedMaximumPeak: .0001 });
	expect(Math.max(...peaks)).toBeLessThan(.000102);
	// ScriptProcessor can deliver queued pre-edit audio after the main-thread
	// port timestamp. Preserve the early overshoot bound and verify the final
	// requested floor against physically delivered recent blocks separately.
	await expect.poll(() => page.evaluate(() => {
		const observed = window.__round7GateFloorNodes.at(-1);
		const recent = observed.samples.slice(-4);
		return recent.length === 4 && recent.every(sample => sample.time > observed.changedAt + .2)
			? Math.min(...recent.map(sample => sample.peak)) : 0;
	})).toBeGreaterThan(.000098);
	expect(await page.evaluate(() => Math.max(...window.__round7GateFloorNodes.at(-1).samples.slice(-4)
		.map(sample => sample.peak)))).toBeLessThan(.000102);
	expect(await page.evaluate(() => window.__round7GateFloorNodes.length)).toBe(count);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
