/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('modified mixer-fader endpoints remain available to a configured command without changing gain', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const row = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await row.getByRole('textbox').first().fill('Ctrl+Alt+Home');
	await row.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(row.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const fader = editor.locator('.kw-audio-editor__mixer-channel--track').nth(1)
		.getByRole('slider', { name: /volume$/u });
	await expect(fader).toHaveAttribute('aria-valuenow', '0');
	await fader.focus();
	await fader.press('Control+Alt+Home');
	await expect(fader).toHaveAttribute('aria-valuenow', '0');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await fader.press('Home');
	await expect(fader).toHaveAttribute('aria-valuenow', '-60');
	await fader.press('End');
	await expect(fader).toHaveAttribute('aria-valuenow', '12');
});
