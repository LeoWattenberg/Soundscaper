/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, chooseNestedCommandAction,
	importFiles } from './audio-editor-test-helpers.js';

test('Noise Reduction captures the selected audio through its group bus rack', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Add group bus', exact: true }).click();
	await mixer.getByRole('combobox', { name: /^Output:/u }).nth(1).selectOption({ label: 'Group bus 1' });
	await mixer.locator('.kw-audio-editor__mixer-channel--group').first()
		.getByRole('button', { name: 'Select effect', exact: true }).first().click();
	const panel = editor.locator('[data-workspace-panel="effects"]');
	await addRackEffect(page, panel, 'track', 'Noise Reduction');
	const dialog = page.locator('[data-effects-window-host]').last()
		.getByRole('dialog', { name: 'Noise Reduction', exact: true });
	await dialog.getByRole('button', { name: 'Get noise profile', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Replace noise profile', exact: true }))
		.toBeVisible({ timeout: 30_000 });
	await expect(dialog.getByRole('button', { name: 'Disable effect', exact: true })).toBeVisible();
});
