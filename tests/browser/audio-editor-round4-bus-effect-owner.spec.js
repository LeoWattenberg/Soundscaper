/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('a group bus effect dialog identifies its actual rack owner', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Add group bus', exact: true }).click();
	await mixer.locator('.kw-audio-editor__mixer-channel--group').first()
		.getByRole('button', { name: 'Select effect', exact: true }).first().click();
	await addRackEffect(page, editor.locator('[data-workspace-panel="effects"]'), 'track', 'Feedback delay');
	const dialog = page.locator('[data-effects-window-host]').last()
		.getByRole('dialog', { name: 'Feedback delay', exact: true });
	await expect(dialog.getByText('Feedback delay - Group bus 1', { exact: true })).toBeVisible();
});
