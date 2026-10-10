/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, longTone, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('global clip movement reaches displayed tracks around an ordinarily collapsed folder', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB, longTone]);
	const clip = name => clipByName(editor, name);
	const row = name => clip(name).locator('xpath=ancestor::div[@data-track-row][1]');
	const first = await row(toneA.name).getAttribute('data-track-id');
	const middle = await row(toneB.name).getAttribute('data-track-id');
	const last = await row(longTone.name).getAttribute('data-track-id');
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	await clip(toneA.name).locator('.clip-header').click();
	await playhead.press('Control+ArrowDown');
	await expect(row(toneA.name)).toHaveAttribute('data-track-id', middle);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(row(toneA.name)).toHaveAttribute('data-track-id', first);
	await clip(toneB.name).locator('.clip-header').click();
	await chooseTrackMenuAction(page, editor, row(toneB.name), 'Move selection into new folder');
	const folder = editor.getByRole('treeitem');
	await folder.getByRole('button', { name: 'Collapse folder', exact: true }).click();
	await expect(row(toneB.name)).toHaveCount(0);
	await clip(toneA.name).locator('.clip-header').click();
	await playhead.press('Control+ArrowDown');
	await expect(row(toneA.name)).toHaveAttribute('data-track-id', last);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(row(toneA.name)).toHaveAttribute('data-track-id', first);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(row(toneA.name)).toHaveAttribute('data-track-id', last);
	await playhead.press('Control+ArrowUp');
	await expect(row(toneA.name)).toHaveAttribute('data-track-id', first);
	await folder.getByRole('button', { name: 'Expand folder', exact: true }).click();
	await playhead.press('Control+ArrowDown');
	await expect(row(toneA.name)).toHaveAttribute('data-track-id', middle);
});
