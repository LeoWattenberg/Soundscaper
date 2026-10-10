/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('a spectral brush saves its radius at primary release with middle held', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'brush recording.wav', duration: 3, channelCount: 1 });
	await importFiles(editor, [recording]);
	await clipByName(editor, recording.name).locator('.clip-header').click();
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Select', ['Spectral', 'Spectral brush']);
	const brush = editor.getByRole('button', { name: 'Spectral brush', exact: true });
	const bounds = await brush.boundingBox();
	expect(bounds).not.toBeNull();
	const start = { x: bounds.x + 80, y: bounds.y + bounds.height / 2 };
	const endHandle = editor.locator('.audio-editor-spectral-selection__handle--time-end');
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x + 12, start.y, { steps: 3 });
	await page.mouse.up();
	await expect(endHandle).toBeVisible();
	const healthy = Number(await endHandle.getAttribute('aria-valuenow'));
	expect(healthy).toBeGreaterThan(0);
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	await expect(endHandle).toHaveCount(0);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x + 12, start.y, { steps: 3 });
	await expect(brush.locator('.audio-editor-spectral-brush__preview')).toBeVisible();
	await page.mouse.down({ button: 'middle' });
	await page.mouse.up();
	await page.mouse.move(start.x + 24, start.y, { steps: 3 });
	await page.mouse.up({ button: 'middle' });
	await expect(endHandle).toBeVisible();
	await expect.poll(async () => Number(await endHandle.getAttribute('aria-valuenow'))).toBe(healthy);
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	await expect(endHandle).toHaveCount(0);
});
