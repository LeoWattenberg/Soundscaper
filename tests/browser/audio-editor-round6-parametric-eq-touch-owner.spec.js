/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles, openParametricEqSelectionEffect } from './audio-editor-test-helpers.js';

test('a second native touch cannot replace the active parametric EQ band drag', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Native multi-touch input uses the Chromium protocol.');
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const dialog = await openParametricEqSelectionEffect(page, editor);
	const bands = dialog.locator('.audio-editor-parametric-eq__handle');
	await expect(bands).toHaveCount(4);
	const first = bands.nth(0);
	const second = bands.nth(1);
	const beforeControl = await first.getAttribute('aria-label');
		const box = await first.boundingBox();
	const otherBox = await second.boundingBox();
	expect(box).not.toBeNull(); expect(otherBox).not.toBeNull();
	let start = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x + 18, start.y - 18, { steps: 3 });
	await page.mouse.up();
	await expect(first).not.toHaveAttribute('aria-label', beforeControl);
	const beforeFirst = await first.getAttribute('aria-label');
	const beforeSecond = await second.getAttribute('aria-label');
	const editedBox = await first.boundingBox();
	expect(editedBox).not.toBeNull();
	start = { x: editedBox.x + editedBox.width / 2, y: editedBox.y + editedBox.height / 2, id: 1 };
	const native = await page.context().newCDPSession(page);
	const primary = { ...start, x: start.x + 18, y: start.y - 18 };
	const secondary = { x: otherBox.x + otherBox.width / 2, y: otherBox.y + otherBox.height / 2, id: 2 };
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [primary] });
	await expect(first).not.toHaveAttribute('aria-label', beforeFirst);
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [primary, secondary] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...primary, x: primary.x + 18 }, secondary] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	console.log('native EQ touch completion', {
		first: await first.getAttribute('aria-label'), second: await second.getAttribute('aria-label'), beforeSecond,
	});
	await expect(second).toHaveAttribute('aria-label', beforeSecond);
	await expect(first).toHaveAttribute('data-selected', 'true');
});
