/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('a refused locked Cut preserves the previous clipboard for the next writable Paste', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone, toneA]);
	const source = clipByName(editor, monoTone.name);
	const protectedClip = clipByName(editor, toneA.name);
	await source.locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await protectedClip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(editor).toHaveAttribute('data-clip-count', '3');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await protectedClip.locator('.clip-header').click();
	const track = protectedClip.locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, track, 'Lock track');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Cut', 'Cut and leave gap']);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(protectedClip).toBeVisible();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(editor).toHaveAttribute('data-clip-count', '3');
	await expect(clipByName(editor, monoTone.name)).toHaveCount(2);
	await expect(clipByName(editor, toneA.name)).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(clipByName(editor, monoTone.name)).toHaveCount(2);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await chooseTrackMenuAction(page, editor, track, 'Unlock track');
	await protectedClip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Cut', 'Cut and leave gap']);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(clipByName(editor, toneA.name)).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(clipByName(editor, toneA.name)).toHaveCount(1);
});
