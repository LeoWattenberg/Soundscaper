/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';

test('track Volume retains one completed edit through a native second-finger release', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Native multi-touch uses the Chromium input protocol.');
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const row = clipByName(editor, toneA.name).locator('xpath=ancestor::div[@data-track-row]');
	const volume = row.getByRole('slider', { name: 'Volume', exact: true });
	const initial = await volume.inputValue();
	const box = await volume.boundingBox();
	expect(box).not.toBeNull();
	const first = { x: box.x + 8 + (box.width - 16) * Number(initial) / 100, y: box.y + box.height / 2, id: 1 };
	const middle = { ...first, x: box.x + box.width * .6 };
	const final = { ...first, x: box.x + box.width * .4 };
	await page.mouse.move(first.x, first.y);
	await page.mouse.down();
	await page.mouse.move(final.x, final.y, { steps: 5 });
	await page.mouse.up();
	await expect(volume).not.toHaveValue(initial);
	const completed = await volume.inputValue();
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(volume).toHaveValue(initial);
	const native = await page.context().newCDPSession(page);
	const released = [];
	page.on('console', message => { if (message.text().startsWith('volume-native-release')) released.push(message.text()); });
	await volume.evaluate(node => node.ownerDocument.addEventListener('pointerup', event => {
		if (event.pointerType === 'touch') console.log('volume-native-release', event.isPrimary);
	}, true));
	for (const interrupted of [false, true]) {
		await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
		await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [middle] });
		await expect(volume).not.toHaveValue(initial);
		if (interrupted) {
			const second = { ...middle, x: middle.x + 2, id: 2 };
			await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [middle, second] });
			await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [second] });
			await expect.poll(() => released.at(-1)).toBe('volume-native-release false');
		}
		await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [final] });
		await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await expect(volume, `${interrupted ? 'second-contact' : 'healthy single-contact'} completion`).toHaveValue(completed);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(volume).toHaveValue(initial);
		await editor.getByRole('button', { name: 'Redo', exact: true }).click();
		await expect(volume).toHaveValue(completed);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(volume).toHaveValue(initial);
	}
	expect(errors).toEqual([]);
});
