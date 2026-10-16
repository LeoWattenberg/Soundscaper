/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles } from './audio-editor-test-helpers.js';

for (const interrupted of [false, true]) test(`a touch playhead scrub completes ${interrupted ? 'through a pen tap' : 'alone'}`, async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Native pen/touch input uses the Chromium protocol.');
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	await playhead.press('Home');
	const icon = playhead.locator('.playhead-cursor__icon');
	const firstBox = await icon.boundingBox();
	expect(firstBox).not.toBeNull();
	const first = { x: firstBox.x + firstBox.width / 2, y: firstBox.y + firstBox.height / 2, id: 1 };
	await page.mouse.move(first.x, first.y);
	await page.mouse.down();
	await page.mouse.move(first.x + 40, first.y, { steps: 4 });
	await page.mouse.up();
	const value = async () => Number(await playhead.getAttribute('aria-valuenow'));
	await expect.poll(value).toBeGreaterThan(5000);
	await playhead.press('Home');
	await expect(playhead).toHaveAttribute('aria-valuenow', '0');
	const native = await page.context().newCDPSession(page);
	const middle = { ...first, x: first.x + 10 };
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [middle] });
	await expect.poll(value).toBeGreaterThan(0);
	const middleFrame = await value();
	if (interrupted) {
		const current = await icon.boundingBox();
		expect(current).not.toBeNull();
		const pen = { x: current.x + current.width / 2, y: current.y + current.height / 2, button: 'left', pointerType: 'pen' };
		await native.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...pen, buttons: 1, clickCount: 1 });
		await native.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...pen, buttons: 0, clickCount: 1 });
	}
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...first, x: first.x + 40 }] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await expect.poll(value).toBeGreaterThan(middleFrame + 5000);
	await playhead.press('Home');
	await expect(playhead).toHaveAttribute('aria-valuenow', '0');
});
