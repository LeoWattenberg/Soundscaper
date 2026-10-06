/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('typing a negative selected adjustment brightness retains its sign', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	await importFiles(editor, [createDeterministicAvFixture('adjustment-brightness.webm')]);
	const solid = editor.getByRole('group', { name: /^Video clip:/u });
	await solid.focus();
	await solid.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add Video Adjustment Layer']);
	const dialog = page.getByRole('dialog', { name: 'Selected Video Adjustment Layer', exact: true });
	const brightness = dialog.getByRole('spinbutton', { name: 'Brightness', exact: true });
	await brightness.fill('');
	await brightness.pressSequentially('-0.5');
	await expect(brightness).toHaveValue('-0.5');
	await dialog.getByRole('button', { name: 'Apply adjustment', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Selected authored state applied.');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add Video Adjustment Layer']);
	await expect(brightness).toHaveValue('-0.5');
	await brightness.fill('');
	await dialog.getByRole('button', { name: 'Update adjustment', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('adjustment brightness is outside its finite bound.');
});
