/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, longTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

async function visibleSignal(canvas) {
	return await canvas.evaluate(element => {
		const { data } = element.getContext('2d').getImageData(0, 0, element.width, element.height);
		let pixels = 0;
		for (let offset = 0; offset < data.length; offset += 4) {
			if (data[offset] + data[offset + 1] + data[offset + 2] > 200 && data[offset + 3] > 0) pixels++;
		}
		return pixels;
	});
}

test('live Spectrogram starts an empty history when switching to a new project', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [longTone]);
	await chooseCommandAction(page, editor, 'Analyze', 'Analysis');
	const panel = editor.locator('[data-workspace-panel="analysis"]');
	await panel.locator('[data-analysis-section="spectrogram"] summary').click();
	const spectrogram = panel.locator('[data-live-analysis-spectrogram]');
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => visibleSignal(spectrogram)).toBeGreaterThan(50);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await editor.getByRole('button', { name: 'New project', exact: true }).click();
	await expect(editor.locator('[data-audio-clip]')).toHaveCount(0);
	await expect(spectrogram).toBeVisible();
	await expect.poll(() => visibleSignal(spectrogram)).toBe(0);
});
