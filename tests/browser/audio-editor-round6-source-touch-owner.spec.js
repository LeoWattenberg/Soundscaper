/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, longTone } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('Source waveform keeps its first ordinary native touch selection', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Native multi-touch input uses the Chromium protocol.');
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [longTone]);
	const panel = await openClipProperties(page, editor, clipByName(editor, longTone.name));
	const waveform = panel.getByRole('region', { name: 'Source waveform', exact: true });
	const bounds = await waveform.boundingBox();
	expect(bounds).not.toBeNull();
	const point = (fraction, id) => ({ x: bounds.x + bounds.width * fraction, y: bounds.y + 80, id });
	const start = point(0.2, 1), moved = point(0.4, 1);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(moved.x, moved.y, { steps: 3 });
	await page.mouse.up();
	const selection = waveform.locator('.audio-editor-source-selection');
	await expect(selection).toBeVisible();
	const originalLeft = await selection.evaluate(element => parseFloat(element.style.left));
	expect(originalLeft).toBeGreaterThan(bounds.width * 0.18);
	expect(originalLeft).toBeLessThan(bounds.width * 0.22);
	await waveform.click({ position: { x: bounds.width * 0.2, y: 80 } });
	await expect(selection).toHaveCount(0);
	const native = await page.context().newCDPSession(page);
	const secondary = point(0.7, 2), finished = point(0.5, 1);
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [moved] });
	await expect(selection).toBeVisible();
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [moved, secondary] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [finished, secondary] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await expect(selection).toBeVisible();
	await expect.poll(() => selection.evaluate(element => parseFloat(element.style.left))).toBeCloseTo(originalLeft, 0);
	await expect.poll(() => selection.evaluate(element => parseFloat(element.style.width))).toBeGreaterThan(bounds.width * 0.28);
});
