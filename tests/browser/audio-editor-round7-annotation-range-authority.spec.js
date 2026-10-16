/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('Undo of a named region range retires its held move and retains Redo', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Window', 'Markers');
	const panel = editor.getByRole('region', { name: 'Markers and named regions', exact: true });
	await panel.getByRole('button', { name: 'Add region from selection', exact: true }).click();
	await chooseCommandAction(page, editor, 'View', 'Markers');
	const region = editor.getByRole('listbox', { name: 'Markers and named regions', exact: true }).getByRole('option');
	const left = () => region.evaluate(element => parseFloat(element.style.left));
	const initial = await left();
	const begin = async () => {
		const box = await region.boundingBox(); expect(box).not.toBeNull();
		const x = box.x + box.width / 2, y = box.y + box.height / 2;
		await page.mouse.move(x, y); await page.mouse.down();
		await page.mouse.move(x + 10, y, { steps: 3 });
	};
	await begin(); await page.mouse.up();
	await expect.poll(left).toBeCloseTo(initial + 10, 0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(left).toBeCloseTo(initial, 0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(left).toBeCloseTo(initial + 10, 0);
	await begin();
	await expect.poll(left).toBeCloseTo(initial + 20, 0);
	await page.keyboard.press('Control+z');
	await expect(editor.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
	await page.mouse.up();
	await expect.poll(left).toBeCloseTo(initial, 0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(left).toBeCloseTo(initial + 10, 0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(left).toBeCloseTo(initial, 0);
	await begin(); await page.mouse.up();
	await expect.poll(left).toBeCloseTo(initial + 10, 0);
	await expect(editor.getByRole('alert')).toHaveCount(0);
});
