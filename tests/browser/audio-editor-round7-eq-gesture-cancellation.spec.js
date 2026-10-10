/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction,
	importFiles } from './audio-editor-test-helpers.js';

for (const effect of ['Graphic EQ', 'Filter Curve EQ']) {
	test(`${effect} keeps the first native drag when a second finger releases`, async ({ page, browserName }) => {
		test.skip(browserName !== 'chromium', 'Native multi-touch uses the Chromium protocol.');
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Effect', ['EQ and filters', effect]);
		const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
		const native = await page.context().newCDPSession(page);
		if (effect === 'Graphic EQ') {
			const first = dialog.getByRole('slider', { name: '20 Hz', exact: true });
			const second = dialog.getByRole('slider', { name: '50 Hz', exact: true });
			const box = await first.boundingBox(); const other = await second.boundingBox();
			expect(box).not.toBeNull(); expect(other).not.toBeNull();
			const at = gain => ({ x: box.x + box.width / 2,
				y: box.y + (20 - gain) / 40 * box.height, id: 1 });
			await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at(0)] });
			await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at(6)] });
			await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
			await expect(first).toHaveAttribute('aria-valuenow', '6');
			await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
			const primary = at(10);
			const secondary = { x: other.x + other.width / 2, y: other.y + other.height / 2, id: 2 };
			await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at(0)] });
			await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [primary] });
			await expect(first).toHaveAttribute('aria-valuenow', '10');
			await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [primary, secondary] });
			await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [secondary] });
			await expect(first).toHaveAttribute('aria-valuenow', '10');
			await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at(15)] });
			await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
			await expect(first).toHaveAttribute('aria-valuenow', '15');
			await expect(second).toHaveAttribute('aria-valuenow', '0');
		} else {
			await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
			const graph = dialog.getByRole('group', { name: 'Equalization curve', exact: true });
			const box = await graph.boundingBox(); expect(box).not.toBeNull();
			const at = (x, y, id = 1) => ({ x: box.x + (56 + x * 568) / 640 * box.width,
				y: box.y + (16 + y * 244) / 300 * box.height, id });
			await page.mouse.click(at(.4, .5).x, at(.4, .5).y);
			const point = graph.getByRole('button');
			await expect(point).toHaveCount(1);
			await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at(.4, .5)] });
			await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at(.45, .4)] });
			await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
			await expect.poll(() => gain(point)).toBeCloseTo(6, 0);
			await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
			await page.mouse.click(at(.4, .5).x, at(.4, .5).y);
			const primary = at(.45, .35); const secondary = at(.7, .6, 2);
			await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at(.4, .5)] });
			await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [primary] });
			await expect.poll(() => gain(point)).toBeCloseTo(9, 0);
			await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [primary, secondary] });
			await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [secondary] });
			await expect.poll(() => gain(point)).toBeCloseTo(9, 0);
			await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at(.5, .25)] });
			await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
			await expect(point).toHaveCount(1);
			await expect.poll(() => gain(point)).toBeCloseTo(15, 0);
		}
	});
}

async function gain(point) {
	return Number((await point.getAttribute('aria-label'))?.match(/, (-?[\d.]+) dB$/u)?.[1]);
}
