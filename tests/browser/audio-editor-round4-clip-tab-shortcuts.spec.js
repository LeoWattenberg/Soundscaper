/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('configured navigation commands remain available from selected-clip inspector tabs', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const row = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await row.getByRole('textbox').first().fill('Ctrl+Alt+Home');
	await row.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(row.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await importFiles(editor, [toneA, toneB]);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await clipByName(editor, toneB.name).locator('.clip-header').click({ modifiers: ['Shift'] });
	const panel = await openClipProperties(page, editor);
	const tabs = panel.locator('[data-clip-properties-tab]');
	await expect(tabs).toHaveCount(2);
	await tabs.first().focus();
	await tabs.first().press('End');
	await expect(tabs.last()).toBeFocused();
	await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
	await tabs.last().press('Control+Alt+Home');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
});
