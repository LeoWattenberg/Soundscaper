/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, closeWorkspacePanel, collectClientErrors } from './audio-editor-test-helpers.js';

test('Project properties preserves an ordinary nested placement when its shared sequence frame rate changes', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Nested sequences', 'Create shared sequence']);
	const properties = async () => {
		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
		const panel = editor.locator('[data-workspace-panel="metadata"]');
		await panel.getByRole('tab', { name: 'Sequence timing', exact: true }).click();
		await panel.getByRole('combobox', { name: 'Sequence timing', exact: true }).selectOption('shared-sequence-1');
		return panel;
	};
	let panel = await properties();
	await panel.getByRole('combobox', { name: 'Frame rate', exact: true }).selectOption('25/1');
	await expect(panel.getByRole('combobox', { name: 'Frame rate', exact: true })).toHaveAttribute('data-sequence-rate', '25/1');
	await closeWorkspacePanel(editor, 'metadata');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Nested sequences', 'Add nested placement']);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
	panel = await properties();
	const name = panel.getByRole('textbox', { name: 'Sequence name', exact: true });
	await name.fill('Nested timing review');
	await name.press('Tab');
	await expect(panel.getByRole('combobox', { name: 'Sequence timing', exact: true }).locator('option:checked'))
		.toHaveText('Nested timing review');
	await panel.getByRole('combobox', { name: 'Frame rate', exact: true }).selectOption('30/1');
	await expect(panel.getByRole('combobox', { name: 'Frame rate', exact: true })).toHaveAttribute('data-sequence-rate', '30/1');
	await closeWorkspacePanel(editor, 'metadata');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Nested sequences', 'Move nested sequence']);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Nested sequences', 'Remove nested sequence']);
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Nested sequences', 'Delete shared sequence']);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
	expect(errors).toEqual([]);
});
