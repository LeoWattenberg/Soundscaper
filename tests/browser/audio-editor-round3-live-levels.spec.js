/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('live Analysis peak retains the level of a stereo recording with one silent channel', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'left-only-recording.wav', frequency: 440,
		duration: 6, channelCount: 2, channelAmplitudes: [0.8, 0] })]);
	await chooseCommandAction(page, editor, 'Analyze', 'Analysis');
	const panel = editor.locator('[data-workspace-panel="analysis"]');
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(async () => Number.parseFloat(await panel.locator('[data-live-analysis-value="peak"]').textContent()))
		.toBeGreaterThan(-2.1);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
