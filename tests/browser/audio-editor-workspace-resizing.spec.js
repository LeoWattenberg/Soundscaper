import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	closeWorkspacePanel,
	dockWorkspacePanel,
	registerAudioEditorHooks,
	waitForEditor,
	workspacePanelMenu,
	workspacePanelMenuButton,
} from './audio-editor-test-helpers.js';

test.describe('workspace panel resizing', () => {
	registerAudioEditorHooks();

	test('resizes docked panels, moves and resizes floating windows, and resizes editor dialogs', async ({ browserName, page }) => {
		const editor = await bootEditor(page, '/embed/en/');

		const mixerPanel = editor.locator('[data-workspace-panel="mixer"]');
		if (!await mixerPanel.isVisible()) await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
		const bottomDock = editor.locator('[data-panel-dock="bottom"]');
		await expect(bottomDock).toHaveCSS('resize', 'none');
		const dockResizeHandle = bottomDock.locator('[data-workspace-dock-resize-handle="bottom"]');
		await expect(dockResizeHandle).toHaveCSS('cursor', 'ns-resize');
		await expect(dockResizeHandle).toBeEmpty();
		await expect(mixerPanel).toHaveCSS('resize', 'none');
		const initialDockBounds = await bottomDock.boundingBox();
		expect(initialDockBounds).not.toBeNull();
		const initialMixerBounds = await mixerPanel.boundingBox();
		expect(initialMixerBounds).not.toBeNull();
		expect(initialMixerBounds.width).toBeCloseTo(initialDockBounds.width, 0);
		const initialMixerSize = Number(await mixerPanel.getAttribute('data-workspace-panel-size'));
		await page.mouse.move(initialDockBounds.x + initialDockBounds.width / 2, initialDockBounds.y + 2);
		await page.mouse.down();
		await page.mouse.move(initialDockBounds.x + initialDockBounds.width / 2, initialDockBounds.y + 66, { steps: 5 });
		await page.mouse.up();
		await expect.poll(async () => Number(await mixerPanel.getAttribute('data-workspace-panel-size'))).toBeLessThan(initialMixerSize - 20);
		const resizedMixerSize = Number(await mixerPanel.getAttribute('data-workspace-panel-size'));
		await expect.poll(async () => (await bottomDock.boundingBox())?.height).toBeGreaterThan(0);
		await expect.poll(async () => (await bottomDock.boundingBox())?.height).toBeLessThanOrEqual(resizedMixerSize);
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
		await expect(mixerPanel).toHaveCount(0);
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
		if (!await mixerPanel.isVisible()) await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
		await expect(mixerPanel).toHaveAttribute('data-workspace-panel-size', String(resizedMixerSize));
		await expect.poll(async () => Math.abs(
			((await mixerPanel.boundingBox())?.height || 0) - ((await bottomDock.boundingBox())?.height || 0),
		)).toBeLessThan(2);

		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		const metadataPanel = editor.locator('[data-workspace-panel="metadata"]');
		await expect(metadataPanel).toBeVisible();
		await dockWorkspacePanel(editor, 'metadata', 'floating');
		const floatingDock = editor.locator('[data-panel-dock="floating"]');
		// A keyboard-opened panel menu lands on its first item; Escape hands focus back to the button.
		const metadataMenuButton = workspacePanelMenuButton(metadataPanel);
		const metadataMenu = workspacePanelMenu(editor);
		await metadataMenuButton.press('Enter');
		await expect(metadataMenu).toBeVisible();
		await expect(metadataMenu.getByRole('menuitem').first()).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(metadataMenu).toBeHidden();
		await expect(metadataMenuButton).toBeFocused();
		// A pointer user closes the menu with the same button that opened it.
		await metadataMenuButton.click();
		await expect(metadataMenu).toBeVisible();
		await metadataMenuButton.click();
		await expect(metadataMenu).toBeHidden();
		await expect(metadataMenuButton).toHaveAttribute('aria-expanded', 'false');
		await expect(floatingDock).toHaveCSS('resize', 'none');
		await expect(floatingDock.locator('[data-workspace-panel="metadata"]')).toHaveCSS('resize', 'none');
		await expect(floatingDock.locator('[data-floating-panel-move-handle="metadata"]')).toHaveCSS('touch-action', 'none');
		if (browserName !== 'webkit') {
			// Playwright WebKit does not synthesize the browser-owned CSS resize grip.
			// The application-owned keyboard resize path remains covered below.
			const initialPanelWidth = Number(await metadataPanel.getAttribute('data-workspace-panel-width'));
			const initialPanelHeight = Number(await metadataPanel.getAttribute('data-workspace-panel-height'));
			const metadataBounds = await metadataPanel.boundingBox();
			expect(metadataBounds).not.toBeNull();
			const floatingResizeBounds = await metadataPanel.locator('[data-floating-panel-resize-handle="metadata"]').boundingBox();
			expect(floatingResizeBounds).not.toBeNull();
			const resizeX = floatingResizeBounds.x + floatingResizeBounds.width / 2;
			const resizeY = floatingResizeBounds.y + floatingResizeBounds.height / 2;
			await page.mouse.move(resizeX, resizeY);
			await page.mouse.down();
			await page.mouse.move(resizeX - 40, resizeY - 32, { steps: 5 });
			await page.mouse.up();
			await expect.poll(async () => Number(await metadataPanel.getAttribute('data-workspace-panel-width'))).not.toBe(initialPanelWidth);
			await expect.poll(async () => Number(await metadataPanel.getAttribute('data-workspace-panel-height'))).not.toBe(initialPanelHeight);
		}

		const initialPanelX = Number(await metadataPanel.getAttribute('data-workspace-panel-x'));
		const initialPanelY = Number(await metadataPanel.getAttribute('data-workspace-panel-y'));
		const moveHandle = metadataPanel.locator('[data-floating-panel-move-handle="metadata"]');
		const moveBounds = await moveHandle.boundingBox();
		expect(moveBounds).not.toBeNull();
		await page.mouse.move(moveBounds.x + moveBounds.width / 2, moveBounds.y + moveBounds.height / 2);
		await page.mouse.down();
		await page.mouse.move(moveBounds.x + moveBounds.width / 2 + 48, moveBounds.y + moveBounds.height / 2 + 32, { steps: 5 });
		await page.mouse.up();
		await expect.poll(async () => Number(await metadataPanel.getAttribute('data-workspace-panel-x'))).toBeGreaterThan(initialPanelX + 30);
		await expect.poll(async () => Number(await metadataPanel.getAttribute('data-workspace-panel-y'))).toBeGreaterThan(initialPanelY + 20);

		const workspace = editor.locator('.kw-audio-editor__workspace');
		const workspaceBounds = await workspace.boundingBox();
		const movedHandleBounds = await moveHandle.boundingBox();
		expect(workspaceBounds).not.toBeNull();
		expect(movedHandleBounds).not.toBeNull();
		await page.mouse.move(movedHandleBounds.x + movedHandleBounds.width / 2, movedHandleBounds.y + movedHandleBounds.height / 2);
		await page.mouse.down();
		await page.mouse.move(workspaceBounds.x + workspaceBounds.width - 2, workspaceBounds.y + workspaceBounds.height - 2, { steps: 5 });
		await page.mouse.up();
		const clampedBounds = await metadataPanel.boundingBox();
		expect(clampedBounds.x + clampedBounds.width).toBeLessThanOrEqual(workspaceBounds.x + workspaceBounds.width + 1);
		expect(clampedBounds.y + clampedBounds.height).toBeLessThanOrEqual(workspaceBounds.y + workspaceBounds.height + 1);

		const keyboardMoveHandle = metadataPanel.locator('[data-workspace-panel-drag-handle="metadata"]');
		const keyboardStartX = Number(await metadataPanel.getAttribute('data-workspace-panel-x'));
		const keyboardStartY = Number(await metadataPanel.getAttribute('data-workspace-panel-y'));
		await keyboardMoveHandle.focus();
		await expect(metadataPanel).toHaveClass(/kw-audio-editor__workspace-panel--active/);
		await keyboardMoveHandle.press('ArrowLeft');
		await keyboardMoveHandle.press('ArrowUp');
		await expect.poll(async () => Number(await metadataPanel.getAttribute('data-workspace-panel-x'))).toBe(keyboardStartX - 16);
		await expect.poll(async () => Number(await metadataPanel.getAttribute('data-workspace-panel-y'))).toBe(keyboardStartY - 16);
		const keyboardResizeHandle = metadataPanel.locator('[data-floating-panel-resize-handle="metadata"]');
		await expect(keyboardResizeHandle).toBeEmpty();
		const keyboardStartWidth = Number(await metadataPanel.getAttribute('data-workspace-panel-width'));
		const keyboardStartHeight = Number(await metadataPanel.getAttribute('data-workspace-panel-height'));
		await keyboardResizeHandle.focus();
		await keyboardResizeHandle.press('ArrowLeft');
		await keyboardResizeHandle.press('ArrowUp');
		await expect.poll(async () => Number(await metadataPanel.getAttribute('data-workspace-panel-width'))).toBe(keyboardStartWidth - 16);
		await expect.poll(async () => Number(await metadataPanel.getAttribute('data-workspace-panel-height'))).toBe(keyboardStartHeight - 16);

		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		const resizeHandle = preferences.getByRole('button', { name: 'Resize: Editor preferences', exact: true });
		await expect(resizeHandle).toBeVisible();
		const before = await preferences.boundingBox();
		await resizeHandle.focus();
		await resizeHandle.press('ArrowLeft');
		await resizeHandle.press('ArrowUp');
		const after = await preferences.boundingBox();
		expect(after.width).toBeCloseTo(before.width - 16, 0);
		expect(after.height).toBeCloseTo(before.height - 16, 0);
	});

	test('fills a side dock and resizes only the boundary between stacked panels', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Project bin']);
		const leftDock = editor.locator('[data-panel-dock="left"]');
		const projectBin = leftDock.locator('[data-workspace-panel="project-bin"]');
		const dockResizeHandle = leftDock.locator('[data-workspace-dock-resize-handle="left"]');
		await expect(projectBin).toBeVisible();
		await expect(projectBin).toHaveCSS('resize', 'none');
		await expect(dockResizeHandle).toBeEmpty();
		const dockBounds = await leftDock.boundingBox();
		const projectBounds = await projectBin.boundingBox();
		expect(dockBounds).not.toBeNull();
		expect(projectBounds).not.toBeNull();
		expect(projectBounds.height).toBeCloseTo(dockBounds.height, 0);

		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'History']);
		await dockWorkspacePanel(editor, 'history', 'left');
		const history = leftDock.locator('[data-workspace-panel="history"]');
		await expect(leftDock.locator('[data-workspace-panel-group]')).toHaveCount(2);
		const stackedProjectBounds = await projectBin.boundingBox();
		const stackedHistoryBounds = await history.boundingBox();
		expect(stackedProjectBounds.height + stackedHistoryBounds.height).toBeCloseTo(dockBounds.height, 0);
		const initialSize = Number(await projectBin.getAttribute('data-workspace-panel-size'));
		await page.mouse.move(stackedProjectBounds.x + stackedProjectBounds.width / 2, stackedProjectBounds.y + stackedProjectBounds.height - 3);
		await page.mouse.down();
		await page.mouse.move(stackedProjectBounds.x + stackedProjectBounds.width / 2, stackedProjectBounds.y + stackedProjectBounds.height + 42, { steps: 5 });
		await page.mouse.up();
		await expect.poll(async () => Number(await projectBin.getAttribute('data-workspace-panel-size'))).toBeGreaterThan(initialSize + 20);
		const savedSize = await projectBin.getAttribute('data-workspace-panel-size');
		await page.reload();
		await waitForEditor(page);
		await expect(projectBin).toHaveAttribute('data-workspace-panel-size', savedSize);
		const resizedProjectBounds = await projectBin.boundingBox();
		const resizedHistoryBounds = await history.boundingBox();
		expect(resizedProjectBounds.height + resizedHistoryBounds.height).toBeCloseTo(dockBounds.height, 0);

		const stableSize = await history.getAttribute('data-workspace-panel-size');
		await page.mouse.move(resizedHistoryBounds.x + resizedHistoryBounds.width / 2, resizedHistoryBounds.y + resizedHistoryBounds.height - 3);
		await page.mouse.down();
		await page.mouse.move(resizedHistoryBounds.x + resizedHistoryBounds.width / 2, resizedHistoryBounds.y + resizedHistoryBounds.height - 43, { steps: 5 });
		await page.mouse.up();
		await expect(history).toHaveAttribute('data-workspace-panel-size', stableSize);
		await closeWorkspacePanel(editor, 'history');
		await expect.poll(async () => Math.abs(
			((await projectBin.boundingBox())?.height || 0) - ((await leftDock.boundingBox())?.height || 0),
		)).toBeLessThan(2);
	});

	test('ignores horizontal edge drags on bottom-docked panel groups', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const mixerPanel = editor.locator('[data-workspace-panel="mixer"]');
		if (!await mixerPanel.isVisible()) await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		await dockWorkspacePanel(editor, 'metadata', 'bottom');
		const bottomDock = editor.locator('[data-panel-dock="bottom"]');
		await expect(bottomDock.locator('[data-workspace-panel-group]')).toHaveCount(2);
		await page.waitForTimeout(250);
		const initialDockBounds = await bottomDock.boundingBox();
		const initialMixerBounds = await mixerPanel.boundingBox();
		const initialMetadataBounds = await editor.locator('[data-workspace-panel="metadata"]').boundingBox();
		expect(initialDockBounds).not.toBeNull();
		expect(initialMixerBounds).not.toBeNull();
		expect(initialMetadataBounds).not.toBeNull();
		expect(initialMixerBounds.width + initialMetadataBounds.width).toBeCloseTo(initialDockBounds.width, 0);
		const initialSize = await mixerPanel.getAttribute('data-workspace-panel-size');

		await page.mouse.move(
			initialMixerBounds.x + initialMixerBounds.width - 6,
			initialMixerBounds.y + initialMixerBounds.height / 2,
		);
		await page.mouse.down();
		await page.mouse.move(
			initialMixerBounds.x + initialMixerBounds.width + 194,
			initialMixerBounds.y + initialMixerBounds.height / 2,
			{ steps: 5 },
		);
		await page.mouse.up();

		await expect(mixerPanel).toHaveAttribute('data-workspace-panel-size', initialSize);
		await expect.poll(async () => Math.abs(
			((await bottomDock.boundingBox())?.height || 0) - initialDockBounds.height,
		)).toBeLessThan(2);
	});
});
