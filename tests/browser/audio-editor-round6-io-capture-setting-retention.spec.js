/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { expectCapturePhase, openRecordingSetup, selectSourceRoles } from './helpers/framescaper-capture-harness.js';

const nativeCameraTest = test.extend({
	launchOptions: [async ({ browserName }, use) => {
		await use(browserName === 'chromium' ? {
			args: ['--use-fake-device-for-media-stream=fps=60', '--use-fake-ui-for-media-stream'],
		} : browserName === 'firefox' ? { firefoxUserPrefs: {
			'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true,
		} } : {});
	}, { scope: 'worker' }],
});

nativeCameraTest('Recording setup retains its selected camera frame rate when changing resolution', async ({ page, browserName }) => {
	await page.addInitScript(() => {
		const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
		Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async constraints => {
			const stream = await nativeGetUserMedia(constraints);
			window.__nativeCameraTrack = stream.getVideoTracks()[0];
			return stream;
		} });
	});
	const editor = await bootEditor(page, '/framescaper/en/');
	const panel = await openRecordingSetup(page, editor);
	if (!await page.evaluate(() => typeof navigator.mediaDevices?.getDisplayMedia === 'function'
		&& typeof globalThis.MediaRecorder === 'function')) {
		await expect(panel.getByRole('status')).toContainText('Capture is unavailable in this runtime');
		await expect(panel.getByRole('button', { name: 'Preview sources', exact: true })).toHaveCount(0);
		return;
	}
	await selectSourceRoles(panel, ['camera']);
	await panel.getByRole('button', { name: 'Preview sources', exact: true }).click();
	await expectCapturePhase(panel, 'previewing');
	const source = panel.locator('[data-capture-source-role="camera"]');
	const frameRate = source.getByRole('combobox', { name: 'Frame rate', exact: true });
	if (browserName === 'firefox') {
		// This native Firefox test camera retains its default format.
		await expect(frameRate).toHaveValue('30');
		expect(await page.evaluate(() => window.__nativeCameraTrack.getSettings().frameRate)).toBe(30);
	} else {
		await frameRate.selectOption('24');
		await expect(frameRate).toHaveValue('24');
		expect(await page.evaluate(() => window.__nativeCameraTrack.getSettings().frameRate)).toBe(24);
		await source.getByRole('combobox', { name: 'Resolution', exact: true }).selectOption('1280x720');
		await expect(source.getByRole('combobox', { name: 'Resolution', exact: true })).toHaveValue('1280x720');
		await expect(frameRate).toHaveValue('24');
		const settings = await page.evaluate(() => window.__nativeCameraTrack.getSettings());
		expect(settings.width).toBe(1280);
		expect(settings.height).toBe(720);
		expect(settings.frameRate).toBe(24);
	}
	await panel.getByRole('button', { name: 'Release sources', exact: true }).click();
	await expectCapturePhase(panel, 'inactive');
});
