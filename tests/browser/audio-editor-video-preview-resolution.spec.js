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
} from './audio-editor-test-helpers.js';
import { videoRetimePreviewMedia } from './fixtures/video-retime-preview-media.js';

registerAudioEditorHooks();

test('View preview resolution reduces pixels, preserves panel geometry and restores the saved choice', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	await importFiles(editor, [videoRetimePreviewMedia.file]);
	const preview = editor.locator('[data-video-preview]');
	const canvas = preview.locator('[data-video-preview-canvas]');
	await expect(canvas).toBeVisible();
	await expect.poll(() => canvas.evaluate((element) => element.width)).toBeGreaterThan(100);
	const dimensions = () => canvas.evaluate((element) => ({ width: element.width, height: element.height }));
	const full = await dimensions();
	const bounds = await canvas.boundingBox();
	const menu = async () => openNestedCommandMenu(page, editor, 'View', ['Video preview resolution']);
	await expect(getMenuItem(await menu(), 'Full resolution')).toHaveAttribute('aria-checked', 'true');
	await page.keyboard.press('Escape');
	await chooseNestedCommandAction(page, editor, 'View', ['Video preview resolution', 'Half resolution']);
	await expect.poll(dimensions).toEqual({
		width: Math.max(1, Math.round(full.width / 2)), height: Math.max(1, Math.round(full.height / 2)),
	});
	expect(await canvas.boundingBox()).toEqual(bounds);
	await expect(getMenuItem(await menu(), 'Half resolution')).toHaveAttribute('aria-checked', 'true');
	await page.keyboard.press('Escape');
	await chooseNestedCommandAction(page, editor, 'View', ['Video preview resolution', 'Quarter resolution']);
	await expect.poll(dimensions).toEqual({
		width: Math.max(1, Math.round(full.width / 4)), height: Math.max(1, Math.round(full.height / 4)),
	});
	await page.reload();
	await waitForEditor(page);
	await expect(getMenuItem(await menu(), 'Quarter resolution')).toHaveAttribute('aria-checked', 'true');
	await page.keyboard.press('Escape');
	await chooseNestedCommandAction(page, editor, 'View', ['Video preview resolution', 'Full resolution']);
	await expect.poll(dimensions).toEqual(full);
	expect(errors).toEqual([]);
});
