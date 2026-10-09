/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

for (const { interrupted, distance } of [{ interrupted: false, distance: 12 }, { interrupted: true, distance: 12 }, { interrupted: false, distance: 20 }]) test(`an automation point completes its ${distance}px native touch ${interrupted ? 'through another finger release' : 'alone'}`, async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Native multi-touch uses the Chromium input protocol.');
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const row = clipByName(editor, monoTone.name).locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, row, 'Add automation');
	page.on('console', message => {
		if (message.text().startsWith('automation-pointercancel')) console.log(message.text());
	});
	await row.locator('[data-track-automation-overlay]').evaluate(element => element.addEventListener('pointercancel', event => {
		console.log('automation-pointercancel', event.pointerType, event.pointerId);
	}));
	await row.locator('[data-automation-insert-point]').first().press('i');
	const points = row.locator('[data-automation-point-id]');
	await expect(points).toHaveCount(2);
	const point = points.last();
	const identity = await point.getAttribute('data-automation-point-id');
	const owned = row.locator(`[data-automation-point-id="${identity}"]`);
	const y = () => owned.evaluate(element => Number(element.getAttribute('cy')));
	const initial = await y();
	const box = await point.boundingBox();
	expect(box).not.toBeNull();
	const first = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
	await page.mouse.move(first.x, first.y);
	await page.mouse.down();
	await page.mouse.move(first.x, first.y + distance, { steps: 3 });
	await page.mouse.up();
	await expect.poll(y).toBeCloseTo(initial + distance, 0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(y).toBeCloseTo(initial, 0);
	const middle = { ...first, y: first.y + 10 };
	const final = { ...first, y: first.y + distance };
	const native = await page.context().newCDPSession(page);
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [middle] });
	await expect.poll(y).toBeCloseTo(initial + 10, 0);
	if (interrupted) {
		const originBox = await points.first().boundingBox();
		expect(originBox).not.toBeNull();
		const second = { x: originBox.x + originBox.width / 2, y: originBox.y + originBox.height / 2, id: 2 };
		await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [middle, second] });
		await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [middle] });
	}
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [final] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await expect.poll(y).toBeCloseTo(initial + distance, 0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(y).toBeCloseTo(initial, 0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(y).toBeCloseTo(initial + distance, 0);
});
