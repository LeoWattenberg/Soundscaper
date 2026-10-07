/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction } from './audio-editor-test-helpers.js';

test('an ordinary SubRip saved with Western ANSI encoding retains accented caption text', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	// Subtitle Edit: Encoding → ANSI/Windows-1252, File → Save as → SubRip.
	const buffer = Buffer.from('1\r\n00:00:00,100 --> 00:00:00,500\r\nÉlodie au café\r\n\r\n', 'latin1');
	await chooseFileAction(page, editor, 'Import');
	await editor.locator('[data-import-input]').setInputFiles({ name: 'western-captions.srt', mimeType: 'application/x-subrip', buffer });
	const cue = editor.locator('[data-label-track] .audio-editor-label-marker');
	await expect(cue).toHaveCount(1);
	await expect(cue).toContainText('Élodie au café');
});
