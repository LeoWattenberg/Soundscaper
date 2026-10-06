/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseNestedCommandAction,
	clipByName,
	importFiles,
	openClipProperties,
} from './audio-editor-test-helpers.js';

test('F2 in the docked Markers list focuses the annotation name for renaming', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Window', ['Markers']);
	const panel = editor.getByRole('region', { name: 'Markers and named regions', exact: true });
	await panel.getByRole('button', { name: 'Add marker at playhead', exact: true }).click();
	const marker = panel.getByRole('button', { name: /Unnamed annotation, Marker,/u });
	await expect(marker).toBeFocused();
	await marker.press('F2');
	const name = panel.getByRole('textbox', { name: 'Name', exact: true });
	await expect(name).toBeFocused();
	await name.pressSequentially('Opening cue');
	await name.press('Enter');
	await expect(panel.getByRole('button', { name: /Opening cue, Marker,/u })).toBeFocused();
});

test('Enter commits an inspector name and Escape discards a later rename draft', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const properties = await openClipProperties(page, editor, clipByName(editor, toneA.name));
	await properties.getByText('Media settings', { exact: true }).click();
	const name = properties.getByRole('textbox', { name: 'Clip name', exact: true });
	await name.fill('Opening tone');
	await name.press('Enter');
	await expect(clipByName(editor, 'Opening tone')).toBeVisible();
	await name.fill('Discard this title');
	await name.press('Escape');
	await expect(properties).toBeVisible();
	await expect(name).toHaveValue('Opening tone');
	await name.press('Tab');
	await expect(clipByName(editor, 'Opening tone')).toBeVisible();
});
