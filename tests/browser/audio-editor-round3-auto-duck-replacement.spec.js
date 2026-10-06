/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, chooseNestedCommandAction,
	importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test('replacing a rack effect with Auto Duck chooses an audio control track ahead of a label track', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tracks', 'Remove tracks');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'New label track']);
	await importFiles(editor, [toneA, toneB]);
	await expect(editor.locator('[data-track-row]').first()).toHaveAttribute('data-label-track', 'true');
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Invert');
	const slot = panel.locator('[data-effect-rack]').getByRole('group', { name: 'Invert', exact: true });
	await slot.getByRole('button', { name: 'More options', exact: true }).click();
	const picker = page.getByRole('group', { name: 'Choose an effect', exact: true });
	await picker.getByRole('menuitem', { name: 'Auto Duck', exact: true }).click();
	const replacement = panel.locator('[data-effect-rack]').getByRole('group', { name: 'Auto Duck', exact: true });
	await replacement.getByRole('button', { name: 'Select effect', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Auto Duck', exact: true });
	await expect(dialog.getByRole('group', { name: 'Control track', exact: true })).toContainText('browser-tone-b');
});
