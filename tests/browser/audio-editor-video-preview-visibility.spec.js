/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseNestedCommandAction,
	getMenuItem,
	importFiles,
	openNestedCommandMenu,
} from './audio-editor-test-helpers.js';
import { closeWorkspacePanel } from './helpers/workspace-panel-chrome.js';
import { videoRetimePreviewMedia } from './fixtures/video-retime-preview-media.js';

test('video preview opens on import and panel Close updates the View menu eye', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	const panel = editor.locator('[data-workspace-panel="video-preview"]');
	const preview = panel.locator('[data-video-preview]');
	const menuItem = async (label = 'Video preview') => getMenuItem(
		await openNestedCommandMenu(page, editor, 'View', ['Panels']), label,
	);
	const eye = (item) => item.locator(':scope > .context-menu-item-content .context-menu-item-icon .musescore-icon');

	await expect(panel).toHaveCount(0);
	let item = await menuItem();
	await expect(item).toHaveAttribute('aria-checked', 'false');
	await expect(eye(item)).toHaveText('\uEF54');
	await page.keyboard.press('Escape');

	await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Video preview']);
	await expect(preview).toBeVisible();
	await expect(preview).toHaveCSS('background-color', 'rgb(0, 0, 0)');
	await expect(preview.locator('.kw-audio-editor__video-preview-empty')).toHaveText('No video');
	item = await menuItem();
	await expect(item).toHaveAttribute('aria-checked', 'true');
	await expect(eye(item)).toHaveText('\uEF53');
	await page.keyboard.press('Escape');

	await closeWorkspacePanel(editor, 'video-preview');
	item = await menuItem();
	await expect(item).toHaveAttribute('aria-checked', 'false');
	await expect(eye(item)).toHaveText('\uEF54');
	await page.keyboard.press('Escape');
	await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'History']);
	await expect(editor.locator('[data-workspace-panel="history"]')).toBeVisible();
	await closeWorkspacePanel(editor, 'history');
	item = await menuItem('History');
	await expect(item).toHaveAttribute('aria-checked', 'false');
	await expect(eye(item)).toHaveText('\uEF54');
	await page.keyboard.press('Escape');

	await importFiles(editor, [videoRetimePreviewMedia.file]);
	await expect(editor.locator('[data-clip-kind="video"]')).toHaveCount(1);
	await expect(preview).toBeVisible();
	item = await menuItem();
	await expect(item).toHaveAttribute('aria-checked', 'true');
	await expect(eye(item)).toHaveText('\uEF53');
	await page.keyboard.press('Escape');

	await closeWorkspacePanel(editor, 'video-preview');
	await expect(panel).toHaveCount(0);
	item = await menuItem();
	await expect(item).toHaveAttribute('aria-checked', 'false');
	await expect(eye(item)).toHaveText('\uEF54');
});
