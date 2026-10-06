/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, openClipProperties, clipField,
	closeClipProperties, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('track alignment reads the end of selected clips as the selection end', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const clip = clipByName(editor, monoTone.name);
	const properties = await openClipProperties(page, editor, clip);
	await properties.getByText('Media settings', { exact: true }).click();
	await clipField(properties, 'startFrame').fill('48000');
	await clipField(properties, 'startFrame').press('Tab');
	await closeClipProperties(properties);
	await clip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Align content', 'Align start to selection end']);
	await expect(clip).toHaveAccessibleName(/starts at 1\.8 seconds/u);
});
