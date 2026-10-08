/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('normalizing a quiet recording reports an unreachable target without substituting a different gain', async ({ page }) => {
	const recording = createWavFixture({ name: 'quiet-microphone.wav', frequency: 440,
		duration: 0.8, channelCount: 1, channelAmplitudes: [0.002] });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [recording]);
	const properties = await openClipProperties(page, editor, clipByName(editor, recording.name));
	await properties.getByText('Normalize', { exact: true }).click();
	const gain = properties.getByRole('spinbutton', { name: 'Clip gain (dB)', exact: true });
	await expect(gain).toHaveValue('0.00');
	await properties.getByRole('button', { name: 'Normalize to −1 dBFS', exact: true }).click();
	await expect(properties.getByRole('alert')).toContainText('requires more than the maximum clip gain');
	await expect(gain).toHaveValue('0.00');
});
