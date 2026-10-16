/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';

test('Mixer Volume retains the first accepted drag through a native second-finger release', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Native multi-touch uses the Chromium input protocol.');
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Window', 'Mixer');
	const channel = editor.locator('.kw-audio-editor__mixer-channel--track').filter({ hasText: 'browser-tone-a' });
	const volume = channel.getByRole('slider', { name: /volume$/u });
	await expect(volume).toHaveAttribute('aria-valuenow', '0');
	const track = volume.locator('.mixer-fader__track');
	const box = await track.boundingBox();
	expect(box).not.toBeNull();
	const min = Number(await volume.getAttribute('aria-valuemin'));
	const max = Number(await volume.getAttribute('aria-valuemax'));
	const first = { id: 1, x: box.x + box.width / 2, y: box.y + box.height * max / (max - min) };
	const middle = { ...first, y: first.y + 16 };
	const final = { ...first, y: first.y + 32 };
	await page.mouse.move(first.x, first.y);
	await page.mouse.down();
	await page.mouse.move(final.x, final.y, { steps: 5 });
	await page.mouse.up();
	const completed = await volume.getAttribute('aria-valuenow');
	expect(Number(completed)).toBeLessThan(0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(volume).toHaveAttribute('aria-valuenow', '0');
	const native = await page.context().newCDPSession(page);
	const released = [];
	page.on('console', message => { if (message.text().startsWith('mixer-volume-native-release')) released.push(message.text()); });
	await volume.evaluate(node => node.ownerDocument.addEventListener('pointerup', event => {
		if (event.pointerType === 'touch') console.log('mixer-volume-native-release', event.isPrimary);
	}, true));
	for (const interrupted of [false, true]) {
		await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
		await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [middle] });
		await expect(volume).not.toHaveAttribute('aria-valuenow', '0');
		if (interrupted) {
			const second = { ...middle, id: 2, x: middle.x + 2 };
			await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [middle, second] });
			await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [second] });
			await expect.poll(() => released.at(-1)).toBe('mixer-volume-native-release false');
		}
		await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [final] });
		await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await expect(volume, interrupted ? 'first contact still completes' : 'healthy single contact').toHaveAttribute('aria-valuenow', completed);
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(volume).toHaveAttribute('aria-valuenow', '0');
		await chooseCommandAction(page, editor, 'Edit', 'Redo');
		await expect(volume).toHaveAttribute('aria-valuenow', completed);
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(volume).toHaveAttribute('aria-valuenow', '0');
	}
	expect(errors).toEqual([]);
});
