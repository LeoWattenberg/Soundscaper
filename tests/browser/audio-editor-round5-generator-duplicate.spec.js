/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseNestedCommandAction, closeWorkspacePanel,
} from './audio-editor-test-helpers.js';

test('Edit Duplicate creates an independent picture track for a generated Title', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await closeWorkspacePanel(editor, 'video-preview');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoTitle']]);
	const clips = editor.getByRole('group', { name: 'Video clip: Title', exact: true });
	await expect(clips).toHaveCount(1);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	const tracks = Number(await editor.getAttribute('data-track-count'));
	await clips.press('Enter');
	await chooseCommandAction(page, editor, 'Edit', 'Duplicate');
	await expect(clips).toHaveCount(2);
	await expect(editor).toHaveAttribute('data-track-count', String(tracks + 1));
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clips).toHaveCount(1);
	await expect(editor).toHaveAttribute('data-track-count', String(tracks));
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(clips).toHaveCount(2);
});

