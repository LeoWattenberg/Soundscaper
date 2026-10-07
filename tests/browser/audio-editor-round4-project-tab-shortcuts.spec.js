/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('modified project-tab arrows remain available to a configured command', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'New project', exact: true }).click();
	await expect(editor.getByRole('navigation', { name: 'Project tabs', exact: true }).getByRole('tab')).toHaveCount(2);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const row = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await row.getByRole('textbox').first().fill('Ctrl+Alt+Right');
	await row.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(row.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const tabs = editor.getByRole('navigation', { name: 'Project tabs', exact: true }).getByRole('tab');
	const first = tabs.nth(0);
	const second = tabs.nth(1);
	await second.focus();
	await second.press('Control+Alt+ArrowRight');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await expect(second).toHaveAttribute('aria-selected', 'true');
	await expect(second).toBeFocused();
	await second.press('ArrowRight');
	await expect(first).toHaveAttribute('aria-selected', 'true');
	await expect(first).toBeFocused();
});
