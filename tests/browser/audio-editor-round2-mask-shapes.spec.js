/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('selected mask authoring offers only shapes its mask graph supports', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Solid']);
	const solid = editor.getByRole('group', { name: 'Video clip: Solid', exact: true });
	await solid.focus();
	await solid.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Edit Video Mask/Matte']);
	const dialog = page.getByRole('dialog', { name: 'Selected Mask / Matte', exact: true });
	const shape = dialog.getByRole('combobox', { name: 'Shape', exact: true });
	await expect(shape.getByRole('option', { name: 'Line', exact: true })).toHaveCount(0);
	await shape.selectOption('ellipse');
	await dialog.getByRole('button', { name: 'Create and attach mask', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Selected authored state applied.');
	await expect(dialog.getByRole('combobox', { name: 'Attached mask', exact: true })).not.toHaveValue('');
});
