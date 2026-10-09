/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

for (const interrupted of [false, true]) test(`a native video-effect range completes ${interrupted ? 'through a second finger' : 'alone'}`, async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Native multi-touch uses the Chromium input protocol.');
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicSilentVideoFixture('range-touch.webm')]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	const properties = await openClipProperties(page, editor, clip);
	const rack = properties.locator('[data-video-effect-rack]');
	await rack.getByRole('button', { name: 'Add effect', exact: true }).click();
	const numeric = rack.locator('[data-video-effect-param="brightness"] input[type="number"]');
	const range = rack.locator('[data-video-effect-param="brightness"] input[type="range"]');
	await range.scrollIntoViewIfNeeded();
	const box = await range.boundingBox();
	expect(box).not.toBeNull();
	const first = { x: box.x + box.width * 0.55, y: box.y + box.height / 2, id: 1 };
	const final = { ...first, x: box.x + box.width * 0.75 };
	await page.mouse.move(first.x, first.y);
	await page.mouse.down();
	await page.mouse.move(final.x, final.y, { steps: 4 });
	await page.mouse.up();
	await expect.poll(async () => Number(await numeric.inputValue())).toBeGreaterThan(0);
	const completed = Number(await numeric.inputValue());
	expect(completed).toBeGreaterThan(0);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(numeric).toHaveValue('0');
	const native = await page.context().newCDPSession(page);
	const releases = [];
	page.on('console', message => { if (message.text().startsWith('video-range-touch-release')) releases.push(message.text()); });
	await range.evaluate(node => node.ownerDocument.addEventListener('pointerup', event => {
		if (event.pointerType === 'touch') console.log('video-range-touch-release', event.isPrimary);
	}, true));
	const middle = { ...first, x: first.x + 10 };
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [middle] });
	await expect.poll(async () => Number(await numeric.inputValue())).toBeGreaterThan(0);
	if (interrupted) {
		const second = { x: middle.x + 2, y: middle.y + 2, id: 2 };
		await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [middle, second] });
		await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [second] });
		expect(releases).toEqual(['video-range-touch-release false']);
	}
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [final] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await expect.poll(async () => Number(await numeric.inputValue())).toBeCloseTo(completed, 2);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(numeric).toHaveValue('0');
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect.poll(async () => Number(await numeric.inputValue())).toBeCloseTo(completed, 2);
});
