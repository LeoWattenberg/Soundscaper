/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium provides the native speaker-device fixture.');
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

for (const preview of ['bin', 'source']) for (const selectedOutput of [false, true]) {
	test(`${preview} audition follows the chosen native speaker output=${String(selectedOutput)}`, async ({ page }) => {
		await page.context().grantPermissions(['microphone']);
		await page.addInitScript(() => {
			globalThis.__round7AuditionOutputs = [];
			const connect = AudioNode.prototype.connect;
			AudioNode.prototype.connect = function (destination, ...ports) {
				const result = Reflect.apply(connect, this, [destination, ...ports]);
				if (destination === this.context.destination && this.context instanceof AudioContext) {
					const analyser = this.context.createAnalyser();
					analyser.fftSize = 2048;
					Reflect.apply(connect, this, [analyser, ...ports]);
					const output = { context: this.context, peak: 0, audibleBlocks: 0 };
					globalThis.__round7AuditionOutputs.push(output);
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
		const editor = await bootEditor(page, '/embed/en/');
		const recording = createWavFixture({ name: 'speaker-audition.wav', frequency: 440, duration: 10, channelCount: 1 });
		await importFiles(editor, [recording]);
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect.poll(() => page.evaluate(() => globalThis.__round7AuditionOutputs.some(output => output.peak > .05))).toBe(true);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		let selectedSinkId = '';
		if (selectedOutput) {
			await editor.locator('[data-action-bar]').getByRole('button', { name: 'Audio setup', exact: true }).click();
			const speakers = editor.getByRole('dialog', { name: 'Audio setup', exact: true })
				.getByRole('combobox', { name: 'Speakers', exact: true });
			selectedSinkId = await speakers.getByRole('option', { name: 'Fake Audio Output 1', exact: true }).getAttribute('value');
			expect(selectedSinkId).toBeTruthy();
			await speakers.selectOption(selectedSinkId);
			await expect(speakers).toHaveValue(selectedSinkId);
			await expect.poll(() => page.evaluate(() => globalThis.__round7AuditionOutputs.find(output => output.peak > .05)?.context.sinkId)).toBe(selectedSinkId);
			await page.keyboard.press('Escape');
		}
		const clip = clipByName(editor, recording.name);
		let play, pause;
		const before = await page.evaluate(() => globalThis.__round7AuditionOutputs.length);
		if (preview === 'source') {
			const panel = await openClipProperties(page, editor, clip);
			play = panel.getByRole('button', { name: 'Play', exact: true });
			await play.click();
			pause = panel.getByRole('button', { name: 'Pause', exact: true });
		} else {
			await clip.locator('.clip-header').click({ button: 'right' });
			await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
			const card = editor.locator('[data-project-bin-item]').first();
			play = card.getByRole('button', { name: /^Play:/u });
			await play.click();
			pause = card.getByRole('button', { name: /^Pause:/u });
		}
		await expect(pause).toBeVisible();
		await expect.poll(() => page.evaluate(index => globalThis.__round7AuditionOutputs.slice(index)
			.some(output => output.peak > .05), before)).toBe(true);
		expect(await page.evaluate(index => globalThis.__round7AuditionOutputs.slice(index)
			.find(output => output.peak > .05)?.context.sinkId, before)).toBe(selectedSinkId);
		if (selectedOutput) {
			await editor.locator('[data-action-bar]').getByRole('button', { name: 'Audio setup', exact: true }).click();
			const speakers = editor.getByRole('dialog', { name: 'Audio setup', exact: true })
				.getByRole('combobox', { name: 'Speakers', exact: true });
			const secondSinkId = await speakers.getByRole('option', { name: 'Fake Audio Output 2', exact: true }).getAttribute('value');
			await speakers.selectOption(secondSinkId);
			await expect.poll(() => page.evaluate(index => globalThis.__round7AuditionOutputs.slice(index)
				.find(output => output.peak > .05)?.context.sinkId, before)).toBe(secondSinkId);
			await page.keyboard.press('Escape');
			await expect(pause).toBeVisible();
			await pause.click();
			await editor.locator('[data-action-bar]').getByRole('button', { name: 'Audio setup', exact: true }).click();
			await speakers.selectOption('');
			await expect.poll(() => page.evaluate(index => globalThis.__round7AuditionOutputs.slice(index)
				.find(output => output.peak > .05)?.context.sinkId, before)).toBe('');
			await page.keyboard.press('Escape');
			const previousBlocks = await page.evaluate(index => globalThis.__round7AuditionOutputs.slice(index)
				.find(output => output.peak > .05).audibleBlocks, before);
			await play.click();
			await expect(pause).toBeVisible();
			await expect.poll(() => page.evaluate(index => globalThis.__round7AuditionOutputs.slice(index)
				.find(output => output.peak > .05).audibleBlocks, before)).toBeGreaterThan(previousBlocks + 2);
		}
		await pause.click();
	});
}
