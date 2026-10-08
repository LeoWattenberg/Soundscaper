/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseNestedCommandAction, closeWorkspacePanel,
} from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { importFiles } from './audio-editor-test-helpers.js';

test('ordinary Title Copy and Paste overwrites its native collision in one Undo', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await closeWorkspacePanel(editor, 'video-preview');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoTitle']]);
	const clips = editor.getByRole('group', { name: 'Video clip: Title', exact: true });
	await expect(clips).toHaveCount(1);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	const originalId = await clips.getAttribute('data-clip-id');
	expect(originalId).toBeTruthy();
	await clips.press('Enter');
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(clips).toHaveCount(1);
	await expect(clips).not.toHaveAttribute('data-clip-id', originalId);
	await expect(editor.getByRole('alert')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clips).toHaveCount(1);
	await expect(clips).toHaveAttribute('data-clip-id', originalId);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(clips).toHaveCount(1);
	await expect(clips).not.toHaveAttribute('data-clip-id', originalId);
});

// The established camera path supplies the collision contract for generated pictures.
test('the existing camera Paste replaces the original video at the same cursor', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await closeWorkspacePanel(editor, 'video-preview');
	await importFiles(editor, [createDeterministicAvFixture('paste-camera.webm')]);
	const video = editor.getByRole('group', { name: /^Video clip:/u });
	await expect(video).toHaveCount(1);
	const originalId = await video.getAttribute('data-clip-id');
	expect(originalId).toBeTruthy();
	await video.press('Enter');
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(video).toHaveCount(1);
	await expect(video).not.toHaveAttribute('data-clip-id', originalId);
	await expect(editor.getByRole('alert')).toHaveCount(0);
});
