/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('Clip spreadsheet offers timing edits only for supported authored clips', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const clip = clipByName(editor, monoTone.name);
	await clip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Window', ['Clip spreadsheet']);
	const grid = editor.locator('[data-workspace-panel="clip-spreadsheet"]').getByRole('grid');
	const cell = column => grid.locator(`[role="gridcell"][data-row="0"][data-column="${column}"]`);
	await expect(grid).toHaveAttribute('aria-busy', 'false');
	await cell('duration').dblclick();
	const duration = grid.getByRole('textbox');
	await duration.fill('0.6');
	await duration.press('Enter');
	await expect(cell('duration')).toHaveText('0.6');
	await expect(clip).toHaveAccessibleName(/0\.6 seconds long$/u);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(cell('duration')).toHaveText('0.8');
	await clip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	const warp = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
	await warp.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
	await expect(warp).toContainText('Identity warp map created.');
	await warp.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(cell('duration')).toHaveText('0.8');
	for (const column of ['source', 'offset', 'duration', 'speed', 'reversed']) {
		await expect(cell(column)).toHaveAttribute('aria-readonly', 'true');
	}
	await expect(cell('reversed').getByRole('checkbox')).toBeDisabled();
	const invert = cell('inverted').getByRole('checkbox');
	await expect(invert).toBeEnabled();
	await invert.check();
	await expect(invert).toBeChecked();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(invert).not.toBeChecked();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(cell('duration')).toHaveAttribute('aria-readonly', 'false');
	await cell('duration').dblclick();
	await duration.fill('0.6');
	await duration.press('Enter');
	await expect(cell('duration')).toHaveText('0.6');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(cell('duration')).toHaveText('0.8');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(cell('duration')).toHaveText('0.6');
});
