/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker } from './audio-editor-test-helpers.js';

for (const closed of [false, true]) {
	test(`Caption Tracks imports a normal ${closed ? 'closed' : 'abbreviated'} WebVTT voice file`, async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/framescaper/en/');
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
		let dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
		// Subtitle Edit: text <v John><i>thinking...</i></v>; File → Save as → WebVTT.
		const text = `WEBVTT\r\n\r\n00:00:01.000 --> 00:00:03.000\r\n<v John><i>Thinking about the interview.</i>${closed ? '</v>' : ''}\r\n`;
		await dialog.locator('[data-framescaper-caption-file]').setInputFiles({
			name: 'interview.vtt', mimeType: 'text/vtt', buffer: Buffer.from(text),
		});
		await expect(dialog.getByRole('status')).toHaveText('interview.vtt: 1 interchange loss recorded.');
		const readDocument = async () => JSON.parse(await dialog.getByRole('textbox', {
			name: 'Canonical finishing document', exact: true,
		}).inputValue());
		const imported = (await readDocument())[0];
		expect(imported.cues[0].text).toBe('Thinking about the interview.');
		expect(imported.speakers[0].name).toBe('John');
		expect(imported.styles[0].fontStyle).toBe('italic');
		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
		dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
		expect((await readDocument())[0]).toEqual(imported);
		await dialog.getByRole('combobox', { name: 'Format', exact: true }).selectOption('webvtt');
		const downloading = page.waitForEvent('download');
		await dialog.getByRole('button', { name: 'Export selected track', exact: true }).click();
		const download = await downloading;
		expect(download.suggestedFilename()).toMatch(/\.vtt$/u);
		const exported = await readFile(await download.path(), 'utf8');
		expect(exported).toContain('<v John><i>Thinking about the interview.</i>');
		await dialog.getByRole('textbox', { name: 'Track ID', exact: true }).fill('reopened-captions');
		await dialog.locator('[data-framescaper-caption-file]').setInputFiles({
			name: 'reopened.vtt', mimeType: 'text/vtt', buffer: Buffer.from(exported),
		});
		await expect(dialog.getByRole('status')).toHaveText('reopened.vtt: 1 interchange loss recorded.');
		expect((await readDocument()).find(({ id }) => id === 'reopened-captions').cues[0].text).toBe('Thinking about the interview.');
	});
}
