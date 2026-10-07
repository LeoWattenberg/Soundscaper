/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('removing the final keyframe curve preserves keyboard authoring focus', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	await importFiles(editor, [createDeterministicAvFixture('curve-removal.webm')]);
	await editor.getByRole('group', { name: /^Video clip:/u }).press('Enter');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Video keyframes']);
	const dialog = page.getByRole('dialog', { name: 'Video keyframes', exact: true });
	await dialog.getByRole('combobox', { name: 'Target', exact: true }).selectOption({ label: 'Scale X' });
	await dialog.getByRole('spinbutton', { name: 'End value', exact: true }).fill('1.2');
	await dialog.getByRole('button', { name: 'Add curve', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Add curve', exact: true })).toBeEnabled();
	await dialog.getByRole('button', { name: 'Remove curve', exact: true }).focus();
	await page.keyboard.press('Enter');
	await expect(dialog.getByText('Add a curve to begin editing.', { exact: true })).toBeVisible();
	const add = dialog.getByRole('button', { name: 'Add curve', exact: true });
	await expect(add).toBeEnabled();
	await expect(add).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(dialog.getByRole('combobox', { name: 'Curve', exact: true })).toHaveValue(JSON.stringify(['composition', 'transform.scaleX']));
});
