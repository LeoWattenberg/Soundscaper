/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

for (const opposite of [false, true]) test(`Parametric EQ spectra retain an ordinary ${opposite ? 'opposite' : 'matching'} polarity stereo recording`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'stereo-room-microphones.wav', duration: 10,
		frequency: 440, channelCount: 2, channelAmplitudes: [.5, .5] });
	for (let offset = 44; offset < recording.buffer.length; offset += 4) {
		recording.buffer.writeInt16LE(recording.buffer.readInt16LE(offset) * (opposite ? -1 : 1), offset + 2);
	}
	await importFiles(editor, [recording]);
	await chooseCommandAction(page, editor, 'Analyze', 'Analysis');
	const analysis = editor.locator('[data-workspace-panel="analysis"]');
	const effects = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, effects, 'track', 'Parametric EQ');
	await expect(page.getByRole('dialog', { name: 'Parametric EQ', exact: true })).toBeVisible();
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(async () => Number.parseFloat(await analysis.locator('[data-live-analysis-value="peak"]').textContent()))
		.toBeGreaterThan(-15);
	for (const side of ['input', 'output']) {
		const canvas = page.locator(`.audio-editor-parametric-eq__spectrum--${side}`);
		await expect.poll(() => canvas.evaluate(value => {
			const { width, height } = value;
			const pixels = value.getContext('2d').getImageData(0, 0, width, height).data;
			for (let y = 0; y < height; y++) {
				for (let x = 0; x < width; x++) if (pixels[(y * width + x) * 4 + 3] > 20) return y / height;
			}
			return 1;
		})).toBeLessThan(.35);
	}
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
