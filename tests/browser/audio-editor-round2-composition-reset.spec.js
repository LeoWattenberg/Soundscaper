/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';

test('Reset discards an unsaved composition draft when the clip already has defaults', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	await importFiles(editor, [createDeterministicAvFixture('reset-composition.webm')]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u });
	await clip.focus();
	await clip.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Transform and compositing']);
	const dialog = page.getByRole('dialog', { name: 'Transform and compositing', exact: true });
	const opacity = dialog.getByRole('spinbutton', { name: 'Opacity (%)', exact: true });
	await expect(opacity).toHaveValue('100');
	await opacity.fill('50');
	await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
	await expect(opacity).toHaveValue('100');
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Transform and compositing']);
	await expect(page.getByRole('dialog', { name: 'Transform and compositing', exact: true })
		.getByRole('spinbutton', { name: 'Opacity (%)', exact: true })).toHaveValue('100');
});
