/* SPDX-License-Identifier: AGPL-3.0-only */

import { AxeBuilder, expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	dockWorkspacePanel,
	waitForEditor,
} from './audio-editor-test-helpers.js';

const PANEL_IDS = ['project-bin', 'video-preview', 'source-monitor'];

test('Framescaper monitors start at 16:9 and the top separator resizes and persists the row', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const dock = editor.locator('[data-video-workspace] [data-panel-dock="top"]');
	await expect(dock).toHaveAttribute('data-workspace-auto-size', 'true');
	const preview = editor.locator('[data-video-preview]');
	const sourcePicture = editor.locator('.kw-audio-editor__source-monitor-picture');
	for (const monitor of [preview, sourcePicture]) {
		await expect(monitor).toBeVisible();
		await expect.poll(async () => {
			const bounds = await requiredBounds(monitor);
			return bounds.width / bounds.height;
		}).toBeCloseTo(16 / 9, 1);
		expect((await requiredBounds(monitor)).height).toBeGreaterThan(200);
	}
	const emptyMonitorContrast = await new AxeBuilder({ page })
		.include('[data-source-monitor="empty"]')
		.withRules(['color-contrast']).analyze();
	expect(emptyMonitorContrast.violations).toEqual([]);
	const initial = await requiredBounds(dock);
	const separator = dock.locator('[data-workspace-dock-resize-handle="top"]');
	await separator.press('ArrowUp');
	await expect(dock).toHaveAttribute('data-workspace-auto-size', 'false');
	await expect.poll(async () => (await requiredBounds(dock)).height).toBeCloseTo(initial.height - 16, 0);
	const handle = await requiredBounds(separator);
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
	await page.mouse.down();
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 48, { steps: 5 });
	await page.mouse.up();
	const resized = await requiredBounds(dock);
	expect(resized.height).toBeGreaterThan(initial.height + 24);
	await page.reload();
	await waitForEditor(page);
	await expect(dock).toHaveAttribute('data-workspace-auto-size', 'false');
	expect((await requiredBounds(dock)).height).toBeCloseTo(resized.height, 0);
	await page.setViewportSize({ width: 1280, height: 1000 });
	expect((await requiredBounds(dock)).height).toBeCloseTo(resized.height, 0);
});

test('Project bin and both monitors can move among docks and float with keyboard movement', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1100 });
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	for (const panelId of PANEL_IDS) {
		for (const target of ['left', 'right', 'bottom', 'floating']) {
			await dockWorkspacePanel(editor, panelId, target);
			await expect(editor.locator(`[data-workspace-panel="${panelId}"]`)).toHaveCount(1);
		}
		const floating = editor.locator(`[data-panel-dock="floating"] [data-workspace-panel="${panelId}"]`);
		const before = await requiredBounds(floating);
		await floating.locator(`[data-workspace-panel-drag-handle="${panelId}"]`).press('ArrowRight');
		await expect.poll(async () => (await requiredBounds(floating)).x).toBeCloseTo(before.x + 16, 0);
		await dockWorkspacePanel(editor, panelId, 'top');
	}
	await page.reload();
	await waitForEditor(page);
	for (const panelId of PANEL_IDS) {
		await expect(editor.locator(`[data-panel-dock="top"] [data-workspace-panel="${panelId}"]`)).toBeVisible();
	}
});

test('the top monitors reorder by keyboard and group into movable tabs by dragging', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const dock = editor.locator('[data-video-workspace] [data-panel-dock="top"]');
	const preview = editor.locator('[data-workspace-panel="video-preview"]');
	const source = editor.locator('[data-workspace-panel="source-monitor"]');
	await preview.locator('[data-workspace-panel-drag-handle="video-preview"]').press('ArrowRight');
	await expect.poll(() => dock.locator('[data-workspace-panel]').evaluateAll((panels) => (
		panels.map((panel) => panel.dataset.workspacePanel)
	))).toEqual(['project-bin', 'source-monitor', 'video-preview']);
	const transfer = await page.evaluateHandle(() => new DataTransfer());
	const target = await requiredBounds(preview);
	const grip = source.locator('[data-workspace-panel-drag-handle="source-monitor"]');
	await grip.dispatchEvent('dragstart', { dataTransfer: transfer });
	const coordinates = { dataTransfer: transfer, clientX: target.x + target.width / 2, clientY: target.y + target.height / 2 };
	await preview.dispatchEvent('dragover', coordinates);
	await preview.dispatchEvent('drop', coordinates);
	const monitors = editor.locator('[data-workspace-panel-members="video-preview source-monitor"]');
	await expect(monitors.getByRole('tab', { name: 'Source monitor', exact: true })).toHaveAttribute('aria-selected', 'true');
	await monitors.getByRole('tab', { name: 'Video preview', exact: true }).click();
	await expect(monitors.locator('[data-video-preview]')).toBeVisible();
	await expect(monitors.locator('[data-source-monitor]')).toBeHidden();
	await page.reload();
	await waitForEditor(page);
	const group = editor.locator('[data-workspace-panel-members="video-preview source-monitor"]');
	await expect(group.getByRole('tab', { name: 'Video preview', exact: true })).toHaveAttribute('aria-selected', 'true');
});

async function requiredBounds(locator) {
	const bounds = await locator.boundingBox();
	expect(bounds).not.toBeNull();
	return bounds;
}
