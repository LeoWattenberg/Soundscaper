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
	const targetPosition = orientation === 'bottom'
		? { x: intent === 'before' ? 4 : intent === 'after' ? targetBounds.width - 4 : targetBounds.width / 2, y: targetBounds.height / 2 }
		: { x: targetBounds.width / 2, y: intent === 'before' ? 4 : intent === 'after' ? targetBounds.height - 4 : targetBounds.height / 2 };
	const panelId = await source.getAttribute('data-workspace-panel');
	await source.locator(`[data-workspace-panel-drag-handle="${panelId}"]`).dragTo(target, { targetPosition });
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
