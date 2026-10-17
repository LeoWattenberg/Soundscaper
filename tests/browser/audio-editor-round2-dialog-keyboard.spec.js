/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { expectClipGain, openClipGainDialog } from './audio-editor-clip-settings-test-helpers.js';
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
	const properties = await openClipProperties(page, editor, clipByName(editor, toneA.name), { additional: false });
	const name = properties.locator('[data-clip-properties-field="name"]').getByRole('textbox', { name: 'Clip name', exact: true });
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

test('the clip gain dialog refuses an out-of-range draft and accepts a completed value', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const properties = await openClipProperties(page, editor, clipByName(editor, toneA.name));
	const dialog = await openClipGainDialog(properties);
	const gain = dialog.getByRole('textbox', { name: 'Clip gain (dB)', exact: true });
	await gain.fill('25');
	await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expectClipGain(properties, 0);
	await openClipGainDialog(properties);
	await gain.fill('-6');
	await expect(dialog.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expectClipGain(properties, -6);
});
