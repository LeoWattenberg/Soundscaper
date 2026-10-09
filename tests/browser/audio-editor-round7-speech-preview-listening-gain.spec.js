/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, collectClientErrors } from './audio-editor-test-helpers.js';
import { installMilestone7LocalAssistanceFixture } from './helpers/milestone-7-local-assistance.js';
import { createRound7SpeechPreviewBridge } from '../helpers/round7-speech-preview-bridge.ts';

test('ordinary generated speech previews retain Playback volume including mute', async ({ page }) => {
	await installMilestone7LocalAssistanceFixture(page);
	await page.addInitScript(createRound7SpeechPreviewBridge, true);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	const volume = editor.getByRole('slider', { name: 'Playback volume', exact: true });
	await volume.focus();
	await volume.press('End');
	await expect(volume).toHaveValue('1');
	await chooseCommandAction(page, editor, 'Generate', 'Text to Speech');
	let speech = page.getByRole('dialog', { name: 'Text to Speech', exact: true });
	await speech.getByRole('textbox', { name: 'Script', exact: true }).fill('A normal narration preview.');
	await speech.getByRole('button', { name: 'Generate preview', exact: true }).click();
	let audio = speech.locator('audio');
	await expect.poll(() => audio.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2);
	expect(await audio.evaluate(element => element.volume)).toBe(1);
	await audio.click({ position: { x: 16, y: 16 } });
	await expect.poll(() => audio.evaluate(element => element.currentTime)).toBeGreaterThan(0.05);
	await speech.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(speech).toHaveCount(0);
	await volume.focus();
	await volume.press('Home');
	await expect(volume).toHaveValue('0');
	await chooseCommandAction(page, editor, 'Generate', 'Text to Speech');
	speech = page.getByRole('dialog', { name: 'Text to Speech', exact: true });
	await speech.getByRole('textbox', { name: 'Script', exact: true }).fill('Another narration with Playback volume muted.');
	await speech.getByRole('button', { name: 'Generate preview', exact: true }).click();
	audio = speech.locator('audio');
	await expect.poll(() => audio.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2);
	expect(await audio.evaluate(element => element.volume)).toBe(0);
	await audio.click({ position: { x: 16, y: 16 } });
	await expect.poll(() => audio.evaluate(element => element.currentTime)).toBeGreaterThan(0.05);
	await speech.getByRole('button', { name: 'Close', exact: true }).last().click();
	expect(errors).toEqual([]);
});
