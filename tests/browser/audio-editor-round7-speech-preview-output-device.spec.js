/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { installMilestone7LocalAssistanceFixture } from './helpers/milestone-7-local-assistance.js';
import { createRound7SpeechPreviewBridge } from '../helpers/round7-speech-preview-bridge.ts';

test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium provides the native speaker-device fixture.');
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

for (const selectedOutput of [false, true]) test(`ordinary speech preview follows native Speakers output=${String(selectedOutput)}`, async ({ page }) => {
	await page.context().grantPermissions(['microphone']);
	await installMilestone7LocalAssistanceFixture(page);
	await page.addInitScript(createRound7SpeechPreviewBridge, true);
	await page.addInitScript(() => {
		globalThis.__round7SpeechMainOutput = null;
		const setSinkId = AudioContext.prototype.setSinkId;
		AudioContext.prototype.setSinkId = async function (deviceId) {
			const result = await Reflect.apply(setSinkId, this, [deviceId]);
			globalThis.__round7SpeechMainOutput = this.sinkId;
			return result;
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'native-speaker-control.wav', duration: 2 })]);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	let selectedSinkId = '';
	if (selectedOutput) {
		await editor.locator('[data-action-bar]').getByRole('button', { name: 'Audio setup', exact: true }).click();
		const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
		const speakers = setup.getByRole('combobox', { name: 'Speakers', exact: true });
		selectedSinkId = await speakers.getByRole('option', { name: 'Fake Audio Output 1', exact: true }).getAttribute('value');
		expect(selectedSinkId).toBeTruthy();
		await speakers.selectOption(selectedSinkId);
		await expect(speakers).toHaveValue(selectedSinkId);
		await expect.poll(() => page.evaluate(() => globalThis.__round7SpeechMainOutput)).toBe(selectedSinkId);
		await page.keyboard.press('Escape');
	}
	await chooseCommandAction(page, editor, 'Generate', 'Text to Speech');
	const speech = page.getByRole('dialog', { name: 'Text to Speech', exact: true });
	await speech.getByRole('textbox', { name: 'Script', exact: true }).fill('Narration through my chosen speakers.');
	await speech.getByRole('button', { name: 'Generate preview', exact: true }).click();
	const audio = speech.locator('audio');
	await expect.poll(() => audio.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2);
	await expect.poll(() => audio.evaluate(element => element.controls)).toBe(true);
	await audio.click({ position: { x: 16, y: 16 } });
	await expect.poll(() => audio.evaluate(element => element.currentTime)).toBeGreaterThan(.05);
	expect(await audio.evaluate(element => element.sinkId)).toBe(selectedSinkId);
	await speech.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(speech).toHaveCount(0);
});
