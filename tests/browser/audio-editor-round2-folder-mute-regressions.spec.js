/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('Unmute all tracks clears folder mute as well as leaf-track mute', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const original = clipByName(editor, toneA.name);
	const track = original.locator('xpath=ancestor::div[@data-track-row][1]');
	await original.locator('.clip-header').click();
	await chooseTrackMenuAction(page, editor, track, 'Move selection into new folder');
	const folder = editor.getByRole('treeitem', { name: 'Folder Folder 1, level 1', exact: true });
	const mute = folder.getByRole('button', { name: 'Mute folder', exact: true });
	await mute.click();
	await expect(mute).toHaveAttribute('aria-pressed', 'true');
	await chooseCommandAction(page, editor, 'Tracks', 'Unmute all tracks');
	await expect(mute).toHaveAttribute('aria-pressed', 'false');
});
