/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, closeClipProperties,
	disableNativeSavePicker, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { createEbuR128Meter } from '../../src/common/editor/ebu-r128.js';

test('Loudness Normalization includes the first full block of an 11025 Hz source', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const sampleRate = 11_025;
	const samples = Float32Array.from({ length: sampleRate }, (_, frame) =>
		frame < sampleRate * 0.4 ? 0.3 * Math.sin(2 * Math.PI * 1000 * frame / sampleRate) : 0);
	const recording = { name: 'phrase-and-pause.wav', mimeType: 'audio/wav',
		buffer: Buffer.from(encodeWav([samples], { sampleRate, float: true })) };
	await importFiles(editor, [recording]);
	const properties = await openClipProperties(page, editor, clipByName(editor, recording.name));
	const waveform = properties.getByRole('region', { name: 'Source waveform', exact: true });
	await waveform.focus();
	await waveform.press('Control+a');
	await expect(waveform.locator('.audio-editor-source-selection')).toBeVisible();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Loudness Normalization']);
	const effect = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await effect.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(effect).toBeHidden({ timeout: 20_000 });
	await closeClipProperties(properties);
	const output = await exportSamples(page, editor);
	const meter = createEbuR128Meter({ sampleRate: 48_000, channelCount: 1, running: true });
	meter.push([Float32Array.from(output)]);
	// Default dual-mono normalization is -26.01 LUFS; the centred mono track's
	// left export channel is another 3.01 dB lower through equal-power panning.
	expect(meter.snapshot().loudness.integratedLufs).toBeCloseTo(-29.0206, 0);
});
