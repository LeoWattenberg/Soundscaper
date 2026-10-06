/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('Enter applies a Selected Visual Inspector draft through its form', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Solid']);
	const clip = editor.getByRole('group', { name: 'Video clip: Solid', exact: true });
	await expect(clip).toBeVisible();
	await clip.focus();
	await clip.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Selected Visual Inspector']);
	const dialog = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	const opacity = dialog.getByRole('spinbutton', { name: 'Opacity', exact: true });
	await opacity.fill('0.5');
	await opacity.press('Enter');
	await expect(dialog.getByRole('status').last()).toHaveText('Selected visual updated.');
});

test('Video retime refuses an empty exact source-frame draft', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	await importFiles(editor, [createDeterministicAvFixture('retime-input.webm')]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u });
	await expect(clip).toHaveCount(1);
	await clip.focus();
	await clip.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Video retime']);
	const dialog = page.getByRole('dialog', { name: 'Video retime', exact: true });
	await dialog.getByRole('textbox', { name: 'Source frame', exact: true }).fill('');
	await dialog.getByRole('button', { name: 'Apply freeze', exact: true }).click();
	await expect(dialog.getByRole('status').last()).not.toHaveText('Video retime updated.');
	await expect(dialog.getByRole('status').last()).toContainText('safe-integer fraction');
});
