/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseNestedCommandAction,
	collectClientErrors,
	getMenuItem,
	importFiles,
	openNestedCommandMenu,
	registerAudioEditorHooks,
	waitForEditor,
	waitForProjectActivation,
} from './audio-editor-test-helpers.js';
import { videoRetimePreviewMedia } from './fixtures/video-retime-preview-media.js';

registerAudioEditorHooks();

for (const unavailableWebGl of [false, true]) {
	test(`View preview resolution preserves panel geometry and restores the saved choice${unavailableWebGl ? ' without WebGL2' : ' while reducing rendered pixels'}`, async ({ page }) => {
		if (unavailableWebGl) await page.addInitScript(() => {
			const originalGetContext = HTMLCanvasElement.prototype.getContext;
			HTMLCanvasElement.prototype.getContext = function getContext(type, ...args) {
				if (type === 'webgl2' && this.hasAttribute('data-video-preview-canvas')) return null;
				return originalGetContext.call(this, type, ...args);
			};
		});
		const errors = collectClientErrors(page);
		const webGlAvailable = await page.evaluate(() => {
			const context = document.createElement('canvas').getContext('webgl2', {
				alpha: true, antialias: false, depth: false, preserveDrawingBuffer: false,
				premultipliedAlpha: false, stencil: false,
			});
			context?.getExtension('WEBGL_lose_context')?.loseContext();
			return Boolean(context);
		});
		const renderer = unavailableWebGl || !webGlAvailable ? 'fallback' : 'ready';
		const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
		await importFiles(editor, [videoRetimePreviewMedia.file]);
		const preview = editor.locator('[data-video-preview]');
		const canvas = preview.locator('[data-video-preview-canvas]');
		await expect(canvas).toBeVisible();
		await expect(preview).toHaveAttribute('data-video-preview-renderer', renderer);
		const dimensions = () => canvas.evaluate((element) => ({ width: element.width, height: element.height }));
		const full = await dimensions();
		const bounds = await canvas.boundingBox();
		const expectResolution = async (divisor) => {
			if (renderer === 'fallback') {
				await expect(preview.locator('[data-video-preview-renderer-warning]'))
					.toContainText('Video transforms and compositing cannot be rendered right now.');
				await expect(canvas).toHaveCSS('opacity', '0');
			} else {
				await expect.poll(dimensions).toEqual({
					width: Math.max(1, Math.round(full.width / divisor)),
					height: Math.max(1, Math.round(full.height / divisor)),
				});
			}
			expect(await canvas.boundingBox()).toEqual(bounds);
		};
		await expectResolution(1);
		const menu = async () => openNestedCommandMenu(page, editor, 'View', ['Video preview resolution']);
		await expect(getMenuItem(await menu(), 'Full resolution')).toHaveAttribute('aria-checked', 'true');
		await page.keyboard.press('Escape');
		await chooseNestedCommandAction(page, editor, 'View', ['Video preview resolution', 'Half resolution']);
		await expectResolution(2);
		await expect(getMenuItem(await menu(), 'Half resolution')).toHaveAttribute('aria-checked', 'true');
		await page.keyboard.press('Escape');
		await chooseNestedCommandAction(page, editor, 'View', ['Video preview resolution', 'Quarter resolution']);
		await expectResolution(4);
		const projectId = await editor.getAttribute('data-project-id');
		const clipCount = await editor.getAttribute('data-clip-count');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 30_000 });
		await page.reload();
		await waitForEditor(page);
		await waitForProjectActivation(editor);
		await expect(editor).toHaveAttribute('data-project-id', projectId);
		await expect(editor).toHaveAttribute('data-clip-count', clipCount);
		await expect(preview).toHaveAttribute('data-video-preview-renderer', renderer);
		await expect(getMenuItem(await menu(), 'Quarter resolution')).toHaveAttribute('aria-checked', 'true');
		await page.keyboard.press('Escape');
		await expectResolution(4);
		await chooseNestedCommandAction(page, editor, 'View', ['Video preview resolution', 'Full resolution']);
		await expectResolution(1);
		expect(errors).toEqual([]);
	});
}
