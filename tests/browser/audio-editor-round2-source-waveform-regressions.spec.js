/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, closeClipProperties, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

async function paintedSamples(canvas) {
	return canvas.evaluate(element => {
		const { width, height } = element;
		const pixels = element.getContext('2d').getImageData(0, 0, width, height).data;
		let count = 0;
		for (let y = 0; y < height; y += 1) {
			if (Math.abs(y - height / 2) <= 5) continue;
			for (let x = 0; x < width; x += 1) if (pixels[(y * width + x) * 4 + 3]) count += 1;
		}
		return count;
	});
}

test('unused source waveform stays at native speed when the active clip is looped', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	// An ordinary recording with 50 ms of silence before the sound begins.
	const recording = createWavFixture({ name: 'silence-then-note.wav', frequency: 220,
		duration: 0.8, channelCount: 1 });
	recording.buffer.fill(0, 44, 44 + 2400 * 2);
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	let panel = await openClipProperties(page, editor, clip);
	await panel.getByRole('button', { name: 'Trim source start', exact: true }).press('Shift+ArrowRight');
	const unused = () => panel.locator('[data-source-active="false"] canvas');
	await expect(unused()).toHaveCount(1);
	await expect.poll(() => paintedSamples(unused())).toBeGreaterThan(25);
	await closeClipProperties(panel);
	await clip.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
	panel = await openClipProperties(page, editor, clip);
	await expect(unused()).toHaveCount(1);
	await expect.poll(() => paintedSamples(unused())).toBeGreaterThan(25);
});
