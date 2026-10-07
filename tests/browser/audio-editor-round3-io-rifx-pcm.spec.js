/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { libsndfileRifxTone } from '../helpers/libsndfile-rifx-fixture.ts';

test('ordinary libsndfile big-endian WAV imports and renders its normal samples', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'soundscaper-r3-rifx.wav', mimeType: 'audio/wav', buffer: Buffer.from(libsndfileRifxTone()) }]);
	await expect(clipByName(editor, 'soundscaper-r3-rifx.wav')).toBeVisible();
	const samples = await exportSamples(page, editor);
	expect(samples.length).toBe(48_000);
	const window = samples.slice(4_800, 14_400);
	expect(Math.sqrt(window.reduce((sum, value) => sum + value ** 2, 0) / window.length)).toBeCloseTo(0.125, 3);
});
