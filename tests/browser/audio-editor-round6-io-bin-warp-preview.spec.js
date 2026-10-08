/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseNestedCommandAction, clipByName, importFiles, registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('ordinary warped bin audition', () => {
	registerAudioEditorHooks();

	test('an authored warp can play after moving its recording to Project bin', async ({ page }, testInfo) => {
		await page.addInitScript(() => {
			window.__binWarpOutput = [];
			const connect = AudioNode.prototype.connect;
			AudioNode.prototype.connect = function (destination, ...ports) {
				const result = Reflect.apply(connect, this, [destination, ...ports]);
				if (destination === this.context.destination && this.context instanceof AudioContext) {
					const analyser = this.context.createAnalyser();
					analyser.fftSize = 2048;
					Reflect.apply(connect, this, [analyser, ...ports]);
					const observation = { peak: 0, audibleSamples: 0, firstTime: null, lastTime: null };
					window.__binWarpOutput.push(observation);
					const values = new Float32Array(analyser.fftSize);
					const interval = setInterval(() => {
						if (this.context.state === 'closed') { clearInterval(interval); return; }
						analyser.getFloatTimeDomainData(values);
						let peak = 0;
						for (const value of values) peak = Math.max(peak, Math.abs(value));
						observation.peak = Math.max(observation.peak, peak);
						if (peak > 0.1) {
							observation.audibleSamples++;
							observation.firstTime ??= this.context.currentTime;
							observation.lastTime = this.context.currentTime;
						}
					}, 20);
				}
				return result;
			};
		});
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		const clip = clipByName(editor, monoTone.name);
		await clip.locator('.clip-header').click();
		await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
		const warp = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
		await warp.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
		await warp.getByLabel('Outer position', { exact: true }).fill('12000');
		await warp.getByLabel('Source sample', { exact: true }).fill('18000');
		await warp.getByRole('button', { name: 'Add marker', exact: true }).click();
		await expect(warp.getByLabel('Marker 1 source sample', { exact: true })).toHaveValue('18000/1');
		await warp.getByRole('button', { name: 'Close', exact: true }).click();
		await clip.locator('.clip-header').click({ button: 'right' });
		await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
		const card = editor.getByRole('listitem', { name: `Project bin: ${monoTone.name.replace(/\.wav$/u, '')}`, exact: true });
		await expect(card).toBeVisible();
		const before = await page.evaluate(() => window.__binWarpOutput.length);
		await card.getByRole('button', { name: /^Play:/u }).click();
		try {
			await expect.poll(() => page.evaluate(index => window.__binWarpOutput.slice(index)
				.some(output => output.peak > 0.1 && output.audibleSamples > 10
					&& output.lastTime - output.firstTime > 0.5), before)).toBe(true);
		} finally {
			await testInfo.attach('bin-warp-output.json', {
				body: JSON.stringify(await page.evaluate(index => window.__binWarpOutput.slice(index), before)),
				contentType: 'application/json',
			});
		}
		await expect(editor.locator('[data-status]')).not.toHaveAttribute('data-state', 'error');
	});
});
