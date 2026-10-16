/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('undoing a held marker creation permits the next ordinary marker move', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Window', 'Markers');
	const panel = editor.getByRole('region', { name: 'Markers and named regions', exact: true });
	const add = panel.getByRole('button', { name: 'Add region from selection', exact: true });
	await add.click();
	await chooseCommandAction(page, editor, 'View', 'Markers');
	const region = editor.getByRole('listbox', { name: 'Markers and named regions', exact: true }).getByRole('option');
	const left = () => region.evaluate(element => parseFloat(element.style.left));
	const initial = await left();
	const bounds = await region.boundingBox();
	expect(bounds).not.toBeNull();
	const first = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
	await page.mouse.move(first.x, first.y);
	await page.mouse.down();
	await page.mouse.move(first.x + 10, first.y, { steps: 3 });
	await page.mouse.up();
	await expect.poll(left).toBeCloseTo(initial + 10, 0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(left).toBeCloseTo(initial, 0);
	await page.mouse.move(first.x, first.y);
	await page.mouse.down();
	await page.mouse.move(first.x + 10, first.y, { steps: 3 });
	await expect.poll(left).toBeCloseTo(initial + 10, 0);
	await page.keyboard.press('Control+z');
	await expect(region).toHaveCount(0);
	await page.mouse.up();
	await add.click();
	await expect(region).toHaveCount(1);
	const fresh = await region.boundingBox();
	expect(fresh).not.toBeNull();
	await page.mouse.move(fresh.x + fresh.width / 2, fresh.y + fresh.height / 2);
	await page.mouse.down();
	await page.mouse.move(fresh.x + fresh.width / 2 + 10, fresh.y + fresh.height / 2, { steps: 3 });
	await page.mouse.up();
	await expect.poll(left).toBeCloseTo(initial + 10, 0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(left).toBeCloseTo(initial, 0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(left).toBeCloseTo(initial + 10, 0);
});
