/* SPDX-License-Identifier: AGPL-3.0-only */

import { encodeWav } from '../../src/common/editor/wav.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

test.describe('ordinary native-channel Bin audition', () => {
	registerAudioEditorHooks();
	for (const channelCount of [2, 6]) test(`${channelCount === 6 ? 'centre-channel surround' : 'stereo'} programme remains audible in Project Bin`, async ({ page }) => {
		await page.addInitScript(() => {
			window.__binProgrammeOutput = [];
			const connect = AudioNode.prototype.connect;
			AudioNode.prototype.connect = function (destination, ...ports) {
				const result = Reflect.apply(connect, this, [destination, ...ports]);
				if (destination === this.context.destination && this.context instanceof AudioContext) {
					const analyser = this.context.createAnalyser();
					analyser.fftSize = 2048;
					Reflect.apply(connect, this, [analyser, ...ports]);
					const output = { peak: 0, audibleBlocks: 0 };
					window.__binProgrammeOutput.push(output);
					const samples = new Float32Array(analyser.fftSize);
					const interval = setInterval(() => {
						if (this.context.state === 'closed') { clearInterval(interval); return; }
						analyser.getFloatTimeDomainData(samples);
						let peak = 0;
						for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
						output.peak = Math.max(output.peak, peak);
						if (peak > .05) output.audibleBlocks++;
					}, 20);
				}
				return result;
			};
		});
		const channels = Array.from({ length: channelCount }, (_value, channel) => Float32Array.from({ length: 96_000 }, (_sample, frame) =>
			(channelCount === 6 ? channel === 2 : channel < 2) ? .4 * Math.sin(2 * Math.PI * 440 * frame / 48_000) : 0));
		const fixture = { name: 'Dialogue.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav(channels, {
			sampleRate: 48_000, bitDepth: 16, dither: false, ...(channelCount === 6 ? { channelMask: 0x3f } : {}),
		})) };
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [fixture]);
		const clip = clipByName(editor, fixture.name);
		await expect(clip).toHaveCount(1);
		await clip.locator('.clip-header').click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
		const card = editor.getByRole('listitem', { name: 'Project bin: Dialogue', exact: true });
		await expect(card).toBeVisible();
		const before = await page.evaluate(() => window.__binProgrammeOutput.length);
		await card.getByRole('button', { name: /^Play:/u }).click();
		await expect.poll(() => page.evaluate(index => window.__binProgrammeOutput.slice(index)
			.some(output => output.peak > .05 && output.audibleBlocks > 10), before)).toBe(true);
		await expect(editor.locator('[data-status]')).not.toHaveAttribute('data-state', 'error');
	});
});
