/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('a context click on the spectral brush preserves the current spectral selection', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Select', ['Spectral', 'Spectral brush']);
	const brush = editor.getByRole('button', { name: 'Spectral brush', exact: true });
	await brush.click({ position: { x: 80, y: 30 } });
	await expect(editor.locator('[data-spectral-selection]')).toBeVisible();
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	await expect(editor.locator('[data-spectral-selection]')).toHaveCount(0);
	await brush.click({ button: 'right', position: { x: 80, y: 30 } });
	await expect(editor.locator('[data-spectral-selection]')).toHaveCount(0);
	await brush.click({ position: { x: 80, y: 30 } });
	await expect(editor.locator('[data-spectral-selection]')).toBeVisible();
});

test('a context drag on a spectral band handle preserves its authored bounds', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Select', ['Spectral', 'Spectral brush']);
	await editor.getByRole('button', { name: 'Spectral brush', exact: true }).click({ position: { x: 80, y: 30 } });
	const handle = editor.locator('.audio-editor-spectral-selection__handle--frequency-maximum');
	await expect(handle).toBeVisible();
	const original = await handle.getAttribute('aria-valuenow');
	const box = await handle.boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down({ button: 'right' });
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 12, { steps: 4 });
	await page.mouse.up({ button: 'right' });
	await expect(handle).toHaveAttribute('aria-valuenow', original);
	await handle.focus();
	await handle.press('ArrowDown');
	await expect(handle).not.toHaveAttribute('aria-valuenow', original);
});
