/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('Escape cancels a label title draft in Manage labels', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Manage labels');
	const panel = editor.locator('[data-workspace-panel="labels"]');
	await panel.getByRole('button', { name: 'New label', exact: true }).click();
	const title = panel.getByRole('textbox', { name: /^Label title:/u });
	await title.fill('Original');
	await title.blur();
	await expect(editor.getByRole('group', { name: 'Edit labels: Original', exact: true })).toBeVisible();
	await title.fill('Cancelled draft');
	await title.press('Escape');
	await title.blur();
	await expect(title).toHaveValue('Original');
	await expect(editor.getByRole('group', { name: 'Edit labels: Original', exact: true })).toBeVisible();
});

test('Enter commits a label title draft in Manage labels', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Manage labels');
	const panel = editor.locator('[data-workspace-panel="labels"]');
	await panel.getByRole('button', { name: 'New label', exact: true }).click();
	const title = panel.getByRole('textbox', { name: /^Label title:/u });
	await title.fill('Committed');
	await title.press('Enter');
	await expect(editor.getByRole('group', { name: 'Edit labels: Committed', exact: true })).toBeVisible();
});
