/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, waitForEditor } from './audio-editor-test-helpers.js';

for (const [action, element, marker] of [['Bold', 'strong', '**'], ['Italic', 'em', '*'], ['Code', 'code', '`']]) {
	test(`${action} preserves two selected notes paragraphs, preview and saved toggle`, async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await chooseNestedCommandAction(page, editor, 'Window', ['Recording notes']);
		const notes = editor.getByRole('textbox', { name: 'Recording notes', exact: true });
		const original = 'First take\n\nPickup notes';
		await notes.fill(original);
		await notes.selectText();
		await editor.getByRole('button', { name: action, exact: true }).click();
		await expect(notes).toHaveValue(`${marker}First take${marker}\n\n${marker}Pickup notes${marker}`);
		await editor.getByRole('button', { name: 'Preview', exact: true }).click();
		const preview = editor.getByRole('region', { name: 'Recording notes preview', exact: true });
		await expect(preview.locator('p')).toHaveCount(2);
		await expect(preview.locator(element)).toHaveText(['First take', 'Pickup notes']);
		await expect(preview).not.toContainText(marker);
		await editor.getByRole('button', { name: 'Edit', exact: true }).click();
		await expect(notes).toBeFocused();
		await editor.getByRole('button', { name: action, exact: true }).click();
		await expect(notes).toHaveValue(original);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload();
		await waitForEditor(page);
		await expect(notes).toHaveValue(original);
	});
}
