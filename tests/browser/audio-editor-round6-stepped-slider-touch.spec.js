/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, commitInput,
	effectSourcePeak, importFiles } from './audio-editor-test-helpers.js';

for (const interrupted of [false, true]) test(`Amplify's native peak slider completes ${interrupted ? 'through a second finger' : 'alone'}`, async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Native multi-touch uses the Chromium input protocol.');
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Amplify']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	const slider = dialog.locator('[data-effect-param="newPeakAmplitude"] input[type="range"]');
	const gain = dialog.locator('[data-effect-param="gainDb"] input[type="number"]');
	await commitInput(gain, '0');
	await slider.scrollIntoViewIfNeeded();
	const box = await slider.boundingBox();
	expect(box).not.toBeNull();
	const first = { x: box.x + box.width * .45, y: box.y + box.height / 2, id: 1 };
	const final = { ...first, x: box.x + box.width * .35 };
	await page.mouse.move(first.x, first.y);
	await page.mouse.down();
	await page.mouse.move(final.x, final.y, { steps: 4 });
	await page.mouse.up();
	await expect.poll(async () => Number(await gain.inputValue())).toBeLessThan(-10);
	const completed = Number(await slider.inputValue());
	await commitInput(gain, '0');
	await expect(gain).toHaveValue('0');
	const native = await page.context().newCDPSession(page);
	const releases = [];
	page.on('console', message => { if (message.text().startsWith('amplify-touch-release')) releases.push(message.text()); });
	await slider.evaluate(node => node.ownerDocument.addEventListener('pointerup', event => {
		if (event.pointerType === 'touch') console.log('amplify-touch-release', event.isPrimary);
	}, true));
	const middle = { ...first, x: first.x - 4 };
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [middle] });
	await expect.poll(async () => Number(await gain.inputValue())).toBeLessThan(-4);
	if (interrupted) {
		const second = { x: middle.x + 2, y: middle.y + 2, id: 2 };
		await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [middle, second] });
		await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [second] });
		expect(releases).toEqual(['amplify-touch-release false']);
	}
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [final] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await expect.poll(async () => Number(await slider.inputValue())).toBeCloseTo(completed, 2);
	const appliedGain = Number(await gain.inputValue());
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect.poll(() => effectSourcePeak(page, 'Amplify')).toBeCloseTo(.35 * 10 ** (appliedGain / 20), 3);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
});
