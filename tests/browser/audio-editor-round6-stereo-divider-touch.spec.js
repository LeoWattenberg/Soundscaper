/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('an opted-in stereo divider completes a native vertical touch adjustment', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Native touch uses the Chromium input protocol.');
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	await preferences.getByRole('radiogroup', { name: 'Asymmetric stereo heights', exact: true })
		.getByRole('radio', { name: 'Always', exact: true }).check();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const divider = editor.locator('[data-stereo-channel-divider]').last();
	await expect(divider).toHaveAttribute('aria-valuenow', '50');
	await divider.press('Home');
	const initial = await divider.getAttribute('aria-valuenow');
	const box = await divider.boundingBox();
	expect(box).not.toBeNull();
	const first = { x: box.x + 50, y: box.y + box.height / 2, id: 1 };
	const final = { ...first, y: first.y + 24 };
	await page.mouse.move(first.x, first.y);
	await page.mouse.down();
	await page.mouse.move(final.x, final.y, { steps: 4 });
	await page.mouse.up();
	await expect(divider).not.toHaveAttribute('aria-valuenow', initial);
	const completed = await divider.getAttribute('aria-valuenow');
	await divider.press('Home');
	await expect(divider).toHaveAttribute('aria-valuenow', initial);
	const cancellations = [];
	page.on('console', message => {
		if (message.text().startsWith('stereo-divider-pointercancel')) cancellations.push(message.text());
	});
	await divider.evaluate(element => element.addEventListener('pointercancel', event => {
		console.log('stereo-divider-pointercancel', event.pointerType);
	}));
	const native = await page.context().newCDPSession(page);
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...first, y: first.y + 10 }] });
	await expect(divider).not.toHaveAttribute('aria-valuenow', initial);
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [final] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	console.log('native stereo divider cancellations', cancellations);
	await expect(divider).toHaveAttribute('aria-valuenow', completed);
	expect(cancellations).toEqual([]);
	await divider.press('Home');
	await expect(divider).toHaveAttribute('aria-valuenow', initial);
	await divider.press('ArrowDown');
	await expect(divider).not.toHaveAttribute('aria-valuenow', initial);
});
