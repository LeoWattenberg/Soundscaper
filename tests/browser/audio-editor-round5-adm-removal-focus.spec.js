/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('removing ADM objects retains keyboard authoring through the surviving object and Add control', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'ordinary-voice.wav', frequency: 440, duration: 0.5, channelCount: 1 })]);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const metadata = editor.locator('[data-metadata-editor]');
	await metadata.getByRole('tab', { name: 'ADM', exact: true }).click();
	await metadata.getByRole('button', { name: 'Enable ADM', exact: true }).click();
	const add = metadata.getByRole('button', { name: 'Add object', exact: true });
	await add.click(); await add.click();
	const remove = metadata.getByRole('button', { name: 'Remove object', exact: true });
	await expect(remove).toHaveCount(2);
	await remove.first().focus(); await remove.first().press('Enter');
	await expect(remove).toHaveCount(1);
	await expect(remove).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(remove).toHaveCount(0);
	await expect(add).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(remove).toHaveCount(1);
	await expect(metadata.getByRole('spinbutton', { name: 'Azimuth', exact: true })).toHaveValue('0');
});
