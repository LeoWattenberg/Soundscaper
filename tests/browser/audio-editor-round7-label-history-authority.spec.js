/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('Undo of a label range retires its held movement draft and keeps Redo', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await editor.getByRole('slider', { name: 'Playhead' }).focus();
	await page.keyboard.press('Control+b');
	const title = editor.getByRole('textbox', { name: /^Edit labels:/u });
	await title.fill('Intro');
	await title.press('Enter');
	const label = editor.getByRole('group', { name: 'Edit labels: Intro', exact: true });
	const position = () => label.evaluate(element => element.style.left);
	const original = await position();
	const beginMove = async () => {
		const box = await label.locator('.label-marker__label-box').boundingBox();
		expect(box).not.toBeNull();
		const x = box.x + box.width / 2, y = box.y + box.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + 40, y, { steps: 4 });
	};
	await beginMove();
	await page.mouse.up();
	const completed = await position();
	expect(completed).not.toBe(original);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(position).toBe(original);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(position).toBe(completed);
	await beginMove();
	await page.keyboard.press('Control+z');
	await expect(editor.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
	await page.mouse.up();
	await expect.poll(position).toBe(original);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(position).toBe(completed);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(position).toBe(original);
	await expect(editor.getByRole('alert')).toHaveCount(0);
});
