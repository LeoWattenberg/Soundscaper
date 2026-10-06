/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('Enter in a regular-interval name submits its associated footer action', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Tools', 'Regular interval labels');
	const dialog = page.getByRole('dialog', { name: 'Regular interval labels', exact: true });
	const name = dialog.getByRole('textbox', { name: 'Name prefix', exact: true });
	await name.fill('Take');
	await name.press('Enter');
	await expect(dialog).toBeHidden();
	await chooseNestedCommandAction(page, editor, 'Window', ['Markers']);
	await expect(editor.getByRole('list', { name: 'Marker and region list', exact: true })).toContainText('Take 1');
});

test('Enter in a raw PCM rate submits its associated footer import action', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Import raw data');
	const dialog = page.getByRole('dialog', { name: 'Import raw data', exact: true });
	await dialog.getByLabel('Raw PCM file').setInputFiles({
		name: 'ordinary-tone.raw', mimeType: 'application/octet-stream', buffer: toneA.buffer.subarray(44),
	});
	const rate = dialog.getByRole('spinbutton', { name: 'Sample rate', exact: true });
	await rate.fill('48000');
	await rate.press('Enter');
	await expect(dialog).toBeHidden();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});
