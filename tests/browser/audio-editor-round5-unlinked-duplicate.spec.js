/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

for (const mode of ['header', 'range']) test(`Duplicate lifts unlinked camera audio onto an independent track for ${mode}`, async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('camera.webm')]);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	const audio = editor.getByRole('group', { name: /^camera Audio clip,/u });
	await audio.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Unlink audio']);
	await audio.press('Enter');
	if (mode === 'range') await chooseNestedCommandAction(page, editor, 'Select', ['Region', 'Track start to end']);
	const tracks = editor.locator('[data-track-row]');
	const count = await tracks.count();
	await chooseCommandAction(page, editor, 'Edit', 'Duplicate');
	await expect(editor).toHaveAttribute('data-clip-count', '3');
	await expect(tracks).toHaveCount(count + 1);
	await expect(editor.getByRole('alert')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(tracks).toHaveCount(count);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor).toHaveAttribute('data-clip-count', '3');
	await expect(tracks).toHaveCount(count + 1);
});
