/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

for (const touching of [false, true]) test(`Detach at silences works across ${touching ? 'touching' : 'one'} ordinary caption label`, async ({ page }) => {
	const recording = createWavFixture({ name: 'Interview.wav', frequency: 440, duration: 1, channelCount: 1 });
	recording.buffer.fill(0, 44 + 9_600 * 2, 44 + 28_800 * 2);
	const captions = { name: 'Interview.srt', mimeType: 'text/plain', buffer: Buffer.from(touching
		? '1\n00:00:00,150 --> 00:00:00,400\nFirst\n\n2\n00:00:00,400 --> 00:00:00,650\nSecond\n\n'
		: '1\n00:00:00,150 --> 00:00:00,650\nInterview\n\n') };
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [recording, captions]);
	await expect(editor.locator('[data-label-track] .audio-editor-label-marker')).toHaveCount(touching ? 2 : 1);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Labeled audio', 'Detach at silences']);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
});
