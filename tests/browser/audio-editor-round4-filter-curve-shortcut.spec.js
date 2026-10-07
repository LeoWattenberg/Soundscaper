/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, chooseNestedCommandAction, commitInput, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test('a suspended modified shortcut leaves a Filter Curve EQ point unchanged', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const row = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await row.getByRole('textbox').first().fill('Ctrl+Alt+Right');
	await row.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(row.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Filter Curve EQ');
	const dialog = page.getByRole('dialog', { name: 'Filter Curve EQ', exact: true });
	await dialog.getByText('Curve points (Hz:dB)', { exact: true }).first().click();
	await commitInput(dialog.getByRole('textbox', { name: 'Curve points (Hz:dB)', exact: true }), '100:0');
	const point = dialog.getByRole('group', { name: 'Equalization curve', exact: true }).getByRole('button');
	await expect(point).toHaveAttribute('aria-label', '100.0 Hz, 0.0 dB');
	await point.focus();
	await point.press('Control+Alt+ArrowRight');
	await expect(point).toHaveAttribute('aria-label', '100.0 Hz, 0.0 dB');
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const fader = editor.locator('.kw-audio-editor__mixer-channel--track').nth(1).getByRole('slider', { name: /volume$/u });
	await fader.focus();
	await page.keyboard.press('Control+Alt+ArrowRight');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
});
