/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker } from './audio-editor-test-helpers.js';

for (const encoding of ['utf8', 'latin1']) {
	test(`Framescaper imports an ordinary ${encoding} SubRip file through Caption Tracks`, async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/framescaper/en/');
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
		const dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
		// Subtitle Edit: Encoding → ANSI/Windows-1252 or UTF-8; Save as → SubRip.
		const text = '1\r\n00:00:00,100 --> 00:00:00,500\r\nÉlodie au café\r\n\r\n';
		await dialog.locator('[data-framescaper-caption-file]').setInputFiles({
			name: 'dialogue.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(text, encoding),
		});
		await expect(dialog.getByRole('status')).toHaveText('dialogue.srt: No interchange losses.');
		const document = JSON.parse(await dialog.getByRole('textbox', {
			name: 'Canonical finishing document', exact: true,
		}).inputValue());
		expect(document[0].cues[0].text).toBe('Élodie au café');
		const downloadPromise = page.waitForEvent('download');
		await dialog.getByRole('button', { name: 'Export selected track', exact: true }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toMatch(/\.srt$/u);
		expect(await readFile(await download.path(), 'utf8')).toContain('Élodie au café');
	});
}
