/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeWorkspacePanel } from './audio-editor-test-helpers.js';

test('search retains native Shift Down text selection before the next command', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const title = editor.locator('[data-metadata-editor] input[name="title"]');
	await title.fill('project');
	await title.press('Home');
	await title.press('Shift+ArrowDown');
	const healthy = await title.evaluate(field => ({ start: field.selectionStart, end: field.selectionEnd }));
	expect(healthy).toEqual({ start: 0, end: 7 });
	await title.press('Escape');
	await closeWorkspacePanel(editor, 'metadata');
	await page.keyboard.press('Control+k');
	const search = editor.locator('[data-editor-search-input]');
	await search.fill('project');
	await search.press('Home');
	const active = await search.getAttribute('aria-activedescendant');
	await search.press('Shift+ArrowDown');
	const selection = await search.evaluate(field => ({ start: field.selectionStart, end: field.selectionEnd }));
	expect(selection).toEqual(healthy);
	await expect(search).toHaveAttribute('aria-activedescendant', active);
	await search.press('Backspace');
	await expect(search).toHaveValue('');
	const clearedActive = await search.getAttribute('aria-activedescendant');
	await search.press('ArrowDown');
	await expect(search).not.toHaveAttribute('aria-activedescendant', clearedActive);
	await search.fill('project-properties');
	await search.press('Enter');
	await expect(editor.locator('[data-workspace-panel="metadata"]')).toBeVisible();
});
