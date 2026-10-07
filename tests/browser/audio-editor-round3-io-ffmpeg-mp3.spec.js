/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('an ordinary FFmpeg MP3 import preserves the recording length instead of its encoder padding', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const bytes = Buffer.from(readFileSync(new URL('../fixtures/ffmpeg-libmp3lame-one-second.mp3.base64', import.meta.url), 'utf8'), 'base64');
	await importFiles(editor, [{ name: 'one-second-ffmpeg.mp3', mimeType: 'audio/mpeg', buffer: bytes }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const samples = await exportSamples(page, editor);
	expect(samples.length).toBe(48_000);
	const earlyRms = Math.sqrt(samples.slice(480, 960).reduce((sum, value) => sum + value ** 2, 0) / 480);
	// FFmpeg's decoded reference RMS is 0.0836277027 before centered mono's
	// equal-power pan. The original encoder delay must not replace this tone.
	expect(earlyRms).toBeCloseTo(0.0836277027 / Math.SQRT2, 4);
});
