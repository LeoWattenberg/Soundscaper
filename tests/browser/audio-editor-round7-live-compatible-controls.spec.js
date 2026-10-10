/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, commitInput, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test('changing live Noise Reduction sensitivity updates the running rack processor', async ({ page }) => {
	await page.addInitScript(() => {
		window.__round7NoiseNodes = [];
		const NativeNode = AudioWorkletNode;
		window.AudioWorkletNode = class extends NativeNode {
			constructor(...args) {
				super(...args);
				if (args[2]?.processorOptions?.effectType !== 'audacity-noise-reduction') return;
				const observed = { messages: [] };
				window.__round7NoiseNodes.push(observed);
				const post = this.port.postMessage.bind(this.port);
				this.port.postMessage = (...messages) => {
					observed.messages.push(messages[0]);
					return post(...messages);
				};
			}
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'continuous noise reduction recording.wav',
		frequency: 1000, duration: 16, channelCount: 1, channelAmplitudes: [.6] })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Noise Reduction');
	const dialog = page.getByRole('dialog', { name: 'Noise Reduction', exact: true });
	await dialog.getByRole('button', { name: 'Get noise profile', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Replace noise profile', exact: true })).toBeVisible();
	await commitInput(dialog.locator('[data-effect-param="reductionDb"] input[type="number"]'), '0');
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await expect.poll(() => page.evaluate(() => window.__round7NoiseNodes.length)).toBeGreaterThan(0);
	const count = await page.evaluate(() => window.__round7NoiseNodes.length);
	await commitInput(dialog.locator('[data-effect-param="sensitivity"] input[type="number"]'), '7');
	await expect.poll(() => page.evaluate(() => window.__round7NoiseNodes.at(-1).messages.some(
		message => message.type === 'params' && message.params.sensitivity === 7 && message.params.reductionDb === 0,
	))).toBe(true);
	expect(await page.evaluate(() => window.__round7NoiseNodes.length)).toBe(count);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
