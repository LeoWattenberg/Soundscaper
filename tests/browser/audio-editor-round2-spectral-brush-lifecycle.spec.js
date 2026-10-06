/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('Escape cancels a spectral-brush gesture before its pointer release', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Select', ['Spectral', 'Spectral brush']);
	const brush = editor.locator('[data-spectral-brush]');
	await expect(brush).toBeVisible();
	await brush.focus();
	const box = await brush.boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.move(box.x + 200, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + 215, box.y + box.height / 2 + 15, { steps: 4 });
	await expect(brush.locator('.audio-editor-spectral-brush__preview')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(brush.locator('.audio-editor-spectral-brush__preview')).toHaveCount(0);
	await page.mouse.up();
	await expect(editor.locator('[data-spectral-selection]')).toHaveCount(0);
	await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(0);
});

test('the spectral brush receives pointer gestures over a selected clip', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await clip.locator('.clip-header').click();
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Select', ['Spectral', 'Spectral brush']);
	const brush = editor.getByRole('button', { name: 'Spectral brush', exact: true });
	await brush.focus();
	const bounds = await clip.boundingBox();
	expect(bounds).not.toBeNull();
	await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 3);
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width / 2 + 5, bounds.y + bounds.height / 3 + 10);
	await expect(brush.locator('.audio-editor-spectral-brush__preview')).toBeVisible();
	await page.mouse.up();
	await expect(editor.locator('[data-spectral-selection]')).toBeVisible();
});
