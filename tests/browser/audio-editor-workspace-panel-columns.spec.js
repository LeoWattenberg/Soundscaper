/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseNestedCommandAction, openWorkspacePanelMenu,
	registerAudioEditorHooks, waitForEditor,
} from './audio-editor-test-helpers.js';

test.describe('Workspace panel columns', () => {
	registerAudioEditorHooks();

	test('default meters fill adjacent columns and retain their layout on reload', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
		const playback = editor.locator('[data-workspace-panel="playback-meter"]');
		const recording = editor.locator('[data-workspace-panel="recording-meter"]');
		await expect(recording).toBeVisible();
		const assertAdjacent = async () => {
			const [left, right] = await Promise.all([playback.boundingBox(), recording.boundingBox()]);
			expect(left).not.toBeNull();
			expect(right).not.toBeNull();
			expect(Math.abs(right.x - left.x - left.width)).toBeLessThanOrEqual(1);
			expect(right.y).toBeCloseTo(left.y, 0);
			expect(right.height).toBeCloseTo(left.height, 0);
			expect(left.width).toBeLessThan(100);
			expect(left.height).toBeGreaterThan(300);
		};
		await assertAdjacent();
		await page.reload();
		await waitForEditor(page);
		await assertAdjacent();
		await page.setViewportSize({ width: 390, height: 844 });
		await assertAdjacent();
	});

	test('panel menus create columns, dragging stacks within a column, and dock resizing persists', async ({ page }) => {
		await page.setViewportSize({ width: 1600, height: 1000 });
		const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
		for (const [id, label] of [['playback-meter', 'Playback meter'], ['recording-meter', 'Recording meter']]) {
			if (await editor.locator(`[data-workspace-panel="${id}"]`).isVisible()) await chooseNestedCommandAction(page, editor, 'Window', [label]);
		}
		await chooseNestedCommandAction(page, editor, 'Window', ['History']);
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		const dock = editor.locator('[data-panel-dock="right"]');
		const history = editor.locator('[data-workspace-panel="history"]');
		const metadata = editor.locator('[data-workspace-panel="metadata"]');
		const menu = await openWorkspacePanelMenu(editor, 'metadata');
		const arrange = menu.getByRole('menuitem', { name: /^Arrange panel/u });
		await arrange.press('ArrowRight');
		const target = arrange.getByRole('menu').getByRole('menuitem', { name: /^History/u }).first();
		await target.press('ArrowRight');
		await target.getByRole('menu').getByRole('menuitem', { name: 'Right', exact: true }).press('Enter');
		await expect(dock.locator('[data-workspace-panel-column]')).toHaveCount(2);
		const [left, right] = await Promise.all([history.boundingBox(), metadata.boundingBox()]);
		expect(Math.abs(right.x - left.x - left.width)).toBeLessThanOrEqual(1);
		expect(right.y).toBeCloseTo(left.y, 0);
		const width = (await dock.boundingBox()).width;
		await dock.locator('[data-workspace-dock-resize-handle="right"]').press('ArrowLeft');
		await expect.poll(async () => (await dock.boundingBox()).width).toBeGreaterThan(width + 10);
		const resized = (await dock.boundingBox()).width;
		await page.reload();
		await waitForEditor(page);
		expect((await dock.boundingBox()).width).toBeCloseTo(resized, 0);
		await metadata.locator('[data-workspace-panel-drag-handle="metadata"]').dragTo(history, {
			targetPosition: { x: (await history.boundingBox()).width / 2, y: 4 },
		});
		await expect(dock.locator('[data-workspace-panel-column]')).toHaveCount(1);
		await expect.poll(async () => (await metadata.boundingBox()).y).toBeLessThan((await history.boundingBox()).y);
	});

	test('dragging to a side edge previews and creates a column beside an existing panel', async ({ page }) => {
		await page.setViewportSize({ width: 1600, height: 1000 });
		const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
		for (const [id, label] of [['playback-meter', 'Playback meter'], ['recording-meter', 'Recording meter']]) {
			if (await editor.locator(`[data-workspace-panel="${id}"]`).isVisible()) await chooseNestedCommandAction(page, editor, 'Window', [label]);
		}
		await chooseNestedCommandAction(page, editor, 'Window', ['History']);
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		const history = editor.locator('[data-workspace-panel="history"]');
		const metadata = editor.locator('[data-workspace-panel="metadata"]');
		const transfer = await page.evaluateHandle(() => new DataTransfer());
		const handle = metadata.locator('[data-workspace-panel-drag-handle="metadata"]');
		await handle.dispatchEvent('dragstart', { dataTransfer: transfer });
		const bounds = await history.boundingBox();
		const drop = { dataTransfer: transfer, clientX: bounds.x + 4, clientY: bounds.y + bounds.height / 2 };
		await history.dispatchEvent('dragover', drop);
		await expect(history).toHaveAttribute('data-workspace-drop-intent', 'left');
		const preview = await history.locator('.kw-audio-editor__workspace-panel-drop-preview').boundingBox();
		expect(preview.width).toBeCloseTo(bounds.width / 2, 0);
		expect(preview.height).toBeCloseTo(bounds.height, 0);
		await history.dispatchEvent('drop', drop);
		await handle.dispatchEvent('dragend', { dataTransfer: transfer });
		await expect(editor.locator('[data-panel-dock="right"] [data-workspace-panel-column]')).toHaveCount(2);
		expect((await metadata.boundingBox()).x).toBeLessThan((await history.boundingBox()).x);
	});
});
