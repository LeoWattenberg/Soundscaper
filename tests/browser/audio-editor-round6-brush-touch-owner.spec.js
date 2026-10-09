/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

for (const secondary of [false, true]) test(`a spectral brush completes ${secondary ? 'through a second finger' : 'alone'} at its original center`, async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Native multi-touch uses the Chromium input protocol.');
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Select', ['Spectral', 'Spectral brush']);
	const brush = editor.getByRole('button', { name: 'Spectral brush', exact: true });
	const bounds = await brush.boundingBox();
	expect(bounds).not.toBeNull();
	const first = { x: Math.round(bounds.x + 50), y: Math.round(bounds.y + bounds.height / 2), id: 1 };
	const middle = { ...first, x: first.x + 10, y: first.y + 5 };
	const final = { ...first, x: first.x + 20, y: first.y + 10 };
	await page.mouse.move(first.x, first.y);
	await page.mouse.down();
	await page.mouse.move(final.x, final.y, { steps: 3 });
	await page.mouse.up();
	const handles = editor.locator('[data-spectral-selection] [role="slider"]');
	await expect(handles).toHaveCount(5);
	const expected = await handles.evaluateAll(items => items.map(item => item.getAttribute('aria-valuenow')));
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	await expect(editor.locator('[data-spectral-selection]')).toHaveCount(0);
	const native = await page.context().newCDPSession(page);
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [middle] });
	await expect(brush.locator('.audio-editor-spectral-brush__preview')).toBeVisible();
	const second = { ...middle, x: middle.x + 5, id: 2 };
	if (secondary) await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [middle, second] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: secondary ? [final, second] : [final] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await expect(handles).toHaveCount(5);
	console.log('spectral brush complete bounds', { expected, actual: await handles.evaluateAll(items => items.map(item => item.getAttribute('aria-valuenow'))) });
	await expect.poll(() => handles.evaluateAll(items => items.map(item => item.getAttribute('aria-valuenow')))).toEqual(expected);
	await expect(brush.locator('.audio-editor-spectral-brush__preview')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	await brush.press('Enter');
	await expect(handles).toHaveCount(5);
});
