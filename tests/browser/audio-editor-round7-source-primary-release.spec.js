/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, longTone } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('Source waveform selection ends on primary release while middle remains held', async ({ page }) => {
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
	const healthyWidth = await selection.evaluate(element => parseFloat(element.style.width));
	const originalLeft = await selection.evaluate(element => parseFloat(element.style.left));
	expect(originalLeft).toBeGreaterThan(bounds.width * 0.18);
	expect(originalLeft).toBeLessThan(bounds.width * 0.22);
	await waveform.click({ position: { x: bounds.width * 0.2, y: 80 } });
	await expect(selection).toHaveCount(0);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(moved.x, moved.y, { steps: 3 });
	await expect(selection).toBeVisible();
	await expect.poll(() => selection.evaluate(element => parseFloat(element.style.width))).toBeCloseTo(healthyWidth, 0);
	await page.mouse.down({ button: 'middle' });
	await page.mouse.up();
	await page.mouse.move(bounds.x + bounds.width * 0.5, start.y, { steps: 3 });
	await page.mouse.up({ button: 'middle' });
	await expect(selection).toBeVisible();
	await expect.poll(() => selection.evaluate(element => parseFloat(element.style.width))).toBeCloseTo(healthyWidth, 0);
	await waveform.click({ position: { x: bounds.width * 0.2, y: 80 } });
	await expect(selection).toHaveCount(0);
	await expect(editor.getByRole('alert')).toHaveCount(0);
});
