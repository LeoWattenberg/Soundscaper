/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('undoing a newly added track retires its held height resize', async ({ page }) => {
	const errors = [];
	page.on('pageerror', error => errors.push(error.message));
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Increase all track heights']);
	const first = editor.locator('[data-track-row]').first();
	const initial = (await first.boundingBox()).height;
	const resize = async (row, complete) => {
		const box = await row.locator('[data-track-header]').boundingBox();
		expect(box).not.toBeNull();
		await page.mouse.move(box.x + 50, box.y + box.height - 2);
		await page.mouse.down();
		await page.mouse.move(box.x + 50, box.y + box.height + 22, { steps: 4 });
		if (complete) await page.mouse.up();
	};
	await resize(first, true);
	await expect.poll(async () => (await first.boundingBox()).height).toBe(initial + 24);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(async () => (await first.boundingBox()).height).toBe(initial);
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
	await expect(editor).toHaveAttribute('data-track-count', '2');
	const added = editor.locator('[data-track-row]').last();
	await added.scrollIntoViewIfNeeded();
	await added.getByRole('button', { name: 'Track menu', exact: true }).focus();
	const addedId = await added.getAttribute('data-track-id');
	const addedHeight = (await added.boundingBox()).height;
	await resize(added, false);
	await expect.poll(async () => (await added.boundingBox()).height).toBe(addedHeight + 24);
	await page.keyboard.press('Control+z');
	await expect(editor).toHaveAttribute('data-track-count', '1');
	await page.mouse.up();
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	await expect(editor.getByRole('alert')).toHaveCount(0);
	expect(errors).toEqual([]);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor).toHaveAttribute('data-track-count', '2');
	await expect.poll(async () => (await editor.locator(`[data-track-id="${addedId}"]`).first().boundingBox()).height).toBe(addedHeight);
});
