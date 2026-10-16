/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('Manage labels retains its unfinished composed title until ordinary confirmation', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await chooseCommandAction(page, editor, 'Edit', 'Manage labels');
	const panel = editor.locator('[data-workspace-panel="labels"]');
	await panel.getByRole('button', { name: 'New label', exact: true }).click();
	const title = panel.getByRole('textbox', { name: /^Label title:/u });
	await title.fill('Original');
	await title.press('Enter');
	await expect(editor.getByRole('group', { name: 'Edit labels: Original', exact: true })).toBeVisible();
	await title.fill('とう');
	const prevented = await title.evaluate(input => {
		const event = new KeyboardEvent('keydown', {
			key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, isComposing: true,
		});
		input.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(prevented).toBe(false);
	await expect(title).toBeFocused();
	await expect(editor.getByRole('group', { name: 'Edit labels: Original', exact: true })).toBeVisible();
	await title.fill('東京の録音');
	await title.press('Enter');
	await expect(editor.getByRole('group', { name: 'Edit labels: 東京の録音', exact: true })).toBeVisible();
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(title).toHaveValue('Original');
});
