/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('an omitted clip gain is refused instead of resetting the audio to zero dB', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const properties = await openClipProperties(page, editor, clipByName(editor, toneA.name));
	await properties.getByText('Normalize', { exact: true }).click();
	const gain = properties.getByRole('spinbutton', { name: 'Clip gain (dB)', exact: true });
	await gain.fill('-6');
	await gain.press('Enter');
	await gain.fill('');
	await gain.press('Enter');
	await expect(properties.getByRole('alert')).toHaveText('Invalid gain value.');
	await gain.fill('-6');
	await gain.press('Escape');
	await expect(gain).toHaveValue('-6.00');
});
