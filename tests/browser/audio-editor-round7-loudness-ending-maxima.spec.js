/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, readFile, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';

for (const duration of [.4, .45]) {
	test(`Analyze exports a complete momentary maximum for a normal ${duration}s Fade In`, async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createWavFixture({ name: 'crescendo.wav', sampleRate: 48_000,
			frequency: 1000, duration, channelCount: 1, channelAmplitudes: [.5] })]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Fading', 'Fade In']);
		await expect(editor.locator('[data-status]')).toHaveText('Applied the Audacity effect.');
		await chooseCommandAction(page, editor, 'Analyze', 'Analyze selection');
		const analysis = page.getByRole('dialog', { name: 'Analyze selection', exact: true });
		await expect(analysis.locator('[data-analysis-report="levels"]')).toBeVisible();
		const momentary = Number.parseFloat(await analysis.locator('[data-analysis-value="momentary"]').textContent());
		expect(momentary).toBeGreaterThan(-20);
		expect(momentary).toBeLessThan(-12);
		const downloadPromise = page.waitForEvent('download');
		await analysis.getByRole('button', { name: 'Export', exact: true }).click();
		const download = await downloadPromise;
		const { result } = JSON.parse(await readFile(await download.path(), 'utf8'));
		expect(result.frameCount).toBe(Math.round(duration * 48_000));
		expect(result.momentaryLufs).toBeCloseTo(momentary, 0);
		expect(result.maxMomentaryLufs).toBeGreaterThanOrEqual(result.momentaryLufs - 1e-9);
	});
}
