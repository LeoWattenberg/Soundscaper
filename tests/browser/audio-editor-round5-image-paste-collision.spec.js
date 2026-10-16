/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, closeWorkspacePanel } from './audio-editor-test-helpers.js';

test('image Paste replaces its native overlap and restores it with one Undo', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await closeWorkspacePanel(editor, 'video-preview');
	const chooser = page.waitForEvent('filechooser');
	await chooseNestedCommandAction(page, editor, 'Generate', [EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoStill']]);
	await (await chooser).setFiles({ name: 'poster.png', mimeType: 'image/png', buffer: createPngFixture(16) });
	const clips = editor.getByRole('group', { name: 'Image clip: poster', exact: true });
	await expect(clips).toHaveCount(1);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	const original = await clips.getAttribute('data-clip-id');
	expect(original).toBeTruthy();
	await clips.press('Enter');
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(clips).toHaveCount(1);
	await expect(clips).not.toHaveAttribute('data-clip-id', original);
	await expect(editor.getByRole('alert')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clips).toHaveAttribute('data-clip-id', original);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(clips).not.toHaveAttribute('data-clip-id', original);
});
