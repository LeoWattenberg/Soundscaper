/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, closeWorkspacePanel } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('Project Bin Insert opens the generated Title lane with the camera lanes', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await closeWorkspacePanel(editor, 'video-preview');
	const choosing = page.waitForEvent('filechooser');
	await editor.locator('button').getByText('Add media', { exact: true }).click();
	await (await choosing).setFiles(createDeterministicAvFixture('camera.webm'));
	const card = editor.getByRole('listitem', { name: 'Project bin: camera', exact: true });
	await expect(card).toHaveAttribute('data-unavailable', 'false');
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	await card.getByRole('button', { name: /Add to timeline/u }).click();
	const camera = editor.getByRole('group', { name: 'Video clip: camera', exact: true });
	await expect(camera).toHaveCount(1);
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Title/Text']);
	const title = editor.getByRole('group', { name: 'Video clip: Title', exact: true });
	await expect(title).toHaveCount(1);
	const before = await title.boundingBox();
	expect(before).not.toBeNull();
	await camera.press('Enter');
	await card.getByRole('button', { name: /^Insert:/u }).click();
	await expect(camera).toHaveCount(2);
	await expect(editor.getByRole('alert')).toHaveCount(0);
	await expect.poll(async () => (await title.boundingBox())?.x).toBeGreaterThan(before.x + 20);
	const shifted = await title.boundingBox();
	expect(shifted).not.toBeNull();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(camera).toHaveCount(1);
	await expect.poll(async () => (await title.boundingBox())?.x).toBeCloseTo(before.x, 0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(camera).toHaveCount(2);
	await expect.poll(async () => (await title.boundingBox())?.x).toBeCloseTo(shifted.x, 0);
});
