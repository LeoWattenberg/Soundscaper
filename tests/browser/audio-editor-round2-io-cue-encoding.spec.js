/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction } from './audio-editor-test-helpers.js';

test('a normal Windows ANSI CUE sheet imports its German track titles', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	// CUETools writes the Windows system encoding when all text fits it and
	// "always write UTF-8" is off. These titles fit German Windows-1252.
	const sheet = 'TITLE "Frühlingskonzert"\r\nPERFORMER "René Müller"\r\nFILE "concert.wav" WAVE\r\n  TRACK 01 AUDIO\r\n    TITLE "Ouvertüre"\r\n    INDEX 01 00:00:00\r\n  TRACK 02 AUDIO\r\n    TITLE "Straße zum Café"\r\n    INDEX 01 00:01:00\r\n';
	const picking = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Import');
	await (await picking).setFiles({ name: 'concert.cue', mimeType: 'application/x-cue', buffer: Buffer.from(sheet, 'latin1') });
	const dialog = page.getByRole('dialog', { name: 'Import', exact: true });
	await dialog.getByRole('button', { name: 'Labels', exact: true }).click();
	await expect(editor.locator('[data-label-track] [data-label-id]')).toHaveCount(2);
	await expect(editor.locator('[data-label-track]')).toContainText('Frühlingskonzert');
	await expect(editor.locator('[data-label-id]').nth(0)).toContainText('Ouvertüre');
	await expect(editor.locator('[data-label-id]').nth(1)).toContainText('Straße zum Café');
});
