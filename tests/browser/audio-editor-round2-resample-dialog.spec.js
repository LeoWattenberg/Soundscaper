/* SPDX-License-Identifier: AGPL-3.0-only */

import { chooseClipMediaSetting, expectClipSampleRate } from './audio-editor-clip-settings-test-helpers.js';
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('clip resampling refuses an omitted rate without closing the dialog', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const properties = await openClipProperties(page, editor, clipByName(editor, toneA.name));

	await chooseClipMediaSetting(properties, 'Resample');
	const dialog = page.getByRole('dialog', { name: 'Resample clip', exact: true });
	await dialog.getByRole('textbox', { name: /^Sample rate \(Hz\)/u }).fill('24000');
	await dialog.getByRole('button', { name: 'Resample', exact: true }).click();
	await expectClipSampleRate(properties, 24000);
	await chooseClipMediaSetting(properties, 'Resample');
	await dialog.getByRole('textbox', { name: /^Sample rate \(Hz\)/u }).fill('');
	await expect(dialog.getByRole('button', { name: 'Resample', exact: true })).toBeDisabled();
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('alert')).toContainText('sample rate');
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expectClipSampleRate(properties, 24000);
});
