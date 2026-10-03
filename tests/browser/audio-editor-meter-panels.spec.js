/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseNestedCommandAction,
	closeWorkspacePanel,
	dockWorkspacePanel,
	registerAudioEditorHooks,
	waitForEditor,
} from './audio-editor-test-helpers.js';

test.describe('dockable meter panels', () => {
	registerAudioEditorHooks();

	test('opens from meter settings, docks above and below the timeline, and restores the toolbar choice', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const panel = editor.locator('[data-workspace-panel="playback-meter"]');
		await expect(panel).toHaveCount(0);
		await expect(editor.locator('[data-workspace-panel="recording-meter"]')).toHaveCount(0);
		await editor.getByRole('button', { name: 'Playback meter settings', exact: true }).first().click();
		const settings = editor.getByRole('dialog', { name: 'Playback meter settings', exact: true });
		await settings.getByRole('radio', { name: 'Dockable panel', exact: true }).click();
		await page.keyboard.press('Escape');
		await expect(panel).toBeVisible();
		await expect(editor.locator('[data-meter-workspace-panel="playback"] [data-audio-meter]')).toHaveCount(1);
		await expect(editor.locator('[data-audio-meter][data-meter-kind="playback"]')).toHaveCount(1);
		for (const dock of ['top', 'bottom']) {
			await dockWorkspacePanel(editor, 'playback-meter', dock);
			const meter = panel.locator('[data-audio-meter]');
			await expect(meter).toHaveAttribute('data-meter-orientation', 'horizontal');
			const channels = await meter.locator('.kw-audio-editor__playback-meter-channels').boundingBox();
			const panelBounds = await panel.boundingBox();
			expect(channels.width).toBeGreaterThan(panelBounds.width * 0.9);
			expect(channels.height).toBeGreaterThan(40);
		}
		await closeWorkspacePanel(editor, 'playback-meter');
		await editor.getByRole('button', { name: 'Playback meter settings', exact: true }).first().click();
		await settings.getByRole('radio', { name: 'Top bar (horizontal)', exact: true }).click();
		await page.keyboard.press('Escape');
		await expect(editor.locator('[data-audio-meter][data-meter-kind="playback"][data-meter-position="top"]')).toBeVisible();
		await expect(panel).toHaveCount(0);
	});

	test('opens from View, widens the visible meter bars, and persists floating geometry', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseNestedCommandAction(page, editor, 'View', ['Workspace', 'Audacity']);
		await chooseNestedCommandAction(page, editor, 'Window', ['Recording meter']);
		const panel = editor.locator('[data-workspace-panel="recording-meter"]');
		await expect(panel).toBeVisible();
		const channels = panel.locator('.kw-audio-editor__playback-meter-channels');
		const initialBounds = await channels.boundingBox();
		const dockHandle = editor.locator('[data-workspace-dock-resize-handle="right"]');
		await dockHandle.focus();
		await dockHandle.press('Shift+ArrowLeft');
		await dockHandle.press('Shift+ArrowLeft');
		await expect.poll(async () => (await channels.boundingBox()).width).toBeGreaterThan(initialBounds.width + 70);
		const dockedBounds = await channels.boundingBox();
		const contentBounds = await panel.locator('[data-workspace-tab-panel="recording-meter"]').boundingBox();
		expect(dockedBounds.height).toBeGreaterThan(contentBounds.height * 0.8);
		await panel.getByRole('button', { name: 'Record level', exact: true }).click();
		const settings = editor.getByRole('dialog', { name: 'Record level', exact: true });
		await settings.getByRole('radio', { name: 'Gradient', exact: true }).click();
		await page.keyboard.press('Escape');
		await expect(panel).toBeVisible();
		await dockWorkspacePanel(editor, 'recording-meter', 'floating');
		const resize = panel.locator('[data-floating-panel-resize-handle="recording-meter"]');
		const floatingWidth = Number(await panel.getAttribute('data-workspace-panel-width'));
		const floatingChannels = await channels.boundingBox();
		await resize.focus();
		await resize.press('Shift+ArrowRight');
		await expect(panel).toHaveAttribute('data-workspace-panel-width', String(floatingWidth + 48));
		await expect.poll(async () => (await channels.boundingBox()).width).toBeGreaterThan(floatingChannels.width + 40);
		const savedWidth = await panel.getAttribute('data-workspace-panel-width');
		await page.reload();
		const reloaded = await waitForEditor(page);
		const restored = reloaded.locator('[data-panel-dock="floating"] [data-workspace-panel="recording-meter"]');
		await expect(restored).toHaveAttribute('data-workspace-panel-width', savedWidth);
		await expect(restored.locator('[data-audio-meter]')).toHaveAttribute('data-meter-style', 'gradient');
	});
});
