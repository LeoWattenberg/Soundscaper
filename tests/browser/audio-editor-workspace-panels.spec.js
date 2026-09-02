import {
	expect,
	monoTone,
	test,
	toneA,
	toneB,
} from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	clipByName,
	clipField,
	closeDialog,
	closeWorkspacePanel,
	collectClientErrors,
	dockWorkspacePanel,
	fileDataTransfer,
	importFiles,
	openClipProperties,
	registerAudioEditorHooks,
	waitForEditor,
	workspacePanelMenu,
	workspacePanelMenuButton,
} from './audio-editor-test-helpers.js';

test.describe('audio editor React/design-system workflows', () => {
	registerAudioEditorHooks();

	test('resizes docked panels, moves and resizes floating windows, and resizes editor dialogs', async ({ browserName, page }) => {
		const editor = await bootEditor(page, '/embed/en/');

		const mixerPanel = editor.locator('[data-workspace-panel="mixer"]');
		if (!await mixerPanel.isVisible()) await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Mixer']);
		const bottomDock = editor.locator('[data-panel-dock="bottom"]');
		await expect(bottomDock).toHaveCSS('resize', 'none');
		const dockResizeHandle = bottomDock.locator('[data-workspace-dock-resize-handle="bottom"]');
		await expect(dockResizeHandle).toHaveCSS('cursor', 'ns-resize');
		await expect(mixerPanel).toHaveCSS('resize', 'none');
		const initialDockBounds = await bottomDock.boundingBox();
		expect(initialDockBounds).not.toBeNull();
		const initialMixerBounds = await mixerPanel.boundingBox();
		expect(initialMixerBounds).not.toBeNull();
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
		await expect(floatingDock.locator('[data-workspace-panel="metadata"]')).toHaveCSS('resize', 'both');
		await expect(floatingDock.locator('[data-floating-panel-move-handle="metadata"]')).toHaveCSS('touch-action', 'none');
		if (browserName !== 'webkit') {
			// Playwright WebKit does not synthesize the browser-owned CSS resize grip.
			// The application-owned keyboard resize path remains covered below.
			const initialPanelWidth = Number(await metadataPanel.getAttribute('data-workspace-panel-width'));
			const initialPanelHeight = Number(await metadataPanel.getAttribute('data-workspace-panel-height'));
			const metadataBounds = await metadataPanel.boundingBox();
			expect(metadataBounds).not.toBeNull();
			await page.mouse.move(metadataBounds.x + metadataBounds.width - 2, metadataBounds.y + metadataBounds.height - 2);
			await page.mouse.down();
			await page.mouse.move(metadataBounds.x + metadataBounds.width - 42, metadataBounds.y + metadataBounds.height - 34, { steps: 5 });
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

	test('resizes editor dialogs live with mouse and remains keyboard accessible', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		const resizeHandle = preferences.getByRole('button', { name: 'Resize: Editor preferences', exact: true });
		await expect(resizeHandle).toBeVisible();
		const beforeMouseResize = await preferences.boundingBox();
		const resizeHandleBounds = await resizeHandle.boundingBox();
		expect(beforeMouseResize).not.toBeNull();
		expect(resizeHandleBounds).not.toBeNull();

		await page.mouse.move(
			resizeHandleBounds.x + resizeHandleBounds.width / 2,
			resizeHandleBounds.y + resizeHandleBounds.height / 2,
		);
		await page.mouse.down();
		await page.mouse.move(
			resizeHandleBounds.x + resizeHandleBounds.width / 2 - 48,
			resizeHandleBounds.y + resizeHandleBounds.height / 2 - 32,
			{ steps: 4 },
		);
		await expect(preferences).toHaveClass(/audio-editor-resizable-surface--resizing/);
		const liveMouseResize = await preferences.boundingBox();
		expect(liveMouseResize.width).toBeCloseTo(beforeMouseResize.width - 48, 0);
		expect(liveMouseResize.height).toBeCloseTo(beforeMouseResize.height - 32, 0);
		const resizeTheme = await page.evaluate(() => {
			document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
			return document.documentElement.dataset.theme;
		});
		await expect(editor).toHaveCSS('color-scheme', resizeTheme);
		const rerenderedMouseResize = await preferences.boundingBox();
		expect(rerenderedMouseResize.width).toBeCloseTo(liveMouseResize.width, 0);
		expect(rerenderedMouseResize.height).toBeCloseTo(liveMouseResize.height, 0);

		await page.mouse.up();
		await expect(preferences).not.toHaveClass(/audio-editor-resizable-surface--resizing/);
		const committedMouseResize = await preferences.boundingBox();
		await page.mouse.move(
			resizeHandleBounds.x + resizeHandleBounds.width / 2 + 32,
			resizeHandleBounds.y + resizeHandleBounds.height / 2 + 32,
		);
		const afterMouseCleanup = await preferences.boundingBox();
		expect(afterMouseCleanup.width).toBeCloseTo(committedMouseResize.width, 0);
		expect(afterMouseCleanup.height).toBeCloseTo(committedMouseResize.height, 0);

		await resizeHandle.focus();
		await resizeHandle.press('ArrowLeft');
		await resizeHandle.press('ArrowUp');
		const afterKeyboardResize = await preferences.boundingBox();
		expect(afterKeyboardResize.width).toBeCloseTo(committedMouseResize.width - 16, 0);
		expect(afterKeyboardResize.height).toBeCloseTo(committedMouseResize.height - 16, 0);
	});

	test('keeps the floating toolbar position live and commits it after dragging', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const editorBounds = await editor.boundingBox();
		const gripper = editor.locator('[data-toolbar-dock="top"] .toolbar__gripper');
		const gripperBounds = await gripper.boundingBox();
		expect(editorBounds).not.toBeNull();
		expect(gripperBounds).not.toBeNull();

		const startX = gripperBounds.x + gripperBounds.width / 2;
		const startY = gripperBounds.y + gripperBounds.height / 2;
		const floatingX = editorBounds.x + Math.min(320, editorBounds.width / 3);
		const floatingY = editorBounds.y + Math.min(240, editorBounds.height / 3);
		await page.mouse.move(startX, startY);
		await page.mouse.down();
		await page.mouse.move(floatingX, floatingY, { steps: 4 });

		const floatingToolbar = editor.locator('[data-toolbar-dock="floating"]');
		await expect(floatingToolbar).toBeVisible();
		const livePosition = await floatingToolbar.boundingBox();
		const dragTheme = await page.evaluate(() => {
			document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
			return document.documentElement.dataset.theme;
		});
		await expect(editor).toHaveCSS('color-scheme', dragTheme);
		const rerenderedPosition = await floatingToolbar.boundingBox();
		expect(rerenderedPosition.x).toBeCloseTo(livePosition.x, 0);
		expect(rerenderedPosition.y).toBeCloseTo(livePosition.y, 0);

		await page.mouse.move(floatingX + 48, floatingY + 32);
		await expect.poll(async () => (await floatingToolbar.boundingBox()).x).toBeCloseTo(livePosition.x + 48, 0);
		await expect.poll(async () => (await floatingToolbar.boundingBox()).y).toBeCloseTo(livePosition.y + 32, 0);
		await page.mouse.up();
		const committedPosition = await floatingToolbar.boundingBox();
		const committedTheme = await page.evaluate(() => {
			document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
			return document.documentElement.dataset.theme;
		});
		await expect(editor).toHaveCSS('color-scheme', committedTheme);
		const finalPosition = await floatingToolbar.boundingBox();
		expect(finalPosition.x).toBeCloseTo(committedPosition.x, 0);
		expect(finalPosition.y).toBeCloseTo(committedPosition.y, 0);
	});

	test('keeps compact side docks separate without toolbar group controls', async ({ page }) => {
		await page.setViewportSize({ width: 800, height: 900 });
		const editor = await bootEditor(page, '/embed/en/');
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'History']);
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		const historyPanel = editor.locator('[data-workspace-panel="history"]');
		if (!await historyPanel.isVisible()) await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'History']);
		await dockWorkspacePanel(editor, 'history', 'left');

		const leftDock = editor.locator('[data-panel-dock="left"]');
		const rightDock = editor.locator('[data-panel-dock="right"]');
		const [tabletLeft, tabletRight] = await Promise.all([leftDock.boundingBox(), rightDock.boundingBox()]);
		expect(tabletLeft).not.toBeNull();
		expect(tabletRight).not.toBeNull();
		expect(tabletLeft.x + tabletLeft.width).toBeLessThanOrEqual(tabletRight.x + 1);

		await page.setViewportSize({ width: 390, height: 844 });
		const [mobileLeft, mobileRight] = await Promise.all([leftDock.boundingBox(), rightDock.boundingBox()]);
		expect(mobileLeft).not.toBeNull();
		expect(mobileRight).not.toBeNull();
		expect(mobileLeft.y + mobileLeft.height).toBeLessThanOrEqual(mobileRight.y + 1);

		await page.setViewportSize({ width: 800, height: 900 });
		await expect(editor.locator('[data-workspace-toolbar-drag-handle]')).toHaveCount(0);
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await expect(preferences.getByRole('tab', { name: /Toolbars$/ })).toHaveCount(0);
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await expect(preferences).toBeHidden();
		await expect(editor.locator('[data-workspace-toolbar="transport"]')).toHaveCount(1);
		await expect(editor.locator('[data-workspace-toolbar="tools"]')).toHaveCount(1);
		await expect(editor.locator('[data-workspace-toolbar="edit"]')).toHaveCount(0);
		await expect(editor.locator('[data-workspace-toolbar="meter"]')).toHaveCount(1);
	});

	test('drags workspace panels between docks without subgroup toolbar grabbers', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'History']);
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');

		const historyPanel = editor.locator('[data-workspace-panel="history"]');
		const metadataPanel = editor.locator('[data-workspace-panel="metadata"]');
		if (!await historyPanel.isVisible()) await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'History']);
		await expect(historyPanel).toBeVisible();
		await expect(metadataPanel).toBeVisible();
		await metadataPanel.locator('[data-workspace-panel-drag-handle="metadata"]').dragTo(historyPanel, {
			targetPosition: { x: 120, y: 4 },
		});
		await expect.poll(() => editor.locator('[data-panel-dock="right"] [data-workspace-panel]').evaluateAll(
			(panels) => panels.map((panel) => panel.dataset.workspacePanel),
		)).toEqual(['metadata', 'history']);

		const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
		const metadataHandle = metadataPanel.locator('[data-workspace-panel-drag-handle="metadata"]');
		await metadataHandle.dispatchEvent('dragstart', { dataTransfer });
		const floatingTarget = editor.locator('[data-workspace-drop-target="floating"]');
		await expect(editor.locator('[data-workspace-drop-targets]')).toHaveClass(/--active/);
		await floatingTarget.dispatchEvent('dragover', { dataTransfer });
		await floatingTarget.dispatchEvent('drop', { dataTransfer });
		await expect(editor.locator('[data-panel-dock="floating"] [data-workspace-panel="metadata"]')).toBeVisible();

		const floatingHandle = editor.locator('[data-panel-dock="floating"] [data-workspace-panel-drag-handle="metadata"]');
		await floatingHandle.dispatchEvent('dragstart', { dataTransfer });
		const leftTarget = editor.locator('[data-workspace-drop-target="left"]');
		await leftTarget.dispatchEvent('dragover', { dataTransfer });
		await leftTarget.dispatchEvent('drop', { dataTransfer });
		await expect(editor.locator('[data-panel-dock="left"] [data-workspace-panel="metadata"]')).toBeVisible();

		await expect(editor.locator('[data-workspace-toolbar-drag-handle]')).toHaveCount(0);
		expect(errors).toEqual([]);
	});

	test('routes picker imports by effective Project bin visibility and keeps cards reusable across reload', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const projectBinPanel = editor.locator('[data-workspace-panel="project-bin"]');
		const projectBin = projectBinPanel.locator('[data-project-bin-drop-target]');
		await expect(projectBinPanel).toBeVisible();

		await editor.locator('[data-import-input]').setInputFiles([toneA]);
		await expect(projectBin.locator('[data-project-bin-item]')).toHaveCount(1);
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		const card = projectBin.locator('[data-project-bin-item]').first();
		await expect(card.locator('[data-project-bin-waveform]')).toBeVisible();
		await expect(card.locator('.kw-audio-editor__project-bin-waveform-peaks')).toHaveCount(1);
		const name = card.locator('[data-project-bin-name]');
		await name.fill('Reusable browser tone');
		await name.press('Enter');
		await expect(name).toHaveValue('Reusable browser tone');

		await card.getByRole('button', { name: /Add to timeline/ }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(projectBin.locator('[data-project-bin-item]')).toHaveCount(1);
		await card.getByRole('button', { name: /More file actions/ }).click();
		await page.getByRole('menuitem', { name: 'Remove from Project bin', exact: true }).click();
		await expect(projectBin.locator('[data-project-bin-item]')).toHaveCount(0);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(projectBin.locator('[data-project-bin-item]')).toHaveCount(1);

		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.reload();
		await waitForEditor(page);
		await expect(projectBinPanel).toBeVisible();
		await expect(projectBin.locator('[data-project-bin-name]')).toHaveValue('Reusable browser tone');
		await expect(editor).toHaveAttribute('data-clip-count', '1');

		await closeWorkspacePanel(editor, 'project-bin');
		await editor.locator('[data-import-input]').setInputFiles([toneB]);
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await expect(clipByName(editor, toneB.name)).toBeVisible();
	});

	test('exposes Project bin icon controls, source selection, preview, replacement, and project removal', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const projectBin = editor.locator('[data-project-bin-drop-target]');
		await editor.locator('[data-project-bin-input]').setInputFiles([toneA]);
		const card = projectBin.locator('[data-project-bin-item]').first();
		const add = card.getByRole('button', { name: /Add to timeline/ });
		const selectInstances = card.getByRole('button', { name: /Select all instances/ });
		const preview = card.getByRole('button', { name: /^Play:/ });
		const more = card.getByRole('button', { name: /More file actions/ });

		await expect(add).toBeVisible();
		await expect(selectInstances).toBeDisabled();
		await expect(preview).toBeVisible();
		await expect(more).toBeVisible();
		const [moreBox, addBox] = await Promise.all([more.boundingBox(), add.boundingBox()]);
		expect(moreBox.x).toBeLessThan(addBox.x);

		await preview.click();
		await expect(card.getByRole('button', { name: /^Pause:/ })).toHaveAttribute('aria-pressed', 'true');
		await card.getByRole('button', { name: /^Pause:/ }).click();
		await expect(card.getByRole('button', { name: /^Play:/ })).toHaveAttribute('aria-pressed', 'false');

		await add.click();
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(selectInstances).toBeEnabled();
		await selectInstances.click();
		await expect(clipByName(editor, toneA.name).locator('.clip-display')).toHaveAttribute('data-selected', 'true');

		await more.click();
		const fileChooserPromise = page.waitForEvent('filechooser');
		await page.getByRole('menuitem', { name: 'Replace', exact: true }).click();
		const fileChooser = await fileChooserPromise;
		await fileChooser.setFiles(toneB);
		await expect(projectBin.locator('[data-project-bin-item]')).toHaveCount(1);
		await expect(editor).toHaveAttribute('data-clip-count', '1');

		await more.click();
		await page.getByRole('menuitem', { name: 'Remove from project', exact: true }).click();
		const dialog = page.locator('[data-project-bin-remove-dialog]');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Remove from project', exact: true }).click();
		await expect(projectBin.locator('[data-project-bin-item]')).toHaveCount(0);
		await expect(editor).toHaveAttribute('data-clip-count', '0');
	});

	test('reveals the Project bin for context moves and supports atomic pointer moves with Escape cancellation', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA, toneB]);
		const firstClip = clipByName(editor, toneA.name);
		const secondClip = clipByName(editor, toneB.name);
		await firstClip.locator('.clip-header').click();
		await secondClip.locator('.clip-header').click({ modifiers: ['Shift'] });
		await expect(firstClip.locator('.clip-display')).toHaveClass(/clip-display--selected/);
		await expect(secondClip.locator('.clip-display')).toHaveClass(/clip-display--selected/);

		await firstClip.getByRole('button', { name: 'Clip menu', exact: true }).click();
		const clipMenu = page.locator('.audio-editor-clip-context-menu');
		const moveToBin = clipMenu.locator('[data-action-id="local://move-clip-to-project-bin"]');
		await expect(moveToBin).toHaveAttribute('data-parity-status', 'supplemental');
		await moveToBin.click();
		const projectBinPanel = editor.locator('[data-workspace-panel="project-bin"]');
		const projectBin = projectBinPanel.locator('[data-project-bin-drop-target]');
		await expect(projectBinPanel).toBeVisible();
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		await expect(projectBin.locator('[data-project-bin-item]')).toHaveCount(2);

		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await expect(projectBin.locator('[data-project-bin-item]')).toHaveCount(0);
		await expect(firstClip.locator('.clip-display')).toHaveClass(/clip-display--selected/);
		await expect(secondClip.locator('.clip-display')).toHaveClass(/clip-display--selected/);

		const dragHeader = firstClip.locator('.clip-header');
		const [headerBounds, binBounds] = await Promise.all([dragHeader.boundingBox(), projectBin.boundingBox()]);
		expect(headerBounds).not.toBeNull();
		expect(binBounds).not.toBeNull();
		const startX = headerBounds.x + Math.min(32, headerBounds.width / 2);
		const startY = headerBounds.y + headerBounds.height / 2;
		const dropX = binBounds.x + binBounds.width / 2;
		const dropY = binBounds.y + Math.min(120, binBounds.height / 2);
		await page.mouse.move(startX, startY);
		await page.mouse.down();
		await page.mouse.move(dropX, dropY, { steps: 8 });
		await expect(projectBin).toHaveAttribute('data-drop-active', 'true');
		await page.keyboard.press('Escape');
		await page.mouse.up();
		await expect(projectBin).not.toHaveAttribute('data-drop-active', 'true');
		await expect(editor).toHaveAttribute('data-clip-count', '2');

		await page.mouse.move(startX, startY);
		await page.mouse.down();
		await page.mouse.move(dropX, dropY, { steps: 8 });
		await page.mouse.up();
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		await expect(projectBin.locator('[data-project-bin-item]')).toHaveCount(2);
	});

	test('resizes tracks from track-control-panel edges and caps their height to the timeline', async ({ page }) => {
		await page.setViewportSize({ width: 1_440, height: 1_400 });
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const clipHeader = clipByName(editor, toneA.name).locator('.clip-header');
		const clipTrackRow = clipHeader.locator('xpath=ancestor::*[@data-track-row][1]');
		const trackRow = editor.locator('[data-track-list] > [data-track-row]').first();
		const trackHeader = trackRow.locator('[data-track-header]');
		const timelineInner = editor.locator('.audio-editor-timeline-inner');
		const [headerBounds, initialTrackBounds, initialClipTrackBounds, timelineBounds] = await Promise.all([
			trackHeader.boundingBox(),
			trackRow.boundingBox(),
			clipTrackRow.boundingBox(),
			timelineInner.boundingBox(),
		]);
		expect(headerBounds).not.toBeNull();
		expect(initialTrackBounds).not.toBeNull();
		expect(initialClipTrackBounds).not.toBeNull();
		expect(timelineBounds).not.toBeNull();
		const clipHeaderBounds = await clipHeader.boundingBox();
		await page.mouse.move(clipHeaderBounds.x + clipHeaderBounds.width / 2, clipHeaderBounds.y + clipHeaderBounds.height - 1);
		await page.mouse.down();
		await page.mouse.move(clipHeaderBounds.x + clipHeaderBounds.width / 2, clipHeaderBounds.y + clipHeaderBounds.height + 16, { steps: 3 });
		await page.mouse.up();
		expect((await clipTrackRow.boundingBox())?.height).toBe(initialClipTrackBounds.height);

		const resizeX = headerBounds.x + headerBounds.width / 2;
		await page.mouse.move(resizeX, headerBounds.y + headerBounds.height - 2);
		await page.mouse.down();
		await page.mouse.move(resizeX, headerBounds.y + headerBounds.height + 60, { steps: 4 });
		await page.mouse.up();
		await expect.poll(async () => (await trackRow.boundingBox())?.height).toBeGreaterThan(initialTrackBounds.height + 40);

		let resizedHeaderBounds = await trackHeader.boundingBox();
		const grownTrackBounds = await trackRow.boundingBox();
		await page.mouse.move(resizeX, resizedHeaderBounds.y + 2);
		await page.mouse.down();
		await page.mouse.move(resizeX, resizedHeaderBounds.y + 31, { steps: 4 });
		await page.mouse.up();
		await expect.poll(async () => (await trackRow.boundingBox())?.height).toBeLessThan(grownTrackBounds.height - 20);

		resizedHeaderBounds = await trackHeader.boundingBox();
		const cappedTimelineBounds = await timelineInner.boundingBox();
		const currentTrackBounds = await trackRow.boundingBox();
		const maximumTrackHeight = Math.floor(cappedTimelineBounds.height * 0.9);
		const capDragY = resizedHeaderBounds.y + resizedHeaderBounds.height - 2
			+ Math.max(0, maximumTrackHeight - currentTrackBounds.height) + 4;
		expect(capDragY).toBeLessThan(page.viewportSize().height);
		await page.mouse.move(resizeX, resizedHeaderBounds.y + resizedHeaderBounds.height - 2);
		await page.mouse.down();
		await page.mouse.move(resizeX, capDragY, { steps: 4 });
		await page.mouse.up();
		await expect.poll(async () => (await trackRow.boundingBox())?.height)
			.toBeGreaterThanOrEqual(maximumTrackHeight - 1);
		await expect.poll(async () => (await trackRow.boundingBox())?.height).toBeLessThanOrEqual(maximumTrackHeight);
	});

	test('auto-fits new track heights until manual resizing and re-engages from View Zoom', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const timeline = editor.locator('[data-timeline]');
		const trackRows = editor.locator('[data-track-list] > [data-track-row]');
		const addAudioTrack = async () => {
			await editor.getByRole('button', { name: 'Add track', exact: true }).click();
			await page.getByRole('menu', { name: 'Add track', exact: true })
				.getByRole('menuitem', { name: 'Audio track', exact: true })
				.click();
		};

		await expect(trackRows).toHaveCount(1);
		// A lone track fills the lane area left by the sticky ruler row, capped at
		// the auto-fit ceiling. The lane area shrinks whenever the timeline shares
		// the panel with docks, so derive it instead of pinning a viewport height.
		// The viewport model rounds its observed height before taking the ruler
		// off, so derive the same way or a half-pixel lane reads one pixel short.
		const laneHeight = await timeline.evaluate((element) => Math.floor(
			Math.round(element.getBoundingClientRect().height)
			- element.querySelector('.audio-editor-ruler-row').getBoundingClientRect().height,
		));
		expect((await trackRows.first().boundingBox())?.height).toBe(Math.min(300, laneHeight));
		await importFiles(editor, [toneA]);
		let trackCount = await trackRows.count();
		while ((await trackRows.first().boundingBox())?.height > 114 && trackCount < 10) {
			await addAudioTrack();
			trackCount += 1;
			await expect(trackRows).toHaveCount(trackCount);
		}
		expect(trackCount).toBeLessThan(10);
		await expect.poll(() => trackRows.evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height)))
			.toEqual(Array(trackCount).fill(114));
		await expect.poll(() => timeline.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

		const clipHeader = clipByName(editor, toneA.name).locator('.clip-header');
		const resizedTrackRow = clipHeader.locator('xpath=ancestor::*[@data-track-row][1]');
		const trackHeader = resizedTrackRow.locator('[data-track-header]');
		const headerBounds = await trackHeader.boundingBox();
		const resizeX = headerBounds.x + headerBounds.width / 2;
		await page.mouse.move(resizeX, headerBounds.y + headerBounds.height - 1);
		await page.mouse.down();
		await page.mouse.move(resizeX, headerBounds.y + headerBounds.height + 24, { steps: 3 });
		await page.mouse.up();
		await expect.poll(async () => (await resizedTrackRow.boundingBox())?.height).toBeGreaterThan(114);

		await addAudioTrack();
		trackCount += 1;
		await expect(trackRows).toHaveCount(trackCount);
		expect((await trackRows.last().boundingBox())?.height).toBe(300);

		await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Fit height']);
		await expect.poll(() => trackRows.evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height)))
			.toEqual(Array(trackCount).fill(114));

		const timelinePanel = editor.locator('.audio-editor-timeline-panel');
		await timelinePanel.evaluate((element) => { element.tabIndex = -1; element.focus(); });
		await page.keyboard.press('Control+Shift+ArrowDown');
		await expect.poll(() => trackRows.evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height)))
			.toEqual(Array(trackCount).fill(98));
		await page.keyboard.press('Control+Shift+ArrowUp');
		await expect.poll(() => trackRows.evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height)))
			.toEqual(Array(trackCount).fill(114));

		const firstTrackMenuButton = trackRows.first().getByRole('button', { name: 'Track menu', exact: true });
		await firstTrackMenuButton.click();
		const trackMenu = page.locator('.audio-editor-track-menu');
		await expect(trackMenu.getByRole('menuitem', { name: 'Collapse track', exact: true })).toHaveCount(0);
		await trackMenu.getByRole('menuitem', { name: 'Decrease track height', exact: true }).click();
		await expect.poll(async () => (await trackRows.first().boundingBox())?.height).toBe(98);
		await firstTrackMenuButton.click();
		await trackMenu.getByRole('menuitem', { name: 'Increase track height', exact: true }).click();
		await expect.poll(async () => (await trackRows.first().boundingBox())?.height).toBe(114);
	});

	test('previews reusable bin clips on timeline drag and routes external drops by surface', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		const projectBin = editor.locator('[data-project-bin-drop-target]');
		await editor.locator('[data-project-bin-input]').setInputFiles([toneA]);
		const card = projectBin.locator('[data-project-bin-item]').first();
		await expect(card).toBeVisible();
		const lane = editor.locator('.audio-editor-track-lane[data-track-lane]').first();
		const laneBounds = await lane.boundingBox();
		expect(laneBounds).not.toBeNull();
		const targetPosition = {
			x: laneBounds.x + Math.min(220, laneBounds.width - 24),
			y: laneBounds.y + laneBounds.height / 2,
		};
		const binTransfer = await page.evaluateHandle(() => new DataTransfer());
		await card.dispatchEvent('dragstart', { dataTransfer: binTransfer });
		await lane.dispatchEvent('dragover', {
			dataTransfer: binTransfer,
			clientX: targetPosition.x,
			clientY: targetPosition.y,
		});
		await expect(clipByName(editor, toneA.name)).toBeVisible();
		await lane.dispatchEvent('drop', {
			dataTransfer: binTransfer,
			clientX: targetPosition.x,
			clientY: targetPosition.y,
		});
		await card.dispatchEvent('dragend', { dataTransfer: binTransfer });
		await binTransfer.dispose();
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(projectBin.locator('[data-project-bin-item]')).toHaveCount(1);

		const explicitBinTransfer = await fileDataTransfer(page, [toneB]);
		await projectBin.dispatchEvent('dragenter', { dataTransfer: explicitBinTransfer });
		await projectBin.dispatchEvent('dragover', { dataTransfer: explicitBinTransfer });
		await expect(projectBin).toHaveAttribute('data-drop-active', 'true');
		await projectBin.dispatchEvent('drop', { dataTransfer: explicitBinTransfer });
		await explicitBinTransfer.dispose();
		await expect(projectBin.locator('[data-project-bin-item]')).toHaveCount(2);
		await expect(editor).toHaveAttribute('data-clip-count', '1');

		const timelineTransfer = await fileDataTransfer(page, [monoTone, toneB]);
		const timelineDropX = laneBounds.x + Math.min(420, laneBounds.width - 24);
		const timelineDropY = laneBounds.y + laneBounds.height / 2;
		await lane.dispatchEvent('dragover', {
			dataTransfer: timelineTransfer,
			clientX: timelineDropX,
			clientY: timelineDropY,
		});
		await lane.dispatchEvent('drop', {
			dataTransfer: timelineTransfer,
			clientX: timelineDropX,
			clientY: timelineDropY,
		});
		await timelineTransfer.dispose();
		await expect(editor).toHaveAttribute('data-clip-count', '3');
		await expect(editor).toHaveAttribute('data-track-count', '2');
		await expect(projectBin.locator('[data-project-bin-item]')).toHaveCount(2);
		const droppedClipDialog = await openClipProperties(page, editor, clipByName(editor, monoTone.name));
		await expect.poll(async () => Number(await clipField(droppedClipDialog, 'startFrame').inputValue())).toBeGreaterThan(0);
		await closeDialog(droppedClipDialog);
	});

	test('suppresses the default Project bin on compact mobile until explicitly opened', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		const editor = await bootEditor(page, '/embed/en/');
		const projectBinPanel = editor.locator('[data-workspace-panel="project-bin"]');
		await expect(projectBinPanel).toHaveCount(0);
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Project bin']);
		await expect(projectBinPanel).toBeVisible();
	});
});
