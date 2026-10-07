/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, closeClipProperties, disableNativeSavePicker, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('clip peak normalization reaches its stated target with an authored envelope', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await clip.locator('.clip-header').click();
	await editor.getByRole('button', { name: 'Clip gain', exact: true }).click();
	const line = clip.locator('.envelope-overlay path').first();
	const point = await line.evaluate(element => {
		const value = element.getPointAtLength(element.getTotalLength() / 2);
		return new DOMPoint(value.x, value.y).matrixTransform(element.getScreenCTM()).toJSON();
	});
	await page.mouse.move(point.x, point.y);
	await page.mouse.down();
	await page.mouse.move(point.x, point.y + 20, { steps: 4 });
	await page.mouse.up();
	await editor.getByRole('button', { name: 'Clip gain', exact: true }).click();
	const before = await exportSamples(page, editor);
	const beforePeak = before.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
	expect(beforePeak).toBeLessThan(0.25);
	const properties = await openClipProperties(page, editor, clip);
	await properties.getByText('Normalize', { exact: true }).click();
	await properties.getByRole('button', { name: 'Normalize to −1 dBFS', exact: true }).click();
	await expect(properties.getByRole('spinbutton', { name: 'Clip gain (dB)', exact: true })).not.toHaveValue('0.00');
	await closeClipProperties(properties);
	const after = await exportSamples(page, editor);
	const peak = after.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
	expect(20 * Math.log10(peak)).toBeCloseTo(-1, 1);
});
