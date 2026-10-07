/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('removing the final warp marker retains keyboard editing on Add marker', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'marker-removal.wav', duration: 0.5, channelCount: 1 });
	await importFiles(editor, [recording]);
	await clipByName(editor, recording.name).locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	const dialog = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
	await dialog.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
	await dialog.getByLabel('Outer position', { exact: true }).fill('1000');
	await dialog.getByLabel('Source sample', { exact: true }).fill('1000');
	await dialog.getByRole('button', { name: 'Add marker', exact: true }).click();
	await expect(dialog.getByLabel('Marker 1 outer position', { exact: true })).toHaveValue('1000/1');
	await dialog.getByRole('button', { name: 'Delete marker 1', exact: true }).focus();
	await page.keyboard.press('Enter');
	await expect(dialog.getByLabel('Marker 1 outer position', { exact: true })).toHaveCount(0);
	await expect(dialog.getByRole('button', { name: 'Add marker', exact: true })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(dialog.getByLabel('Marker 1 outer position', { exact: true })).toHaveValue('1000/1');
});
