/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, closeWorkspacePanel }
	from './audio-editor-test-helpers.js';

test('generated Title has the existing time-preserving picture-track move menu', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await closeWorkspacePanel(editor, 'video-preview');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Title/Text']);
	const title = editor.getByRole('group', { name: 'Video clip: Title', exact: true });
	const originalTrack = await title.locator('xpath=ancestor::*[@data-track-id][1]').getAttribute('data-track-id');
	const before = await title.boundingBox();
	const surface = await editor.locator('.audio-editor-timeline-inner').boundingBox();
	const last = await editor.locator('.audio-editor-track-row').last().boundingBox();
	expect(before).not.toBeNull(); expect(surface).not.toBeNull(); expect(last).not.toBeNull();
	await page.mouse.move(before.x + 32, before.y + 10);
	await page.mouse.down();
	await page.mouse.move(before.x + 32, Math.min(surface.y + surface.height - 16, last.y + last.height + 32), { steps: 6 });
	await expect(editor.locator('.audio-editor-new-track-drop-preview')).toBeVisible();
	await page.mouse.up();
	const movedTrack = await title.locator('xpath=ancestor::*[@data-track-id][1]').getAttribute('data-track-id');
	expect(movedTrack).not.toBe(originalTrack);
	await title.click({ button: 'right', position: { x: 32, y: 10 } });
	const context = page.locator('.audio-editor-clip-context-menu');
	const move = context.getByRole('menuitem', { name: /^Move to track \(preserve time\)/u });
	await expect(move).toBeEnabled();
	await move.hover();
	await move.getByRole('menuitem').first().click();
	await expect(title.locator('xpath=ancestor::*[@data-track-id][1]')).toHaveAttribute('data-track-id', originalTrack);
	await expect.poll(async () => (await title.boundingBox())?.x).toBeCloseTo(before.x, 0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(title.locator('xpath=ancestor::*[@data-track-id][1]')).toHaveAttribute('data-track-id', movedTrack);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(title.locator('xpath=ancestor::*[@data-track-id][1]')).toHaveAttribute('data-track-id', originalTrack);
});
