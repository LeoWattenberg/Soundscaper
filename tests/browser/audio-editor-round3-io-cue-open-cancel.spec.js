/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction, importFiles } from './audio-editor-test-helpers.js';

const albumCue = { name: 'album.cue', mimeType: 'application/x-cue',
	buffer: Buffer.from('FILE "album.wav" WAVE\n  TRACK 01 AUDIO\n    TITLE "Introduction"\n    INDEX 01 00:00:00\n') };

test('Cancel while choosing a CUE destination leaves the existing project and tabs unchanged', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const projectId = await editor.getAttribute('data-project-id');
	const tabs = editor.getByRole('navigation', { name: 'Project tabs' }).getByRole('tab');
	const originalTabCount = await tabs.count();
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles(albumCue);
	const dialog = page.locator('[data-cue-import-choice]');
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(editor).toHaveAttribute('data-project-id', projectId);
	await expect(tabs).toHaveCount(originalTabCount);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});

test('choosing Markers opens the CUE in its named new project without changing the original audio', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const originalId = await editor.getAttribute('data-project-id');
	const originalTab = editor.getByRole('navigation', { name: 'Project tabs' }).getByRole('tab').first();
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles(albumCue);
	const dialog = page.locator('[data-cue-import-choice]');
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Markers', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(editor).not.toHaveAttribute('data-project-id', originalId);
	await expect(editor.locator('[data-project-name]')).toHaveText('album');
	await chooseCommandAction(page, editor, 'Window', 'Markers');
	const markers = editor.getByRole('list', { name: 'Marker and region list' }).getByRole('listitem');
	await expect(markers).toHaveCount(1);
	await expect(markers).toContainText('Introduction');
	await originalTab.click();
	await expect(editor).toHaveAttribute('data-project-id', originalId);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});
