/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test.use({ browserCoverage: false });
for (const shortcut of [false, true]) test(`native play-at-speed ${shortcut ? 'configured shortcut' : 'toolbar'} retires the audible Bin owner`, async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__round7SpeedOutputs = [];
		const connect = AudioNode.prototype.connect;
		AudioNode.prototype.connect = function (destination, ...ports) {
			const result = Reflect.apply(connect, this, [destination, ...ports]);
			if (destination === this.context.destination && this.context instanceof AudioContext) {
				const analyser = this.context.createAnalyser(); analyser.fftSize = 2048;
				Reflect.apply(connect, this, [analyser, ...ports]);
				const output = { context: this.context, peak: 0, blocks: 0 };
				globalThis.__round7SpeedOutputs.push(output);
				const samples = new Float32Array(analyser.fftSize);
				const interval = setInterval(() => {
					if (this.context.state === 'closed') { clearInterval(interval); return; }
					analyser.getFloatTimeDomainData(samples);
					output.peak = samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
					if (output.peak > .05) output.blocks++;
				}, 20);
			}
			return result;
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	if (shortcut) {
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
		await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('Play at speed');
		const command = preferences.getByRole('group', { name: 'Play at speed', exact: true }).locator('..');
		await command.getByRole('textbox').first().fill('Ctrl+Alt+P');
		await command.getByRole('button', { name: 'Assign', exact: true }).click();
		await expect(command.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	}
	const timeline = createWavFixture({ name: 'Timeline.wav', frequency: 440, duration: 8, channelCount: 1 });
	const audition = createWavFixture({ name: 'Audition.wav', frequency: 880, duration: 8, channelCount: 1 });
	await importFiles(editor, [timeline, audition]);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await clipByName(editor, audition.name).locator('.clip-header').click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await editor.getByRole('button', { name: 'Play options', exact: true }).click();
	await editor.getByRole('slider', { name: 'Playback speed', exact: true }).fill('1.25');
	await page.keyboard.press('Escape');
	const card = editor.locator('[data-project-bin-item]').first();
	const before = await page.evaluate(() => globalThis.__round7SpeedOutputs.length);
	await card.getByRole('button', { name: /^Play:/u }).click();
	await expect(card.getByRole('button', { name: /^Pause:/u })).toBeVisible();
	await expect.poll(() => page.evaluate(index => globalThis.__round7SpeedOutputs.slice(index).some(output => output.peak > .05), before)).toBe(true);
	const binOutput = await page.evaluate(index => globalThis.__round7SpeedOutputs.findIndex((output, position) => position >= index && output.peak > .05), before);
	if (shortcut) await page.keyboard.press('Control+Alt+P');
	else await editor.getByRole('button', { name: 'Play at speed', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Pause play at speed', exact: true })).toBeVisible();
	await expect.poll(() => page.evaluate(index => globalThis.__round7SpeedOutputs.some((output, position) => position !== index && output.peak > .05), binOutput)).toBe(true);
	await expect.poll(() => page.evaluate(index => globalThis.__round7SpeedOutputs[index].peak, binOutput)).toBeLessThan(.001);
	await expect(card.getByRole('button', { name: /^Play:/u })).toBeVisible();
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await card.getByRole('button', { name: /^Play:/u }).click();
	await expect.poll(() => page.evaluate(index => globalThis.__round7SpeedOutputs[index].peak, binOutput)).toBeGreaterThan(.05);
	await card.getByRole('button', { name: /^Pause:/u }).click();
});
