/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseNestedCommandAction,
	closeWorkspacePanel,
	dockWorkspacePanel,
	openEffectsForTrack,
	openWorkspacePanelMenu,
	registerAudioEditorHooks,
	waitForEditor,
} from './audio-editor-test-helpers.js';

test.describe('Audacity-style workspace panel snapping', () => {
	registerAudioEditorHooks();

	test('untouched tablet docks retain their width and an explicit resize can exceed the old cap', async ({ page }) => {
		await page.setViewportSize({ width: 1024, height: 900 });
		const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'Project bin']);
		const dock = editor.locator('[data-panel-dock="left"]');
		await expect(dock).toHaveAttribute('data-workspace-dock-wide', 'false');
		const before = await requiredBounds(dock);
		expect(before.width).toBeLessThanOrEqual(1024 * 0.34 + 2);

		const handle = await requiredBounds(dock.locator('[data-workspace-dock-resize-handle="left"]'));
		await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
		await page.mouse.click(handle.x + handle.width / 2, handle.y + handle.height / 2);
		await expect(dock).toHaveAttribute('data-workspace-dock-wide', 'false');
		expect((await requiredBounds(dock)).width).toBeCloseTo(before.width, 0);
		await page.mouse.down();
		await page.mouse.move(handle.x + handle.width / 2 + 200, handle.y + handle.height / 2, { steps: 5 });
		await page.mouse.up();
		await expect(dock).toHaveAttribute('data-workspace-dock-wide', 'true');
		const after = await requiredBounds(dock);
		expect(after.width).toBeGreaterThan(420);
		expect(after.width).toBeGreaterThan(before.width + 150);

		await page.reload();
		await waitForEditor(page);
		await expect(dock).toHaveAttribute('data-workspace-dock-wide', 'true');
		expect((await requiredBounds(dock)).width).toBeCloseTo(after.width, 0);
	});

	test('side panels split through vertical thirds, tab without unmounting, and restore their active tab', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await openHistoryAndMetadata(page, editor);
		const rightDock = editor.locator('[data-panel-dock="right"]');
		const history = () => editor.locator('[data-workspace-panel="history"]');
		const metadata = () => editor.locator('[data-workspace-panel="metadata"]');
		const selfTransfer = await page.evaluateHandle(() => new DataTransfer());
		const initialHistoryBounds = await requiredBounds(history());
		const initialHistoryHandle = history().locator('[data-workspace-panel-drag-handle="history"]');
		await initialHistoryHandle.dispatchEvent('dragstart', { dataTransfer: selfTransfer });
		await history().dispatchEvent('dragover', {
			dataTransfer: selfTransfer,
			clientX: initialHistoryBounds.x + initialHistoryBounds.width / 2,
			clientY: initialHistoryBounds.y + initialHistoryBounds.height / 2,
		});
		await history().dispatchEvent('drop', {
			dataTransfer: selfTransfer,
			clientX: initialHistoryBounds.x + initialHistoryBounds.width / 2,
			clientY: initialHistoryBounds.y + initialHistoryBounds.height / 2,
		});
		await initialHistoryHandle.dispatchEvent('dragend', { dataTransfer: selfTransfer });
		await expect.poll(() => frameOrder(rightDock)).toEqual(['history', 'metadata']);

		await dragPanel(history(), metadata(), 'after', 'side');
		await expect.poll(() => frameOrder(rightDock)).toEqual(['metadata', 'history']);

		const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
		const metadataBounds = await requiredBounds(metadata());
		const historyHandle = history().locator('[data-workspace-panel-drag-handle="history"]');
		await historyHandle.dispatchEvent('dragstart', { dataTransfer });
		await expect(editor.locator('[data-workspace-drop-target="right"]')).toBeHidden();
		await metadata().dispatchEvent('dragover', {
			dataTransfer,
			clientX: metadataBounds.x + metadataBounds.width / 2,
			clientY: metadataBounds.y + 4,
		});
		await expect(metadata()).toHaveAttribute('data-workspace-drop-intent', 'before');
		const sidePreview = await requiredBounds(metadata().locator('.kw-audio-editor__workspace-panel-drop-preview'));
		expect(sidePreview.height).toBeCloseTo(metadataBounds.height / 2, 0);
		await historyHandle.dispatchEvent('dragend', { dataTransfer });

		await dragPanel(history(), metadata(), 'before', 'side');
		await expect.poll(() => frameOrder(rightDock)).toEqual(['history', 'metadata']);
		await dragPanel(history(), metadata(), 'tab', 'side');

		const group = rightDock.locator(
			'[data-workspace-panel-group]:has([data-workspace-tab-panel="history"])',
		);
		await expect(group).toHaveCount(1);
		const tabs = group.getByRole('tab');
		await expect(tabs).toHaveText([/Metadata$/u, /History$/u]);
		await expect(group.getByRole('tab', { name: 'History', exact: true })).toHaveAttribute('aria-selected', 'true');
		const historyContent = group.locator('[data-workspace-tab-panel="history"]');
		const metadataContent = group.locator('[data-workspace-tab-panel="metadata"]');
		await historyContent.evaluate((element) => { element.dataset.mountProbe = 'retained'; });
		await group.getByRole('tab', { name: 'Metadata', exact: true }).click();
		await expect(historyContent).toBeHidden();
		await expect(metadataContent).toBeVisible();
		await expect(historyContent).toHaveAttribute('data-mount-probe', 'retained');
		expect((await requiredBounds(group)).height).toBeCloseTo((await requiredBounds(rightDock)).height, 0);

		await page.reload();
		await waitForEditor(page);
		const restoredGroup = editor.locator(
			'[data-panel-dock="right"] [data-workspace-panel-group]:has([data-workspace-tab-panel="metadata"])',
		);
		await expect(restoredGroup.getByRole('tab', { name: 'Metadata', exact: true })).toHaveAttribute('aria-selected', 'true');

		await closeWorkspacePanel(editor, 'metadata');
		await expect(editor.locator('[data-workspace-tab-panel="history"]')).toBeVisible();
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		const reopened = editor.locator('[data-panel-dock="right"] [data-workspace-panel="metadata"]');
		await expect(reopened.getByRole('tab', { name: 'Metadata', exact: true })).toHaveAttribute('aria-selected', 'true');
		await expect(reopened.getByRole('tab', { name: 'History', exact: true })).toHaveAttribute('aria-selected', 'false');
	});

	test('top panels share tabs across the row, reorder by keyboard, and persist dock resizing', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await openHistoryAndMetadata(page, editor);
		await dockWorkspacePanel(editor, 'history', 'top');
		await dockWorkspacePanel(editor, 'metadata', 'top');
		const dock = editor.locator('[data-panel-dock="top"]');
		const history = editor.locator('[data-workspace-panel="history"]');
		const metadata = editor.locator('[data-workspace-panel="metadata"]');
		const historyHandle = history.locator('[data-workspace-panel-drag-handle="history"]');
		await historyHandle.press('ArrowRight');
		await expect.poll(() => frameOrder(dock)).toEqual(['metadata', 'history']);
		await historyHandle.press('ArrowLeft');
		await expect.poll(() => frameOrder(dock)).toEqual(['history', 'metadata']);
		await dragPanel(metadata, history, 'tab', 'top');
		const group = dock.locator('[data-workspace-panel-group]');
		await expect(group).toHaveCount(1);
		await expect(group.getByRole('tab', { name: 'Metadata', exact: true })).toHaveAttribute('aria-selected', 'true');
		await expect(group.locator('[data-workspace-tab-panel="history"]')).toBeHidden();
		expect((await requiredBounds(group)).width).toBeCloseTo((await requiredBounds(dock)).width, 0);
		const resizeHandle = dock.locator('[data-workspace-dock-resize-handle="top"]');
		const before = await frameHeight(dock);
		await resizeHandle.press('ArrowDown');
		await expect.poll(() => frameHeight(dock)).toBeCloseTo(before + 16, 0);
		await resizeHandle.press('Shift+ArrowUp');
		await expect.poll(() => frameHeight(dock)).toBeCloseTo(before - 32, 0);
		const handleBounds = await requiredBounds(resizeHandle);
		await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + 5);
		await page.mouse.down();
		await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + 45, { steps: 5 });
		await page.mouse.up();
		const resizedHeight = await frameHeight(dock);
		expect(resizedHeight).toBeGreaterThan(before - 16);
		await expect(group).toHaveAttribute('data-workspace-panel-size', String(Math.round(resizedHeight)));
		await page.reload();
		await waitForEditor(page);
		await expect(group.getByRole('tab', { name: 'Metadata', exact: true })).toHaveAttribute('aria-selected', 'true');
		expect(await frameHeight(dock)).toBeCloseTo(resizedHeight, 0);
	});

	test('bottom panels split through horizontal thirds and remain arrangeable through the panel menu', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await openHistoryAndMetadata(page, editor);
		await dockWorkspacePanel(editor, 'history', 'bottom');
		await dockWorkspacePanel(editor, 'metadata', 'bottom');
		const bottomDock = editor.locator('[data-panel-dock="bottom"]');
		const history = () => editor.locator('[data-workspace-panel="history"]');
		const metadata = () => editor.locator('[data-workspace-panel="metadata"]');
		await expect.poll(() => frameOrder(bottomDock)).toEqual(['history', 'metadata']);

		const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
		const historyBounds = await requiredBounds(history());
		const metadataHandle = metadata().locator('[data-workspace-panel-drag-handle="metadata"]');
		await metadataHandle.dispatchEvent('dragstart', { dataTransfer });
		await expect(editor.locator('[data-workspace-drop-target="bottom"]')).toBeHidden();
		await history().dispatchEvent('dragover', {
			dataTransfer,
			clientX: historyBounds.x + 4,
			clientY: historyBounds.y + historyBounds.height / 2,
		});
		await expect(history()).toHaveAttribute('data-workspace-drop-intent', 'before');
		const bottomPreview = await requiredBounds(history().locator('.kw-audio-editor__workspace-panel-drop-preview'));
		expect(bottomPreview.width).toBeCloseTo(historyBounds.width / 2, 0);
		await metadataHandle.dispatchEvent('dragend', { dataTransfer });

		await dragPanel(metadata(), history(), 'before', 'bottom');
		await expect.poll(() => frameOrder(bottomDock)).toEqual(['metadata', 'history']);
		await dragPanel(metadata(), history(), 'after', 'bottom');
		await expect.poll(() => frameOrder(bottomDock)).toEqual(['history', 'metadata']);
		await dragPanel(metadata(), history(), 'tab', 'bottom');
		await expect(bottomDock.locator('[data-workspace-panel-group]')).toHaveCount(1);
		await expect(metadata().getByRole('tab', { name: 'Metadata', exact: true })).toHaveAttribute('aria-selected', 'true');

		const groupedMenu = await openWorkspacePanelMenu(editor, 'metadata');
		const groupedArrange = groupedMenu.getByRole('menuitem', { name: /^Arrange panel/u });
		await groupedArrange.press('ArrowRight');
		const groupedTargets = groupedArrange.getByRole('menu');
		const groupedTarget = groupedTargets.getByRole('menuitem', { name: /History.*Metadata.*Bottom/u }).first();
		await groupedTarget.press('ArrowRight');
		const groupedPlacements = groupedTarget.getByRole('menu');
		await expect(groupedPlacements.getByRole('menuitem', { name: 'As tab', exact: true })).toBeDisabled();
		await groupedPlacements.getByRole('menuitem', { name: 'After', exact: true }).press('Enter');
		await expect.poll(() => frameOrder(bottomDock)).toEqual(['history', 'metadata']);

		await arrangePanelAsTab(editor, 'metadata', /History.*Bottom/u);
		await expect(bottomDock.locator('[data-workspace-panel-group]')).toHaveCount(1);
		await expect(metadata().getByRole('tab', { name: 'Metadata', exact: true })).toHaveAttribute('aria-selected', 'true');
	});

	test('a tab group keeps panel-specific frame geometry while its active tab changes', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'History']);
		const effects = await openEffectsForTrack(editor, 0);
		const rightDock = editor.locator('[data-panel-dock="right"]');
		if (!await rightDock.locator('[data-workspace-panel="history"]').isVisible()) {
			await dockWorkspacePanel(editor, 'history', 'right');
		}
		if (!await rightDock.locator('[data-workspace-panel="effects"]').isVisible()) {
			await dockWorkspacePanel(editor, 'effects', 'right');
		}
		const history = editor.locator('[data-workspace-panel="history"]');
		await dragPanel(effects, history, 'tab', 'side');

		const group = editor.locator(
			'[data-panel-dock="right"] [data-workspace-panel-group]:has([data-workspace-tab-panel="effects"])',
		);
		await expect(group.getByRole('tab', { name: 'Effects', exact: true })).toHaveAttribute('aria-selected', 'true');
		const effectsHeight = await frameHeight(group);
		await group.getByRole('tab', { name: 'History', exact: true }).click();
		await expect(group.getByRole('tab', { name: 'History', exact: true })).toHaveAttribute('aria-selected', 'true');
		expect(await frameHeight(group)).toBeCloseTo(effectsHeight, 0);
	});
});

async function openHistoryAndMetadata(page, editor) {
	await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'History']);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const history = editor.locator('[data-workspace-panel="history"]');
	if (!await history.isVisible()) await chooseNestedCommandAction(page, editor, 'View', ['Panels', 'History']);
	await expect(history).toBeVisible();
	await expect(editor.locator('[data-workspace-panel="metadata"]')).toBeVisible();
}

async function dragPanel(source, target, intent, orientation) {
	const targetBounds = await requiredBounds(target);
	const position = intent === 'before' ? 1 / 6 : intent === 'after' ? 5 / 6 : 1 / 2;
	const targetPosition = orientation === 'top' || orientation === 'bottom'
		? { x: targetBounds.width * position, y: targetBounds.height / 2 }
		: { x: targetBounds.width / 2, y: targetBounds.height * position };
	const panelId = await source.getAttribute('data-workspace-panel');
	const handle = source.locator(`[data-workspace-panel-drag-handle="${panelId}"]`);
	if (orientation !== 'side') {
		await handle.dragTo(target, { targetPosition });
		return;
	}
	// Chromium's native drag interception can stall when moving over a
	// scrollable metadata form. Send the same HTML drag events the previews use.
	const dataTransfer = await source.page().evaluateHandle(() => new DataTransfer());
	await handle.dispatchEvent('dragstart', { dataTransfer });
	const event = {
		dataTransfer,
		clientX: targetBounds.x + targetPosition.x,
		clientY: targetBounds.y + targetPosition.y,
	};
	await target.dispatchEvent('dragover', event);
	await target.dispatchEvent('drop', event);
	await handle.dispatchEvent('dragend', { dataTransfer });
	await dataTransfer.dispose();
}

async function arrangePanelAsTab(editor, panelId, targetName) {
	const menu = await openWorkspacePanelMenu(editor, panelId);
	const arrange = menu.getByRole('menuitem', { name: /^Arrange panel/u });
	await arrange.press('ArrowRight');
	const target = arrange.getByRole('menu').getByRole('menuitem', { name: targetName }).first();
	await target.press('ArrowRight');
	await target.getByRole('menu').getByRole('menuitem', { name: 'As tab', exact: true }).press('Enter');
}

async function frameOrder(dock) {
	return dock.locator(':scope > [data-workspace-panel-group]').evaluateAll((frames) => (
		frames.map((frame) => frame.dataset.workspacePanel)
	));
}

async function requiredBounds(locator) {
	const bounds = await locator.boundingBox();
	expect(bounds).not.toBeNull();
	return bounds;
}

async function frameHeight(locator) {
	return (await requiredBounds(locator)).height;
}
