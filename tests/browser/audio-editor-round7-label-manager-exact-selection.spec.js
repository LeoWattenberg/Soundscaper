/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles, showToolbarButton } from './audio-editor-test-helpers.js';

test('Manage labels Select preserves its authored region when Snap is enabled', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Edit', 'Add label');
	const title = editor.getByRole('textbox', { name: /^Edit labels:/u });
	await title.fill('Authored region');
	await title.press('Enter');
	await chooseCommandAction(page, editor, 'Edit', 'Manage labels');
	const panel = editor.locator('[data-workspace-panel="labels"]');
	await expect(panel.locator('.timecode__display').last()).toHaveText('00h00m00.800s');
	const select = panel.getByRole('button', { name: 'Time selection', exact: true });
	const end = editor.getByRole('group', { name: 'Selection end', exact: true }).last().locator('.timecode__display');
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	await select.click();
	await expect(end).toHaveText('00h00m00.800s');
	await showToolbarButton(page, editor, 'Snap');
	await editor.getByRole('checkbox', { name: 'Snap', exact: true }).check();
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	await select.click();
	await expect(end).toHaveText('00h00m00.800s');
	await expect(panel.locator('.timecode__display').last()).toHaveText('00h00m00.800s');
});
