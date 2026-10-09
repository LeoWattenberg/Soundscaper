/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('a timeline region keeps its first native touch move', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Native multi-touch uses the Chromium input protocol.');
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
	const bounds = await region.boundingBox();
	expect(bounds).not.toBeNull();
	const first = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, id: 1 };
	await page.mouse.move(first.x, first.y);
	await page.mouse.down();
	await page.mouse.move(first.x + 10, first.y, { steps: 3 });
	await page.mouse.up();
	await expect.poll(left).toBeCloseTo(initial + 10, 0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(left).toBeCloseTo(initial, 0);
	const middle = { ...first, x: first.x + 10 };
	const second = { ...first, x: first.x + 20, id: 2 };
	const final = { ...first, x: first.x + 30 };
	const native = await page.context().newCDPSession(page);
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [middle] });
	await expect.poll(left).toBeCloseTo(initial + 10, 0);
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [middle, second] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [final, second] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await expect.poll(left).toBeCloseTo(initial + 30, 0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(left).toBeCloseTo(initial, 0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(left).toBeCloseTo(initial + 30, 0);
});
