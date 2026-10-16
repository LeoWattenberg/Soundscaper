/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, closeWorkspacePanel } from './audio-editor-test-helpers.js';

test('splitting a styled Title preserves its opacity on both pieces', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await closeWorkspacePanel(editor, 'video-preview');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoTitle']]);
	const clips = editor.getByRole('group', { name: 'Video clip: Title', exact: true });
	await expect(clips).toHaveCount(1);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	const originalId = await clips.getAttribute('data-clip-id');
	await clips.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Selected Visual Inspector']);
	let dialog = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	await dialog.getByRole('spinbutton', { name: 'Opacity', exact: true }).fill('0.25');
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText('Selected visual updated.');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	const before = await clips.boundingBox();
	expect(before).not.toBeNull();
	await editor.getByRole('button', { name: 'Split tool', exact: true }).click();
	await clips.click({ position: { x: before.width / 2, y: before.height - 10 } });
	await expect(clips).toHaveCount(2);
	await editor.getByRole('button', { name: 'Split tool', exact: true }).click();
	const rightClip = editor.locator(`[role="group"][data-clip-id]:not([data-clip-id="${originalId}"])`);
	await rightClip.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Selected Visual Inspector']);
	dialog = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	await expect(dialog.getByRole('spinbutton', { name: 'Opacity', exact: true })).toHaveValue('0.25');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clips).toHaveCount(1);
	await clips.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Selected Visual Inspector']);
	dialog = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	await expect(dialog.getByRole('spinbutton', { name: 'Opacity', exact: true })).toHaveValue('0.25');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(clips).toHaveCount(2);
	await expect(rightClip).toHaveCount(1);
	await rightClip.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Selected Visual Inspector']);
	await expect(page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true })
		.getByRole('spinbutton', { name: 'Opacity', exact: true })).toHaveValue('0.25');
});
