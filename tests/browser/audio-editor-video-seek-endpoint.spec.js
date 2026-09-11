/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { FIXTURE_PATH, HARNESS_ROOT, installHarnessRoutes } from './helpers/video-retime-preview-harness.js';

test('presents the last frame when its indexed interval extends beyond the media duration', async ({ page }) => {
	await installHarnessRoutes(page, { strictModules: true });
	await page.goto(`${HARNESS_ROOT}/index.html`);
	const result = await page.evaluate(async ({ fixturePath, root }) => {
		const { createVideoRetimeHtmlVideoSeekPort } = await import(`${root}/video-retime-html-video-seek-port.js`);
		const video = document.createElement('video');
		Object.assign(video, { muted: true, preload: 'auto' });
		document.body.append(video);
		try {
			await new Promise((resolve, reject) => {
				video.onloadeddata = resolve;
				video.onerror = () => reject(new Error('Fixture failed to load.'));
				video.src = fixturePath;
			});
			const port = createVideoRetimeHtmlVideoSeekPort(video, { assertCurrent: () => {} });
			const request = { drawableSourceFrame: 3, intervalStartSeconds: 0.2,
				intervalEndSeconds: 0.4, targetSeconds: 0.3, signal: new AbortController().signal };
			const frame = await port.present(request);
			const repeated = await port.present(request);
			const canvas = document.createElement('canvas');
			Object.assign(canvas, { width: video.videoWidth, height: video.videoHeight });
			const context = canvas.getContext('2d');
			context.drawImage(video, 0, 0);
			const pixel = Array.from(context.getImageData(32, 16, 1, 1).data);
			let outsideError = null;
			try {
				await port.present({ ...request, intervalStartSeconds: video.duration,
					intervalEndSeconds: video.duration + 0.1, targetSeconds: video.duration + 0.05 });
			} catch (error) { outsideError = error.message; }
			return { frame, repeated, pixel, outsideError, clock: video.currentTime, duration: video.duration };
		} finally { video.removeAttribute('src'); video.load(); video.remove(); }
	}, { fixturePath: FIXTURE_PATH, root: HARNESS_ROOT });
	expect(result.frame.mediaTime).toBeGreaterThanOrEqual(0.2);
	expect(result.frame.mediaTime).toBeLessThan(result.duration);
	// The final frame is yellow; preceding frames are red, green, and blue.
	expect(result.pixel[0]).toBeGreaterThan(200);
	expect(result.pixel[1]).toBeGreaterThan(200);
	expect(result.pixel[2]).toBeLessThan(50);
	expect(result.repeated).toEqual(result.frame);
	expect(result.clock).toBeGreaterThanOrEqual(0.2);
	expect(result.clock).toBeLessThan(result.duration);
	expect(result.outsideError).toMatch(/media duration/);
});
