/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { seekFramescaperTimecode } from './helpers/framescaper-standard-timecode.js';

test('Match frame displays the program frame while its source monitor was playing', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	const file = videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1').file;
	await editor.locator('[data-project-bin-input]').setInputFiles([file]);
	await editor.getByRole('button', { name: 'Add to timeline: timing-probe-cfr-25fps', exact: true }).click();
	await editor.getByRole('group', { name: /^Video clip:/u }).first().press('Enter');
	await seekFramescaperTimecode(page, editor, '00:00:00:06');
	await editor.getByRole('button', { name: 'Open in source monitor: timing-probe-cfr-25fps', exact: true }).click();
	const monitor = editor.locator('[data-source-monitor]').filter({ has: page.locator('[data-source-monitor-video]') });
	const video = monitor.locator('video');
	await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2);
	await monitor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => video.evaluate(element => element.currentTime), { intervals: [20] }).toBeGreaterThan(0.1);
	await expect(monitor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await monitor.getByRole('button', { name: 'Match frame', exact: true }).click();
	await expect(monitor.getByRole('button', { name: 'Play', exact: true })).toBeVisible({ timeout: 200 });
	await expect.poll(() => video.evaluate(element => ({ paused: element.paused,
		matched: Math.abs(element.currentTime - 0.2) < 0.08 }))).toEqual({ paused: true, matched: true });
});
