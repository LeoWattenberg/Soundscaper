/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('label movement retains primary ownership through an auxiliary release', async ({ page }) => {
	const errors = [];
	page.on('pageerror', error => errors.push(error.message));
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
	const drag = async auxiliary => {
		const box = await label.locator('.label-marker__label-box').boundingBox();
		expect(box).not.toBeNull();
		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + 12, y, { steps: 3 });
		await expect.poll(position).not.toBe(original);
		if (auxiliary) {
			await page.mouse.down({ button: 'middle' });
			await page.mouse.up({ button: 'middle' });
		}
		await page.mouse.move(x + 40, y, { steps: 4 });
		await page.mouse.up();
	};
	await drag(false);
	const completed = await position();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(position).toBe(original);
	await drag(true);
	await expect.poll(position).toBe(completed);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(position).toBe(original);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(position).toBe(completed);
	await expect(editor.locator('.audio-editor-alert-overlay')).toHaveCount(0);
	expect(errors).toEqual([]);
});
