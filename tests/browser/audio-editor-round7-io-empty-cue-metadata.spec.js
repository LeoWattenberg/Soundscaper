/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction } from './audio-editor-test-helpers.js';

test('CUE import accepts an unnamed first track beside an ordinary named track', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	// K3b writes both quoted fields when a track has either title or performer.
	const sheet = 'REM Cue file written by K3b\n\nPERFORMER "Presenter"\nTITLE ""\nFILE "Programme.wav" WAVE\n  TRACK 01 AUDIO\n    PERFORMER "Presenter"\n    TITLE ""\n    INDEX 01 00:00:00\n  TRACK 02 AUDIO\n    PERFORMER ""\n    TITLE "Interview"\n    INDEX 01 00:00:20\n';
	const picking = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Import');
	await (await picking).setFiles({ name: 'Programme.cue', mimeType: 'application/x-cue', buffer: Buffer.from(sheet) });
	const dialog = page.getByRole('dialog', { name: 'Import', exact: true });
	await dialog.getByRole('button', { name: 'Labels', exact: true }).click();
	await expect(editor.locator('[data-label-track] [data-label-id]')).toHaveCount(2);
	await expect(editor.locator('[data-label-id]').nth(0)).toContainText('Track 01');
	await expect(editor.locator('[data-label-id]').nth(1)).toContainText('Interview');
});
