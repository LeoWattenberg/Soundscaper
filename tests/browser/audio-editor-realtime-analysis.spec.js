/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	collectClientErrors,
	importFiles,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('realtime Analysis panel', () => {
	registerAudioEditorHooks();

	test('keeps collapsible analyzers responsive during stereo playback', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createWavFixture({
			name: 'live-analysis-stereo.wav', frequency: 440, duration: 5, channelCount: 2,
		})]);
		await chooseCommandAction(page, editor, 'Analyze', 'Analysis');
		const panel = editor.locator('[data-workspace-panel="analysis"]');
		await expect(panel.locator('[data-analysis-section]')).toHaveCount(5);
		for (const id of ['loudness', 'spectrum', 'spectrogram', 'correlation']) {
			await panel.locator(`[data-analysis-section="${id}"] summary`).click();
		}
		await expect(panel.locator('[data-live-analysis-spectrum]')).toBeVisible();
		await expect(panel.locator('[data-live-analysis-spectrogram]')).toBeVisible();
		await expect(panel.locator('[data-analysis-jellyfish]')).toBeVisible();

		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await expect(panel.locator('[data-analysis-value="correlation"]'))
			.not.toHaveText('—', { timeout: 10_000 });
		await expect.poll(async () => Number(await panel.locator('[data-analysis-value="correlation"]').textContent()))
			.toBeGreaterThan(0.2);
		await expect.poll(async () => Number(await panel.locator('[data-analysis-value="correlation"]').textContent()))
			.toBeLessThan(0.8);
		await page.waitForTimeout(300);
		const blockingTime = await page.evaluate(async () => {
			const durations = [];
			const observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) durations.push(entry.duration);
			});
			observer.observe({ type: 'longtask', buffered: false });
			await new Promise((resolve) => setTimeout(resolve, 500));
			for (const entry of observer.takeRecords()) durations.push(entry.duration);
			observer.disconnect();
			return durations.reduce((total, duration) => total + Math.max(0, duration - 50), 0);
		});
		expect(blockingTime).toBeLessThan(50);
		await panel.locator('[data-analysis-section="spectrogram"] summary').click();
		await expect(panel.locator('[data-live-analysis-spectrogram]')).toHaveCount(0);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		expect(errors).toEqual([]);
	});
});
