/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseFileAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('ordinary libsndfile WAV cue indices become timeline markers', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	// libsndfile's SFC_SET_CUE writes these two ordinary zero-based cue indices.
	const encoded = await readFile(new URL('../fixtures/libsndfile-zero-based-cues.wav.base64', import.meta.url), 'ascii');
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Import');
	await (await choosing).setFiles({ name: 'marked-recording.wav', mimeType: 'audio/wav', buffer: Buffer.from(encoded, 'base64') });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseNestedCommandAction(page, editor, 'Window', ['Markers']);
	const panel = editor.getByRole('region', { name: 'Markers and named regions', exact: true });
	await expect(panel).toBeVisible();
	await expect(panel.getByRole('button', { name: /^Unnamed annotation, Marker,/u })).toHaveCount(2);
	await expect(panel.getByRole('button', { name: 'Unnamed annotation, Marker, 0.025 s', exact: true })).toBeVisible();
	await expect(panel.getByRole('button', { name: 'Unnamed annotation, Marker, 0.050 s', exact: true })).toBeVisible();
	await chooseCommandAction(page, editor, 'View', 'Markers');
	await expect(editor.getByRole('listbox', { name: 'Markers and named regions', exact: true })).toBeVisible();
});
