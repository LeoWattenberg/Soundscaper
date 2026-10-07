/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

const recording = createWavFixture({ name: 'opposite-phase-stereo.wav', frequency: 440, duration: 6, channelCount: 2 });
for (let offset = 44; offset < recording.buffer.length; offset += 4) {
	recording.buffer.writeInt16LE(-recording.buffer.readInt16LE(offset), offset + 2);
}

test('live Spectrum retains a stereo recording with opposite channel polarity', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [recording]);
	await chooseCommandAction(page, editor, 'Analyze', 'Analysis');
	const panel = editor.locator('[data-workspace-panel="analysis"]');
	await panel.locator('[data-analysis-section="spectrum"] summary').click();
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(async () => Number.parseFloat(await panel.locator('[data-live-analysis-value="peak"]').textContent()))
		.toBeGreaterThan(-15);
	const spectrum = panel.locator('[data-live-analysis-spectrum]');
	await expect.poll(() => spectrum.evaluate(canvas => {
		const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, Math.floor(canvas.height * 0.75));
		let signalPixels = 0;
		for (let offset = 0; offset < data.length; offset += 4) {
			if (data[offset] < 150 && data[offset + 1] > 120 && data[offset + 2] > 100) signalPixels++;
		}
		return signalPixels;
	})).toBeGreaterThan(4);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
