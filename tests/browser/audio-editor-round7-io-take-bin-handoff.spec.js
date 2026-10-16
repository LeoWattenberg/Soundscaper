/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone, persistedProject } from './helpers/complex-editing-workflows.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test.use({ browserCoverage: false });
for (const bin of [false, true]) test(`native recorded take audition retires ${bin ? 'Bin' : 'timeline'} playback`, async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__round7TakeOutputs = [];
		const connect = AudioNode.prototype.connect;
		AudioNode.prototype.connect = function (destination, ...ports) {
			const result = Reflect.apply(connect, this, [destination, ...ports]);
			if (destination === this.context.destination && this.context instanceof AudioContext) {
				const analyser = this.context.createAnalyser(); analyser.fftSize = 2048;
				Reflect.apply(connect, this, [analyser, ...ports]);
				const output = { context: this.context, peak: 0 };
				globalThis.__round7TakeOutputs.push(output);
				const samples = new Float32Array(analyser.fftSize);
				const interval = setInterval(() => {
					if (this.context.state === 'closed') { clearInterval(interval); return; }
					analyser.getFloatTimeDomainData(samples);
					output.peak = samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
				}, 20);
			}
			return result;
		};
	});
	await installOscillatorMicrophone(page);
	const editor = await bootEditor(page, '/embed/en/');
	const audition = createWavFixture({ name: 'Separate audition.wav', frequency: 880, duration: 8, channelCount: 1 });
	await importFiles(editor, [audition]);
	await clipByName(editor, audition.name).locator('.clip-header').click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Move to Project bin', exact: true }).click();
	const loop = createWavFixture({ name: 'Recording loop.wav', frequency: 440, duration: 2, channelCount: 1 });
	await importFiles(editor, [loop]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Select', ['Loop region', 'Set loop to selection']);
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	await editor.getByRole('button', { name: 'Record options', exact: true }).click();
	await page.getByRole('dialog', { name: 'Record options', exact: true }).getByRole('button', { name: 'Record loop into takes', exact: true }).click();
	await expect(editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button')).toHaveAttribute('aria-pressed', 'true');
	const start = await page.evaluate(() => globalThis.__complexWorkflowStreams.at(-1).context.currentTime);
	await expect.poll(() => page.evaluate(() => globalThis.__complexWorkflowStreams.at(-1).context.currentTime)).toBeGreaterThan(start + 1.1);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect.poll(async () => (await persistedProject(page, await editor.getAttribute('data-project-id'))).takeGroups.length).toBe(1);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await expect(editor.locator('[data-transport="record"] .kw-audio-editor__split-button-main button')).toHaveAttribute('aria-pressed', 'false');
	const project = await persistedProject(page, await editor.getAttribute('data-project-id'));
	expect(project.takeGroups[0].takes.length).toBeGreaterThan(0);
	const track = editor.locator(`[data-track-row][data-track-id="${project.takeGroups[0].trackId}"]`);
	await chooseNestedCommandAction(page, editor, 'Window', ['Project bin']);
	const card = editor.locator('[data-project-bin-item]').first();
	const before = await page.evaluate(() => globalThis.__round7TakeOutputs.length);
	if (bin) await card.getByRole('button', { name: /^Play:/u }).click();
	else await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(index => globalThis.__round7TakeOutputs.slice(index).some(output => output.peak > .05), before)).toBe(true);
	const oldOutput = await page.evaluate(index => globalThis.__round7TakeOutputs.findIndex((output, position) => position >= index && output.peak > .05), before);
	await chooseTrackMenuAction(page, editor, track, 'Take lanes and comps');
	const takes = page.getByRole('dialog', { name: 'Take lanes and comps', exact: true });
	await takes.getByRole('button', { name: /^Audition /u }).first().click();
	await expect.poll(() => page.evaluate(index => globalThis.__round7TakeOutputs.some((output, position) => position !== index && output.peak > .05), oldOutput)).toBe(true);
	await expect.poll(() => page.evaluate(index => globalThis.__round7TakeOutputs[index].peak, oldOutput)).toBeLessThan(.001);
	if (bin) await expect(card.getByRole('button', { name: /^Play:/u })).toBeVisible();
	await takes.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect.poll(() => page.evaluate(() => globalThis.__round7TakeOutputs.every(output => output.peak < .001))).toBe(true);
	await card.getByRole('button', { name: /^Play:/u }).click();
	await expect(card.getByRole('button', { name: /^Pause:/u })).toBeVisible();
	await expect.poll(() => page.evaluate(() => globalThis.__round7TakeOutputs.some(output => output.peak > .05))).toBe(true);
	await card.getByRole('button', { name: /^Pause:/u }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__round7TakeOutputs.every(output => output.peak < .001))).toBe(true);
});
