/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('spreadsheet name editing retains native composition until completed confirmation', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Clip spreadsheet']);
	const grid = editor.getByRole('grid', { name: 'Clip spreadsheet', exact: true });
	const cell = grid.locator('[data-row="0"][data-column="name"]');
	await cell.click();
	await cell.press('F2');
	const draft = grid.getByRole('textbox', { name: 'Name', exact: true });
	await draft.fill('とう');
	const prevented = await draft.evaluate(field => {
		const event = new KeyboardEvent('keydown', {
			key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, isComposing: true,
		});
		field.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(prevented).toBe(false);
	await expect(draft).toBeFocused();
	await expect(clipByName(editor, toneA.name)).toBeVisible();
	await draft.fill('東京');
	await draft.press('Enter');
	await expect(clipByName(editor, '東京')).toBeVisible();
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(clipByName(editor, toneA.name)).toBeVisible();
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(clipByName(editor, '東京')).toBeVisible();
});
