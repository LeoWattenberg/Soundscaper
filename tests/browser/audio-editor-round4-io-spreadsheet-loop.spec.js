/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('Clip Spreadsheet speed preserves the repeated content of a normal looped recording', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const clip = clipByName(editor, monoTone.name);
	await clip.locator('.clip-header').click();
	await clip.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
	await expect(clip).toHaveAccessibleName(/1\.6 seconds long$/u);
	await chooseNestedCommandAction(page, editor, 'Window', ['Clip spreadsheet']);
	const grid = editor.locator('[data-workspace-panel="clip-spreadsheet"]').getByRole('grid');
	await expect(grid).toHaveAttribute('aria-busy', 'false');
	await grid.locator('[role="gridcell"][data-row="0"][data-column="speed"]').dblclick();
	const speed = grid.getByRole('textbox', { name: 'Speed (×)', exact: true });
	await speed.fill('1.25');
	await speed.press('Enter');
	await expect(grid).toHaveAttribute('aria-busy', 'false');
	await expect(grid.locator('[role="gridcell"][data-row="0"][data-column="speed"]')).toHaveText('1.25');
	await expect(grid.locator('[role="gridcell"][data-row="0"][data-column="duration"]')).toHaveText('1.28');
	await expect(clip.locator('[data-loop-boundary-frame]')).toHaveCount(1);
	await page.keyboard.press('ControlOrMeta+z');
	await expect(grid.locator('[role="gridcell"][data-row="0"][data-column="duration"]')).toHaveText('1.6');
});
