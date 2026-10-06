/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, dockWorkspacePanel } from './audio-editor-test-helpers.js';

test('Escape cancels a floating workspace panel move before pointer release', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Window', 'Markers');
	await dockWorkspacePanel(editor, 'markers', 'floating');
	const panel = editor.locator('[data-workspace-panel="markers"]');
	const before = await panel.boundingBox();
	const savedX = await panel.getAttribute('data-workspace-panel-x');
	const savedY = await panel.getAttribute('data-workspace-panel-y');
	const handle = await panel.locator('[data-floating-panel-move-handle="markers"]').boundingBox();
	expect(before).not.toBeNull(); expect(handle).not.toBeNull();
	const x = handle.x + handle.width / 2; const y = handle.y + handle.height / 2;
	await page.mouse.move(x, y); await page.mouse.down();
	await page.mouse.move(x + 80, y + 40, { steps: 4 });
	await expect(panel).toHaveClass(/workspace-panel--moving/u);
	await page.keyboard.press('Escape');
	await page.mouse.up();
	await expect.poll(async () => (await panel.boundingBox())?.x).toBeCloseTo(before.x, 0);
	await expect.poll(async () => (await panel.boundingBox())?.y).toBeCloseTo(before.y, 0);
	await expect(panel).not.toHaveClass(/workspace-panel--moving/u);
	await expect(panel).toHaveAttribute('data-workspace-panel-x', savedX);
	await expect(panel).toHaveAttribute('data-workspace-panel-y', savedY);
});
