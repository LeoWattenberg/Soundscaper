/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('completed BEXT metadata Enter retains keyboard editing and Tab continuation', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const metadata = editor.locator('[data-metadata-editor]');
	await metadata.getByRole('tab', { name: 'BEXT', exact: true }).click();
	const originator = metadata.locator('input[name="originator"]');
	const before = await originator.inputValue();
	await originator.fill('Location unit');
	await originator.press('Enter');
	await expect(originator).toHaveValue('Location unit');
	await expect(originator).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(metadata.locator('input[name="originatorReference"]')).toBeFocused();
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(originator).toHaveValue(before);
});

test('ADM text and object position Enter retain completed-field keyboard focus', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'ordinary-voice.wav', frequency: 440, duration: 0.5, channelCount: 1 })]);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const metadata = editor.locator('[data-metadata-editor]');
	await metadata.getByRole('tab', { name: 'ADM', exact: true }).click();
	await metadata.getByRole('button', { name: 'Enable ADM', exact: true }).click();
	const name = metadata.getByRole('textbox', { name: 'Programme name', exact: true });
	await name.fill('Location programme'); await name.press('Enter');
	await expect(name).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(metadata.locator('input[name="adm-programme-language"]')).toBeFocused();
	await metadata.getByRole('button', { name: 'Add object', exact: true }).click();
	const angle = metadata.getByRole('spinbutton', { name: 'Azimuth', exact: true });
	await angle.fill('45'); await angle.press('Enter');
	await expect(angle).toHaveValue('45'); await expect(angle).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(metadata.getByRole('spinbutton', { name: 'Elevation', exact: true })).toBeFocused();
});
