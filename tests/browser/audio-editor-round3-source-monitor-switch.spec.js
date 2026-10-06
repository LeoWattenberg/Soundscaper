/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';

test('opening another source stops the previous playback session and shows its new stopped playhead', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	const choosing = page.waitForEvent('filechooser');
	await editor.locator('[data-project-bin-import]').getByRole('button').first().click();
	await (await choosing).setFiles(videoTimingProbeMedia.map(({ file }) => file));
	const openButtons = editor.locator('[data-bin-action="source-monitor"]');
	await expect(openButtons).toHaveCount(2, { timeout: 30_000 });
	await openButtons.first().click();
	const monitor = editor.locator('[data-source-monitor]').filter({ has: page.locator('[data-source-monitor-video]') });
	const firstSource = await monitor.getAttribute('data-source-monitor');
	const video = monitor.locator('video');
	await expect.poll(() => video.evaluate((element) => element.readyState)).toBeGreaterThanOrEqual(2);
	await monitor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeGreaterThan(0.1);
	await openButtons.last().click();
	await expect(monitor).not.toHaveAttribute('data-source-monitor', firstSource);
	await expect(monitor.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	await expect.poll(() => video.evaluate((element) => element.paused)).toBe(true);
	await expect(monitor).toHaveAttribute('data-source-monitor-frame', '0');
});
