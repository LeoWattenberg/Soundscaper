/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';
import { FIXTURE_PATH, HARNESS_ROOT, installHarnessRoutes } from './helpers/video-retime-preview-harness.js';

for (const left of ['0px', '-10000px']) {
	test(`paused WebM seeks with video positioned at ${left}`, async ({ page }) => {
		await installHarnessRoutes(page, { strictModules: true });
		await page.route(`**${FIXTURE_PATH}`, (route) => route.fulfill({
			contentType: 'video/webm', body: createDeterministicSilentVideoFixture('seek.webm').buffer,
		}));
		await page.goto(`${HARNESS_ROOT}/index.html`);
		const result = await page.evaluate(async ({ root, fixturePath, left }) => {
			const { createVideoRetimeHtmlVideoSeekPort } = await import(`${root}/video-retime-html-video-seek-port.js`);
			const mediaUrl = URL.createObjectURL(await (await fetch(fixturePath)).blob());
			const video = document.createElement('video');
			Object.assign(video, { muted: true, playsInline: true, preload: 'auto' });
			Object.assign(video.style, { position: 'fixed', left, top: '0px', width: '1px', height: '1px' });
			document.body.append(video);
			try {
				await new Promise((resolve, reject) => {
					video.onloadeddata = resolve;
					video.onerror = () => reject(new Error('Fixture failed.'));
					video.src = mediaUrl;
				});
				const port = createVideoRetimeHtmlVideoSeekPort(video, { assertCurrent: () => {}, timeoutMs: 5000 });
				await port.present({ drawableSourceFrame: 0, intervalStartSeconds: 0,
					intervalEndSeconds: 0.065, targetSeconds: 0.03, signal: new AbortController().signal });
				const request = { drawableSourceFrame: 1, intervalStartSeconds: 0.065,
					intervalEndSeconds: 0.195, targetSeconds: 0.13, signal: new AbortController().signal };
				const frame = await port.present(request);
				return { frame, repeated: await port.present(request) };
			} finally { video.removeAttribute('src'); video.load(); video.remove(); URL.revokeObjectURL(mediaUrl); }
		}, { root: HARNESS_ROOT, fixturePath: FIXTURE_PATH, left });
		expect(result.frame.mediaTime).toBeGreaterThanOrEqual(0.065);
		expect(result.frame.mediaTime).toBeLessThan(0.195);
		expect(result.repeated).toEqual(result.frame);
	});
}
