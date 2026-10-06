/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, commitInput, importFiles } from './audio-editor-test-helpers.js';

test('Change Pitch refuses an out-of-range frequency target without substituting another pitch', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Change pitch']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	const from = dialog.getByRole('group', { name: /^From frequency/u }).getByRole('spinbutton');
	const to = dialog.getByRole('group', { name: /^To frequency/u }).getByRole('spinbutton');
	await expect(from).toHaveValue('440');
	await commitInput(to, '1760');
	await expect(to).toHaveAttribute('aria-invalid', 'true');
	await expect(dialog.getByRole('group', { name: /^Semitones/u }).getByRole('spinbutton')).toHaveValue('0');
	await to.focus();
	await to.press('Escape');
	await expect(to).toHaveValue('440');
	await commitInput(to, '880');
	await expect(to).toHaveValue('880');
	await expect(dialog.getByRole('group', { name: /^Semitones/u }).getByRole('spinbutton')).toHaveValue('12');
});
