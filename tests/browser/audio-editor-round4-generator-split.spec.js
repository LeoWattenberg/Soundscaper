/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, closeWorkspacePanel } from './audio-editor-test-helpers.js';

test('Split tool divides a generated Title and Undo restores its complete extent', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	// Keep coverage of timeline edits without paying for exact Title preview renders.
	await closeWorkspacePanel(editor, 'video-preview');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoTitle']]);
	const clips = editor.getByRole('group', { name: 'Video clip: Title', exact: true });
	await expect(clips).toHaveCount(1);
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	const before = await clips.boundingBox();
	expect(before).not.toBeNull();
	await editor.getByRole('button', { name: 'Split tool', exact: true }).click();
	await clips.click({ position: { x: before.width / 2, y: before.height - 10 } });
	await expect(clips).toHaveCount(2);
	await editor.getByRole('button', { name: 'Split tool', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Undo']);
	await expect(clips).toHaveCount(1);
	await expect.poll(async () => (await clips.boundingBox())?.width).toBe(before.width);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Redo']);
	await expect(clips).toHaveCount(2);
});
