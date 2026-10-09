/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('track height completes a native touch resize with Undo and Redo', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Native touch uses the Chromium input protocol.');
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Increase all track heights']);
	const row = editor.locator('[data-track-row]').first();
	const header = row.locator('[data-track-header]');
	const initialBox = await row.boundingBox();
	expect(initialBox).not.toBeNull();
	const initial = initialBox.height;
	const box = await header.boundingBox();
	expect(box).not.toBeNull();
	const first = { x: box.x + 50, y: box.y + box.height - 2, id: 1 };
	const final = { ...first, y: first.y + 24 };
	await page.mouse.move(first.x, first.y);
	await page.mouse.down();
	await page.mouse.move(final.x, final.y, { steps: 4 });
	await page.mouse.up();
	await expect.poll(async () => (await row.boundingBox()).height).toBeGreaterThan(initial);
	const completed = (await row.boundingBox()).height;
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect.poll(async () => (await row.boundingBox()).height).toBe(initial);
	const cancellations = [];
	page.on('console', message => {
		if (message.text().startsWith('track-height-pointercancel')) cancellations.push(message.text());
	});
	await page.evaluate(() => document.addEventListener('pointercancel', event => {
		console.log('track-height-pointercancel', event.pointerType);
	}, true));
	const native = await page.context().newCDPSession(page);
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...first, y: first.y + 10 }] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [final] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	console.log('native track-height cancellations', cancellations);
	await expect.poll(async () => (await row.boundingBox()).height).toBe(completed);
	expect(cancellations).toEqual([]);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect.poll(async () => (await row.boundingBox()).height).toBe(initial);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect.poll(async () => (await row.boundingBox()).height).toBe(completed);
});
