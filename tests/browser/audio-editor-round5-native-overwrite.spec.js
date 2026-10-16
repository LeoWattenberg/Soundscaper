/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, closeWorkspacePanel } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('Project Bin Overwrite trims the generated Title lane rather than retaining overlapping picture', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await closeWorkspacePanel(editor, 'video-preview');
	const choosing = page.waitForEvent('filechooser');
	await editor.locator('button').getByText('Add media', { exact: true }).click();
	await (await choosing).setFiles(createDeterministicAvFixture('overwrite-camera.webm'));
	const card = editor.getByRole('listitem', { name: 'Project bin: overwrite-camera', exact: true });
	await expect(card).toHaveAttribute('data-unavailable', 'false');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Title/Text']);
	const title = editor.getByRole('group', { name: 'Video clip: Title', exact: true });
	const before = await title.boundingBox();
	expect(before).not.toBeNull();
	await title.press('Enter');
	await card.getByRole('button', { name: /^Overwrite:/u }).click();
	await expect(editor.getByRole('group', { name: 'Video clip: overwrite-camera', exact: true })).toHaveCount(1);
	await expect.poll(async () => (await title.boundingBox())?.x).toBeGreaterThan(before.x + 20);
	const after = await title.boundingBox();
	expect(after).not.toBeNull();
	expect(after.x + after.width).toBeCloseTo(before.x + before.width, 0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.getByRole('group', { name: 'Video clip: overwrite-camera', exact: true })).toHaveCount(0);
	await expect.poll(async () => (await title.boundingBox())?.x).toBeCloseTo(before.x, 0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor.getByRole('group', { name: 'Video clip: overwrite-camera', exact: true })).toHaveCount(1);
	await expect.poll(async () => (await title.boundingBox())?.x).toBeCloseTo(after.x, 0);
});
