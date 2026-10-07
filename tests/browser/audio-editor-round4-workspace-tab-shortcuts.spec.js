/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, openWorkspacePanelMenu } from './audio-editor-test-helpers.js';

test('modified workspace-tab arrows remain available to configured editor commands', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Window', ['History']);
	await chooseNestedCommandAction(page, editor, 'Window', ['Markers']);
	const menu = await openWorkspacePanelMenu(editor, 'markers');
	const arrange = menu.getByRole('menuitem', { name: /^Arrange panel/u });
	await arrange.press('ArrowRight');
	const target = arrange.getByRole('menu').getByRole('menuitem', { name: /History.*Right/u }).first();
	await target.press('ArrowRight');
	await target.getByRole('menu').getByRole('menuitem', { name: 'As tab', exact: true }).press('Enter');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const row = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await row.getByRole('textbox').first().fill('Ctrl+Alt+Right');
	await expect(row.getByRole('button', { name: 'Assign', exact: true })).toBeEnabled();
	await row.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(row.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const history = editor.getByRole('tab', { name: 'History', exact: true });
	await history.press('Enter');
	await expect(history).toHaveAttribute('aria-selected', 'true');
	await history.press('Control+Alt+ArrowRight');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await expect(history).toHaveAttribute('aria-selected', 'true');
	await history.press('ArrowRight');
	await expect(editor.getByRole('tab', { name: 'Markers', exact: true })).toHaveAttribute('aria-selected', 'true');
});
