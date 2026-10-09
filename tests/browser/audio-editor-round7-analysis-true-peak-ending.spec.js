/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('Analyze selection includes the ending true peak of an ordinary Fade In', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'high frequency recording.wav', sampleRate: 48_000,
		frequency: 12_000, duration: 1, channelCount: 1, channelAmplitudes: [.5] })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Fading', 'Fade In']);
	await expect(editor.locator('[data-status]')).toHaveText('Applied the Audacity effect.');
	await chooseCommandAction(page, editor, 'Analyze', 'Analyze selection');
	const analysis = page.getByRole('dialog', { name: 'Analyze selection', exact: true });
	await expect(analysis.locator('[data-analysis-value="peak"]')).toHaveText('-9.0 dBFS');
	await expect(analysis.locator('[data-analysis-value="truePeak"]')).toHaveText('-8.9 dBTP');
});
