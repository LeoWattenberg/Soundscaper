/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openParametricEqSelectionEffect } from './audio-editor-test-helpers.js';

test('selecting a Parametric EQ preset also changes the active preview processor', async ({ page }) => {
	await page.addInitScript(() => {
		window.__round6EqPreviewMessages = [];
		const NativeNode = AudioWorkletNode;
		window.AudioWorkletNode = class extends NativeNode {
			constructor(...args) {
				super(...args);
				if (args[2]?.processorOptions?.effectId !== 'selection-preview-eq') return;
				const post = this.port.postMessage.bind(this.port);
				this.port.postMessage = (...messages) => {
					window.__round6EqPreviewMessages.push(messages[0]);
					return post(...messages);
				};
			}
		};
	});
	const recording = createWavFixture({ name: 'preset-preview.wav', duration: 10, frequency: 440 });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [recording]);
	await clipByName(editor, recording.name).locator('.clip-header').click();
	const dialog = await openParametricEqSelectionEffect(page, editor);
	const output = dialog.locator('.audio-editor-parametric-eq__output input[type="number"]');
	await output.fill('-12');
	await output.press('Enter');
	await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Save as new preset', exact: true }).click();
	const prompt = page.getByRole('dialog', { name: 'Save as new preset', exact: true });
	await prompt.getByRole('textbox').fill('Quiet preview');
	await prompt.getByRole('textbox').press('Enter');
	await expect(prompt).toBeHidden();
	await output.fill('0');
	await output.press('Enter');
	await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Stop preview', exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: 'Preset', exact: true }).click();
	await page.getByRole('option', { name: 'Quiet preview (custom)*', exact: true }).click();
	await expect(output).toHaveValue('-12');
	await expect.poll(() => page.evaluate(() => window.__round6EqPreviewMessages.some(
		message => message.type === 'configure' && message.params?.outputGain === -12,
	))).toBe(true);
});
