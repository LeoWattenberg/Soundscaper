/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, collectClientErrors,
	importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('Mix and Render permits new-track prints while refusing replacement of a normally locked original', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const open = async () => {
		await chooseCommandAction(page, editor, 'Tracks', 'Mix & Render');
		return page.getByRole('dialog', { name: 'Mix & Render', exact: true });
	};
	let dialog = await open();
	await expect(dialog.getByRole('checkbox', { name: 'Replace originals', exact: true })).toBeChecked();
	await dialog.getByRole('button', { name: 'Mix & Render', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clipByName(editor, monoTone.name)).toBeVisible();
	const row = clipByName(editor, monoTone.name).locator('xpath=ancestor::*[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, row, 'Lock track');
	dialog = await open();
	await dialog.getByRole('checkbox', { name: 'Replace originals', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Mix & Render', exact: true })).toBeEnabled();
	await dialog.getByRole('button', { name: 'Mix & Render', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(clipByName(editor, monoTone.name)).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await clipByName(editor, monoTone.name).focus();
	await clipByName(editor, monoTone.name).press('Enter');
	dialog = await open();
	await expect(dialog.getByRole('checkbox', { name: 'Replace originals', exact: true })).toBeChecked();
	await expect(dialog.getByRole('button', { name: 'Mix & Render', exact: true })).toBeDisabled();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await chooseTrackMenuAction(page, editor, row, 'Unlock track');
	dialog = await open();
	await expect(dialog.getByRole('button', { name: 'Mix & Render', exact: true })).toBeEnabled();
	await dialog.getByRole('button', { name: 'Mix & Render', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clipByName(editor, monoTone.name)).toBeVisible();
	expect(errors).toEqual([]);
});
