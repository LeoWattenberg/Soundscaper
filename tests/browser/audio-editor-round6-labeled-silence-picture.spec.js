/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, closeWorkspacePanel, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('Silence labeled audio preserves its linked camera picture', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('labeled-camera.webm')]);
	await closeWorkspacePanel(editor, 'video-preview');
	const picture = editor.getByRole('group', { name: /^Video clip:/u });
	await expect(picture).toHaveCount(1);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await page.keyboard.press('Control+b');
	await editor.getByRole('textbox', { name: /^Edit labels:/u }).press('Enter');
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Labeled audio', 'Silence audio']);
	await expect(editor.getByRole('group', { name: /^Silence audio clip,/u })).toHaveCount(1);
	await expect(picture).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(picture).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor.getByRole('group', { name: /^Silence audio clip,/u })).toHaveCount(1);
	await expect(picture).toHaveCount(1);
});
