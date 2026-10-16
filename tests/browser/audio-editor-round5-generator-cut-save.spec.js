/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, closeWorkspacePanel, chooseFileAction } from './audio-editor-test-helpers.js';

test('a cut Title can be saved before pasting it back', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await closeWorkspacePanel(editor, 'video-preview');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoTitle']]);
	const clips = editor.getByRole('group', { name: 'Video clip: Title', exact: true });
	await expect(clips).toHaveCount(1);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	await clips.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Cut', 'Cut']);
	await expect(clips).toHaveCount(0);
	await expect(editor.getByRole('alert')).toHaveCount(0);
	await chooseFileAction(page, editor, 'Save project');
	await expect(editor.getByRole('alert')).toHaveCount(0);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(clips).toHaveCount(1);
	await expect(editor.getByRole('alert')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clips).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clips).toHaveCount(1);
});
