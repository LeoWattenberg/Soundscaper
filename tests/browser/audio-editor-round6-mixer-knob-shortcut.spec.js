/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

for (const kind of ['pan', 'send']) test(`the native mixer ${kind} knob releases its configured modified endpoint command`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const command = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await command.getByRole('textbox').first().fill('Ctrl+Alt+End');
	await command.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(command.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const mixer = editor.locator('[data-mixer-panel]');
	if (kind === 'send') await mixer.getByRole('button', { name: 'Add send bus', exact: true }).click();
	const track = mixer.locator('.kw-audio-editor__mixer-channel--track').nth(1);
	const knob = kind === 'send' ? track.locator('[data-mixer-sends] .knob') : track.locator('.knob').first();
	await expect(knob).toBeVisible();
	const before = await knob.getAttribute('aria-valuenow');
	await knob.focus();
	await knob.press('Control+Alt+End');
	await expect(knob).toHaveAttribute('aria-valuenow', before);
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await knob.press('End');
	await expect(knob).toHaveAttribute('aria-valuenow', kind === 'send' ? '12' : '100');
	await knob.press('Home');
	await expect(knob).toHaveAttribute('aria-valuenow', kind === 'send' ? '-60' : '-100');
});
