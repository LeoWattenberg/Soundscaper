/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('a spectral band handle keeps its first native touch adjustment', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Native multi-touch uses the Chromium input protocol.');
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Select', ['Spectral', 'Spectral brush']);
	const brush = editor.getByRole('button', { name: 'Spectral brush', exact: true });
	const surface = await brush.boundingBox();
	expect(surface).not.toBeNull();
	await page.mouse.move(surface.x + 100, surface.y + surface.height / 2);
	await page.mouse.down();
	await page.mouse.move(surface.x + 125, surface.y + surface.height / 2 + 25);
	await page.mouse.up();
	const maximum = editor.getByRole('slider', { name: 'Spectral selection maximum-frequency handle', exact: true });
	await expect(maximum).toBeVisible();
	const original = await maximum.getAttribute('aria-valuenow');
	const bounds = await maximum.boundingBox();
	expect(bounds).not.toBeNull();
	const first = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, id: 1 };
	await page.mouse.move(first.x, first.y);
	await page.mouse.down();
	await page.mouse.move(first.x, first.y - 20, { steps: 3 });
	await expect(maximum).not.toHaveAttribute('aria-valuenow', original);
	const expected = await maximum.getAttribute('aria-valuenow');
	await page.keyboard.press('Escape');
	await page.mouse.up();
	await expect(maximum).toHaveAttribute('aria-valuenow', original);
	const middle = { ...first, y: first.y - 10 };
	const second = { ...middle, x: middle.x + 5, id: 2 };
	const final = { ...first, y: first.y - 20 };
	const native = await page.context().newCDPSession(page);
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [middle] });
	await expect(maximum).not.toHaveAttribute('aria-valuenow', original);
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [middle, second] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [final, second] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await expect(maximum).toHaveAttribute('aria-valuenow', expected);
});
