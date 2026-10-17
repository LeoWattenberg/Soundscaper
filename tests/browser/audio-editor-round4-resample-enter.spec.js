/* SPDX-License-Identifier: AGPL-3.0-only */

import { chooseClipMediaSetting, expectClipSampleRate } from './audio-editor-clip-settings-test-helpers.js';
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('Enter in the completed resample rate field applies the requested rate', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const properties = await openClipProperties(page, editor, clipByName(editor, toneA.name));

	await chooseClipMediaSetting(properties, 'Resample');
	const dialog = page.getByRole('dialog', { name: 'Resample clip', exact: true });
	const rate = dialog.getByRole('textbox', { name: /^Sample rate \(Hz\)/u });
	await rate.fill('24000');
	await rate.press('Enter');
	await expect(dialog).toBeHidden();
	await expectClipSampleRate(properties, 24000);
});
