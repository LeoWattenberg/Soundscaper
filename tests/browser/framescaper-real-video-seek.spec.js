/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { closeWorkspacePanel } from './helpers/workspace-panel-chrome.js';

test.use({ browserCoverage: false });

test('measures arbitrary paused seeks and filmstrip presentation with an external real video', async ({ page }) => {
	test.skip(!process.env.FRAMESCAPER_REAL_VIDEO, 'Set FRAMESCAPER_REAL_VIDEO to a local MP4 file.');
	test.setTimeout(360_000);
	await page.setViewportSize({ width: 1_440, height: 1_000 });
	await page.goto(resolveBrowserProductTestUrl('/framescaper/en/'));
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
	const decline = page.getByRole('button', { name: 'Decline', exact: true });
	if (await decline.isVisible()) await decline.click();
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption('video-editor');
	if (await editor.locator('[data-workspace-panel="project-bin"]').isVisible()) {
		await closeWorkspacePanel(editor, 'project-bin');
	}
	await editor.locator('[data-import-input]').setInputFiles(process.env.FRAMESCAPER_REAL_VIDEO);
	await expect(editor.locator('[data-video-track]')).toHaveCount(1, { timeout: 300_000 });
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 300_000 });
	const preview = editor.locator('[data-video-preview]');
	await expect(preview).toHaveAttribute('data-video-preview-renderer', 'ready', { timeout: 30_000 });
	await expect(preview).toHaveAttribute('data-video-preview-visual-pending', 'false', { timeout: 30_000 });
	await expect(preview).toHaveAttribute('data-video-preview-visual-error', '');
	await expect(editor.locator('[data-product-visual-thumbnail-canvas]').first()).toBeVisible({ timeout: 30_000 });
	await editor.locator('[data-ruler]').click({ button: 'right', position: { x: 80, y: 20 } });
	await page.getByRole('menuitem', { name: 'Click ruler to start playback', exact: true }).click();
	const measurements = [];
	for (const fraction of [0.15, 0.7, 0.35, 0.9, 0.2, 0.65]) {
		const ruler = editor.locator('[data-ruler]');
		await ruler.evaluate((ruler) => {
			const previewElement = document.querySelector('[data-video-preview]');
			const playhead = document.querySelector('[data-playhead]');
			const originalSample = playhead.getAttribute('aria-valuenow');
			let start = performance.now();
			ruler.addEventListener('pointerdown', () => { start = performance.now(); }, { once: true });
			globalThis.__framescaperSeekFinished = new Promise((resolve, reject) => {
				const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Seek did not publish.')); }, 15_000);
				const observer = new MutationObserver(() => {
					const targetSample = playhead.getAttribute('aria-valuenow');
					if (targetSample === originalSample || previewElement.dataset.videoPreviewEvaluatedTimelineSample !== targetSample) return;
					observer.disconnect();
					clearTimeout(timeout);
					resolve(performance.now() - start);
				});
				observer.observe(previewElement, { attributes: true, attributeFilter: ['data-video-preview-evaluated-timeline-sample'] });
			});
		});
		const bounds = await ruler.boundingBox();
		await ruler.click({ position: { x: bounds.width * fraction, y: bounds.height - 4 } });
		measurements.push(await page.evaluate(() => globalThis.__framescaperSeekFinished));
	}
	const median = [...measurements].sort((a, b) => a - b)[3];
	console.log(`FRAMESCAPER_REAL_VIDEO_SEEK ${JSON.stringify({ milliseconds: measurements, median })}`);
	expect(median).toBeLessThan(Number(process.env.FRAMESCAPER_REAL_VIDEO_SEEK_LIMIT_MS || 1_000));
	await expect(preview).toHaveAttribute('data-video-preview-visual-error', '');
	console.log(`FRAMESCAPER_REAL_VIDEO_FILMSTRIP ${JSON.stringify(await editor.locator('.audio-editor-video-clip__thumbnail').evaluateAll((cells) => cells.map((cell) => ({ state: cell.dataset.productVisualThumbnailState, canvas: Boolean(cell.querySelector('canvas')), image: Boolean(cell.querySelector('img')) }))))}`);
	await expect(editor.locator('[data-product-visual-thumbnail-canvas]').first()).toBeVisible({ timeout: 30_000 });
	expect(await editor.locator('[data-product-visual-thumbnail-canvas]').evaluateAll((canvases) => canvases.some((canvas) => {
		const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
		for (let offset = 0; offset < pixels.length; offset += 4) {
			if (pixels[offset] > 32 || pixels[offset + 1] > 32 || pixels[offset + 2] > 32) return true;
		}
		return false;
	}))).toBe(true);
});
