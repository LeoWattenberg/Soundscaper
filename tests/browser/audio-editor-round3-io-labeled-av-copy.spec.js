/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('Copy labeled audio keeps separate linked pairs for two ordinary labeled excerpts', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createDeterministicAvFixture('camera.webm')]);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await chooseNestedCommandAction(page, editor, 'Window', ['Video preview']);
	await expect(editor.locator('[data-video-preview]')).toHaveCount(0);
	await importFiles(editor, [{ name: 'excerpts.txt', mimeType: 'text/plain',
		buffer: Buffer.from('0.1\t0.2\tFirst excerpt\n0.4\t0.5\tSecond excerpt\n') }]);
	await expect(editor.locator('[data-label-track] .audio-editor-label-marker')).toHaveCount(2);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Labeled audio', 'Copy']);
	await editor.locator('[data-clip-kind="video"] .clip-header').click();
	await editor.getByRole('slider', { name: 'Playhead', exact: true }).press('End');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await expect(editor).toHaveAttribute('data-clip-count', '6');
	await expect(editor.locator('[data-status]')).not.toHaveAttribute('data-state', 'error');
});
