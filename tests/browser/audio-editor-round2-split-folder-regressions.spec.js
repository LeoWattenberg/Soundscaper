/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

for (const selection of ['clip', 'range']) {
	test(`Split into new track keeps a foldered ${selection} selection inside its folder`, async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const original = clipByName(editor, toneA.name);
		const track = original.locator('xpath=ancestor::div[@data-track-row][1]');
		await original.locator('.clip-header').click();
		await chooseTrackMenuAction(page, editor, track, 'Move selection into new folder');
		if (selection === 'range') {
			await chooseNestedCommandAction(page, editor, 'Select', ['Region', 'Track start to end']);
		} else await editor.getByRole('slider', { name: 'Playhead', exact: true }).press('ArrowRight');
		await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Split into new track']);
		await expect(editor.locator('[data-track-row]')).toHaveCount(3);
		await expect(editor.locator('[data-clip-id]')).toHaveCount(selection === 'clip' ? 2 : 1);
		const folder = editor.getByRole('treeitem', { name: 'Folder Folder 1, level 1', exact: true });
		await folder.getByRole('button', { name: 'Collapse folder', exact: true }).click();
		await expect(editor.locator('[data-clip-id]')).toHaveCount(0);
	});
}
