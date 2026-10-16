/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('Caption Tracks imports an authored WebVTT transcript with header text, notes, and timing whitespace', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Caption Tracks']);
	const dialog = page.getByRole('dialog', { name: 'Caption Tracks', exact: true });
	await dialog.locator('[data-framescaper-caption-file]').setInputFiles({
		name: 'interview.vtt', mimeType: 'text/vtt',
		buffer: Buffer.from('WEBVTT Interview transcript\n\nNOTE Reviewed on Friday\n\nhello\n00:00.100\t-->  00:00.500\nHello there.\n\nNOTE End of introduction\n'),
	});
	await expect(dialog.getByRole('status')).toHaveText('interview.vtt: No interchange losses.');
	const tracks = JSON.parse(await dialog.getByRole('textbox', { name: 'Canonical finishing document', exact: true }).inputValue());
	expect(tracks[0].cues).toHaveLength(1);
	expect(tracks[0].cues[0]).toMatchObject({ id: 'hello', startFrame: 4800, endFrame: 24000, text: 'Hello there.' });
});
