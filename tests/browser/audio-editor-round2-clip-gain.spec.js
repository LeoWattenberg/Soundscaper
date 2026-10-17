/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { expectClipGain, openClipGainDialog, setClipGain } from './audio-editor-clip-settings-test-helpers.js';
import { bootEditor, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('an omitted clip gain is refused instead of resetting the audio to zero dB', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const properties = await openClipProperties(page, editor, clipByName(editor, toneA.name));
	await setClipGain(properties, -6);
	const dialog = await openClipGainDialog(properties);
	const gain = dialog.getByRole('textbox', { name: 'Clip gain (dB)', exact: true });
	await gain.fill('');
	await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
	await expect(dialog).toBeVisible();
	await gain.fill('-6');
	await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
	await gain.press('Escape');
	await expect(dialog).toBeHidden();
	await expectClipGain(properties, -6);
});
