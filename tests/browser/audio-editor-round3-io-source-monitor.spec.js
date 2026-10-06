/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';

const recording = videoTimingProbeMedia.find(({ id }) => id === 'vfr-irregular-webm-v1');

test('Source monitor frame steps show the actual frame of a normal variable-rate recording', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles(recording.file);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
	const card = editor.getByRole('listitem', { name: 'Project bin: timing-probe-vfr-irregular', exact: true });
	await card.getByRole('button', { name: /Open in source monitor/u }).click();
	const monitor = editor.locator('[data-source-monitor]');
	await expect(monitor).toBeVisible();
	await monitor.getByRole('button', { name: 'Next frame', exact: true }).click();
	await monitor.getByRole('button', { name: 'Next frame', exact: true }).click();
	await expect(monitor).toHaveAttribute('data-source-monitor-frame', '2');
	const seekTime = await monitor.locator('video').evaluate((media) => media.currentTime);
	// Frame 2 is presented from 200ms to 245ms. Seeking beyond it shows frame 3.
	expect(seekTime).toBeGreaterThanOrEqual(0.2);
	expect(seekTime).toBeLessThan(0.245);
	await monitor.getByRole('button', { name: 'Mark in', exact: true }).click();
	await expect(monitor).toHaveAttribute('data-source-monitor-mark-in', '2');
});
