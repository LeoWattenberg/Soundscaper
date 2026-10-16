/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('Skip to selection end reaches a normally selected Title without first drawing a range', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Title/Text']);
	const clip = editor.getByRole('group', { name: 'Video clip: Title', exact: true });
	await expect(clip).toBeVisible();
	await clip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Select', ['Region', 'Track start to end']);
	await chooseNestedCommandAction(page, editor, 'View', ['Skip to', 'Selection end']);
	await expect(editor.locator('[data-sequence-timecode]')).toHaveAttribute('data-sequence-timecode', '00:00:05:00');
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	await editor.getByRole('slider', { name: 'Playhead', exact: true }).press('Home');
	await expect(editor.locator('[data-sequence-timecode]')).toHaveAttribute('data-sequence-timecode', '00:00:00:00');
	await clip.locator('.clip-header').click();
	await expect(clip.locator('.clip-display')).toHaveClass(/clip-display--selected/u);
	await chooseNestedCommandAction(page, editor, 'View', ['Skip to', 'Selection end']);
	await expect(editor.locator('[data-sequence-timecode]')).toHaveAttribute('data-sequence-timecode', '00:00:05:00');
});
