/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('a generated Title can be shortened with its visible right-edge trim handle', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', EDITOR_ENGLISH_COPY['ui.framescaperMenus.addVideoTitle']]);
	const clip = editor.getByRole('group', { name: 'Video clip: Title', exact: true });
	await expect(clip).toBeVisible();
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	await clip.locator('.clip-header').click();
	const before = await clip.boundingBox();
	const handle = clip.getByRole('button', { name: 'Trim right edge', exact: true });
	await expect(handle).toBeVisible();
	const edge = await handle.boundingBox();
	expect(before).not.toBeNull(); expect(edge).not.toBeNull();
	await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
	await page.mouse.down();
	await page.mouse.move(edge.x + edge.width / 2 - before.width / 4, edge.y + edge.height / 2, { steps: 6 });
	await page.mouse.up();
	await expect.poll(async () => (await clip.boundingBox())?.width).toBeLessThan(before.width - before.width / 8);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Undo']);
	await expect.poll(async () => (await clip.boundingBox())?.width).toBe(before.width);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Redo']);
	await expect.poll(async () => (await clip.boundingBox())?.width).toBeLessThan(before.width - before.width / 8);
});
