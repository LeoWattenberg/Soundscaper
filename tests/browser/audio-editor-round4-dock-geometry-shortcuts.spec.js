/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, dockWorkspacePanel } from './audio-editor-test-helpers.js';

test('modified commands leave dock geometry unchanged while plain arrows resize it', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const row = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await row.getByRole('textbox').first().fill('Ctrl+Alt+Up');
	await row.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(row.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseCommandAction(page, editor, 'Window', 'History');
	await dockWorkspacePanel(editor, 'history', 'bottom');
	const dock = editor.locator('[data-panel-dock="bottom"]');
	const resize = dock.locator('[data-workspace-dock-resize-handle="bottom"]');
	const height = (await dock.boundingBox()).height;
	await resize.focus();
	await resize.press('Control+Alt+ArrowUp');
	await expect.poll(async () => (await dock.boundingBox()).height).toBe(height);
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await resize.press('ArrowUp');
	await expect.poll(async () => (await dock.boundingBox()).height).toBe(height + 16);
	await dockWorkspacePanel(editor, 'history', 'floating');
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	await dockWorkspacePanel(editor, 'metadata', 'floating');
	const history = editor.locator('[data-workspace-panel="history"]');
	const position = await history.getAttribute('data-workspace-panel-y');
	const move = history.locator('[data-workspace-panel-drag-handle="history"]');
	await move.focus();
	await move.press('Control+Alt+ArrowUp');
	await expect(history).toHaveAttribute('data-workspace-panel-y', position);
	await expect(history).toBeVisible();
	await expect(editor.locator('[data-label-track]')).toHaveCount(2);
	const floatingHeight = await history.getAttribute('data-workspace-panel-height');
	const floatingResize = history.locator('[data-floating-panel-resize-handle="history"]');
	await floatingResize.focus();
	await floatingResize.press('Control+Alt+ArrowUp');
	await expect(history).toHaveAttribute('data-workspace-panel-height', floatingHeight);
	await expect(editor.locator('[data-label-track]')).toHaveCount(3);
});
