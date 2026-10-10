/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile, unlink } from 'node:fs/promises';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker } from './audio-editor-test-helpers.js';

for (const text of ['The relation is a < b.', 'The relation is a<b.']) test(`Caption Tracks reimports its actual SRT download containing ${JSON.stringify(text)}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/en/');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
	const dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
	const input = dialog.locator('[data-framescaper-caption-file]');
	await input.setInputFiles({ name: 'lecture.vtt', mimeType: 'text/vtt',
		buffer: Buffer.from(`WEBVTT\n\nlecture\n00:00.100 --> 00:00.500\n${text.replaceAll('<', '&lt;')}\n`),
	});
	await expect(dialog.getByRole('status')).toHaveText('lecture.vtt: No interchange losses.');
	const document = dialog.getByRole('textbox', { name: 'Canonical finishing document', exact: true });
	expect(JSON.parse(await document.inputValue())[0].cues[0].text).toBe(text);
	await dialog.getByRole('combobox', { name: 'Format', exact: true }).selectOption('srt');
	const downloading = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Export selected track', exact: true }).click();
	const download = await downloading;
	const path = await download.path();
	let buffer;
	try { buffer = await readFile(path); }
	finally { await unlink(path); }
	expect(buffer.toString('utf8')).toContain(`\n${text}\n`);
	const fileName = download.suggestedFilename();
	await input.setInputFiles({ name: fileName, mimeType: 'application/x-subrip', buffer });
	await expect(dialog.getByRole('status')).toHaveText(`${fileName}: No interchange losses.`);
	expect(JSON.parse(await document.inputValue())[0].cues[0]).toMatchObject({
		text, startFrame: 4_800, endFrame: 24_000,
	});
});
