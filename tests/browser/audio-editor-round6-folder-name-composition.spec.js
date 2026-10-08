/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('track folder renaming retains native composition until ordinary confirmation', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseTrackMenuAction(page, editor, editor.locator('[data-track-row]').first(), 'Move selection into new folder');
	const folder = editor.getByRole('treeitem');
	const originalLabel = await folder.getAttribute('aria-label');
	await folder.focus();
	await folder.press('F2');
	const input = editor.getByRole('textbox', { name: 'Rename folder', exact: true });
	await input.fill('とう');
	const prevented = await input.evaluate(field => {
		const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, isComposing: true });
		field.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(prevented).toBe(false);
	await expect(input).toBeFocused();
	await expect(folder).toHaveAttribute('aria-label', originalLabel);
	await input.fill('東京の場面');
	await input.press('Enter');
	await expect(input).toHaveCount(0);
	await expect(folder).toHaveAttribute('aria-label', 'Folder 東京の場面, level 1');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(folder).toHaveAttribute('aria-label', originalLabel);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(folder).toHaveAttribute('aria-label', 'Folder 東京の場面, level 1');
});
