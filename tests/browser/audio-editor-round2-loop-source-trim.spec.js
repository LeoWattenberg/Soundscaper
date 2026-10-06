/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, closeClipProperties, disableNativeSavePicker, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

function frequency(samples) {
	const crossings = [];
	for (let i = 1000; i < 10_000; i += 1) if (samples[i - 1] <= 0 && samples[i] > 0)
		crossings.push(i - 1 - samples[i - 1] / (samples[i] - samples[i - 1]));
	expect(crossings.length).toBeGreaterThan(20);
	return 48_000 * (crossings.length - 1) / (crossings.at(-1) - crossings[0]);
}

test('trimming the source of a loop retains its audible playback rate', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'loop-trim-note.wav', frequency: 1000,
		duration: 0.8, channelCount: 1 });
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	await clip.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
	const before = frequency(await exportSamples(page, editor));
	expect(Math.abs(before - 1000)).toBeLessThan(0.1);
	const panel = await openClipProperties(page, editor, clip);
	await panel.getByRole('button', { name: 'Trim source start', exact: true }).press('Shift+ArrowRight');
	await closeClipProperties(panel);
	const after = frequency(await exportSamples(page, editor));
	expect(Math.abs(after - before)).toBeLessThan(0.1);
});
