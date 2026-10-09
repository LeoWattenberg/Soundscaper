/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('label context drags preserve position while primary drags support Undo and Redo', async ({ page }) => {
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
	const box = await label.locator('.label-marker__label-box').boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 });
	await page.mouse.up();
	await expect.poll(position).not.toBe(original);
	const moved = await position();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(position).toBe(original);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(position).toBe(moved);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(position).toBe(original);
	const restored = await label.locator('.label-marker__label-box').boundingBox();
	expect(restored).not.toBeNull();
	await page.mouse.move(restored.x + restored.width / 2, restored.y + restored.height / 2);
	await page.mouse.down({ button: 'right' });
	await page.mouse.move(restored.x + restored.width / 2 + 40, restored.y + restored.height / 2, { steps: 4 });
	await page.mouse.up({ button: 'right' });
	await page.keyboard.press('Escape');
	await expect.poll(position).toBe(original);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(position).toBe(moved);
});
