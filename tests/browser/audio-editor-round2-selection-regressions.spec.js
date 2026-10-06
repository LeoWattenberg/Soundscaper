/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, longTone } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, chooseNestedCommandAction,
	openClipProperties, clipField, closeClipProperties } from './audio-editor-test-helpers.js';

test('Cursor to track end selects from the end when the cursor is beyond the selected track', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, longTone]);
	const clip = clipByName(editor, toneA.name);
	await clip.locator('.clip-header').click();
	await editor.getByRole('button', { name: 'Jump to project end', exact: true }).click();
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	const cursor = await playhead.getAttribute('aria-valuenow');
	const properties = await openClipProperties(page, editor, clip);
	await properties.getByText('Media settings', { exact: true }).click();
	const start = Number(await clipField(properties, 'startFrame').inputValue());
	const duration = Number(await clipField(properties, 'durationFrame').inputValue());
	await closeClipProperties(properties);
	await expect(playhead).toHaveAttribute('aria-valuenow', cursor);
	await chooseNestedCommandAction(page, editor, 'Select', ['Region', 'Cursor to track end']);
	await chooseNestedCommandAction(page, editor, 'View', ['Skip to', 'Selection start']);
	await expect(playhead).toHaveAttribute('aria-valuenow', String(start + duration));
	await chooseNestedCommandAction(page, editor, 'View', ['Skip to', 'Selection end']);
	await expect(playhead).toHaveAttribute('aria-valuenow', cursor);
});
