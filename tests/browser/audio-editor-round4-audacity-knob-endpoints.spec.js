/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

test('Audacity effect knobs expose both keyboard endpoints in actual parameter units', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Delay and reverb', 'Reverb (Audacity)']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	const room = dialog.getByRole('group', { name: /^Room size(?: \(.*\))?$/u });
	const knob = room.getByRole('slider');
	await knob.focus();
	await knob.press('Home');
	await expect(knob).toHaveAttribute('aria-valuenow', '0');
	await expect(room.getByRole('spinbutton')).toHaveValue('0');
	await knob.press('End');
	await expect(knob).toHaveAttribute('aria-valuenow', '100');
	await expect(room.getByRole('spinbutton')).toHaveValue('100');
	await expect(knob).toBeFocused();
	await knob.press('ArrowDown');
	await expect(knob).toHaveAttribute('aria-valuenow', '99');
});
