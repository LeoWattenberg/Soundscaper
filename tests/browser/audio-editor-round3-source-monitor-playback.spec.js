/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';

test('marking during source playback captures the displayed frame instead of its old stopped position', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	const file = videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1').file;
	const choosing = page.waitForEvent('filechooser');
	await editor.locator('[data-project-bin-import]').getByRole('button').first().click();
	await (await choosing).setFiles(file);
	await expect(editor.locator('[data-bin-action="source-monitor"]').first()).toBeVisible({ timeout: 30_000 });
	await editor.locator('[data-bin-action="source-monitor"]').first().click();
	const monitor = editor.locator('[data-source-monitor]').filter({ has: page.locator('[data-source-monitor-video]') });
	const video = monitor.locator('video');
	await expect.poll(() => video.evaluate((element) => element.readyState)).toBeGreaterThanOrEqual(2);
	await expect(monitor).toHaveAttribute('data-source-monitor-frame', '0');
	await monitor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeGreaterThan(0.25);
	await monitor.getByRole('button', { name: 'Mark in', exact: true }).click();
	await expect.poll(async () => Number(await monitor.getAttribute('data-source-monitor-mark-in'))).toBeGreaterThan(0);
});
