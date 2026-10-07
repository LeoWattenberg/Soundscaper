/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

for (const mode of ['header', 'range']) test(`unlinked camera audio can lift onto an independent track for ${mode}`, async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('camera.webm')]);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	const audio = editor.getByRole('group', { name: /^camera Audio clip,/u });
	await audio.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Unlink audio']);
	await audio.press('Enter');
	if (mode === 'range') await chooseNestedCommandAction(page, editor, 'Select', ['Region', 'Track start to end']);
	else await editor.getByRole('slider', { name: 'Playhead', exact: true }).press('ArrowRight');
	const tracks = editor.locator('[data-track-row]');
	const originalCount = await tracks.count();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Split into new track']);
	await expect(tracks).toHaveCount(originalCount + 1);
	await expect(editor).toHaveAttribute('data-clip-count', mode === 'header' ? '3' : '2');
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(tracks).toHaveCount(originalCount);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(tracks).toHaveCount(originalCount + 1);
	await expect(editor).toHaveAttribute('data-clip-count', mode === 'header' ? '3' : '2');
});
