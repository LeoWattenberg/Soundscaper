/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, closeClipProperties,
	commitInput, disableNativeSavePicker, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('Bitcrusher starts each sample hold at the authored ten-frame reduction boundary', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'ten-frame-hold.wav', frequency: 1_200,
		duration: 1, sampleRate: 48_000, channelCount: 1, channelAmplitudes: [.4] });
	await importFiles(editor, [recording]);
	const properties = await openClipProperties(page, editor, clipByName(editor, recording.name));
	const waveform = properties.getByRole('region', { name: 'Source waveform', exact: true });
	await waveform.focus();
	await waveform.press('Control+a');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Distortion and modulation', 'Bitcrusher']);
	const effect = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await commitInput(effect.getByRole('spinbutton', { name: 'Sample rate reduction', exact: true }), '10');
	await effect.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(effect).toBeHidden({ timeout: 20_000 });
	await closeClipProperties(properties);
	const output = await exportSamples(page, editor);
	console.log('Bitcrusher authored ten-frame hold boundary', output.slice(1_008, 1_012));
	// Past the normal clip onset ramp, this hold captures the sine's positive peak.
	expect(output[1_010] - output[1_009]).toBeGreaterThan(.2);
	expect(Math.abs(output[1_009] - output[1_000])).toBeLessThan(.001);
	expect(Math.abs(output[1_011] - output[1_010])).toBeLessThan(.001);
});
