/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeWorkspacePanel, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

for (const member of ['audio', 'video']) test(`Move selection into folder wraps the camera block from its ${member} menu`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('folder-camera.webm')]);
	await closeWorkspacePanel(editor, 'video-preview');
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	const audio = editor.getByRole('group', { name: /Audio clip/u });
	const video = editor.getByRole('group', { name: /^Video clip:/u });
	await expect(audio).toBeVisible();
	await expect(video).toBeVisible();
	const track = (member === 'audio' ? audio : video).locator('xpath=ancestor::div[@data-track-row]');
	await chooseTrackMenuAction(page, editor, track, 'Move selection into new folder');
	await expect(editor.locator('[data-track-folder-row]')).toHaveCount(1);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-track-folder-row]')).toHaveCount(0);
	await expect(audio).toBeVisible();
	await expect(video).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	const folder = editor.locator('[data-track-folder-row]');
	await expect(folder).toHaveCount(1);
	await folder.getByRole('button', { name: 'Collapse folder', exact: true }).click();
	await expect(audio).toHaveCount(0);
	await expect(video).toHaveCount(0);
	await folder.getByRole('button', { name: 'Expand folder', exact: true }).click();
	await expect(audio).toBeVisible();
	await expect(video).toBeVisible();
	await expect(editor).toHaveAttribute('data-clip-count', '2');
});
