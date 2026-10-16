/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles, openParametricEqSelectionEffect } from './audio-editor-test-helpers.js';

for (const interrupted of [false, true]) test(`the parametric output fader completes ${interrupted ? 'through a second finger' : 'alone'}`, async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Native multi-touch uses the Chromium input protocol.');
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const dialog = await openParametricEqSelectionEffect(page, editor);
	const output = dialog.locator('.audio-editor-parametric-eq__output input[type="range"]');
	await output.scrollIntoViewIfNeeded();
	const box = await output.boundingBox();
	expect(box).not.toBeNull();
	const first = { x: box.x + box.width * 0.55, y: box.y + box.height / 2, id: 1 };
	const final = { ...first, x: box.x + box.width * 0.75 };
	await page.mouse.move(first.x, first.y);
	await page.mouse.down();
	await page.mouse.move(final.x, final.y, { steps: 4 });
	await page.mouse.up();
	await expect.poll(async () => Number(await output.inputValue())).toBeGreaterThan(0);
	const completed = Number(await output.inputValue());
	await output.dblclick();
	await expect(output).toHaveValue('0');
	const native = await page.context().newCDPSession(page);
	const releases = [];
	page.on('console', message => { if (message.text().startsWith('eq-output-touch-release')) releases.push(message.text()); });
	await output.evaluate(node => node.ownerDocument.addEventListener('pointerup', event => {
		if (event.pointerType === 'touch') console.log('eq-output-touch-release', event.isPrimary);
	}, true));
	const middle = { ...first, x: first.x + 10 };
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [middle] });
	await expect.poll(async () => Number(await output.inputValue())).toBeGreaterThan(0);
	if (interrupted) {
		const second = { x: middle.x + 2, y: middle.y + 2, id: 2 };
		await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [middle, second] });
		await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [second] });
		await expect.poll(() => releases).toEqual(['eq-output-touch-release false']);
	}
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [final] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await expect.poll(async () => Number(await output.inputValue())).toBeCloseTo(completed, 2);
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(dialog).not.toBeVisible();
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
});
