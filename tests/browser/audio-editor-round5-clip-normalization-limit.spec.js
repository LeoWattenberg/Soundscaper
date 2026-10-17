/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { chooseClipMediaSetting, expectClipGain } from './audio-editor-clip-settings-test-helpers.js';
import { bootEditor, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('normalizing a quiet recording reports an unreachable target without substituting a different gain', async ({ page }) => {
	const recording = createWavFixture({ name: 'quiet-microphone.wav', frequency: 440,
		duration: 0.8, channelCount: 1, channelAmplitudes: [0.002] });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [recording]);
	const properties = await openClipProperties(page, editor, clipByName(editor, recording.name));
	await expectClipGain(properties, 0);
	await chooseClipMediaSetting(properties, 'Normalize to −1 dBFS');
	await expect(page.getByRole('alert').filter({ hasText: 'requires more than the maximum clip gain' })).toBeVisible();
	await expectClipGain(properties, 0);
});
