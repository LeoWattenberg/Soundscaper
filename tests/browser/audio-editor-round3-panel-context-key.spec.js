/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('Shift F10 opens the focused workspace panel context menu', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Window', ['Markers']);
	const panel = editor.locator('[data-workspace-panel="markers"]');
	const move = panel.locator('[data-workspace-panel-drag-handle="markers"]');
	await move.focus();
	await page.keyboard.press('Shift+F10');
	const menu = editor.locator('.kw-audio-editor__workspace-panel-menu');
	await expect(menu).toBeVisible();
	await expect(menu.getByRole('menuitem', { name: 'Left', exact: true })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(menu).toHaveCount(0);
	await expect(panel.getByRole('button', { name: 'Panel menu: Markers', exact: true })).toBeFocused();
});
