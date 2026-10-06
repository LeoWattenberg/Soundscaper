/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeWorkspacePanel, importFiles } from './audio-editor-test-helpers.js';

test('changing the ADM bed layout preserves a source channel deliberately assigned to None', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const metadata = editor.locator('[data-workspace-panel="metadata"]');
	await metadata.getByRole('tab', { name: 'ADM', exact: true }).click();
	await metadata.getByRole('button', { name: 'Enable ADM', exact: true }).click();
	const routing = metadata.getByRole('combobox', { name: /browser-tone-a.*bed channel/u }).first();
	await routing.selectOption('');
	await expect(routing).toHaveValue('');
	await metadata.getByRole('combobox', { name: 'Bed layout', exact: true }).selectOption('5.1');
	await expect(routing).toHaveValue('');
});

test('typing a negative ADM object angle keeps its sign', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const metadata = editor.locator('[data-workspace-panel="metadata"]');
	await metadata.getByRole('tab', { name: 'ADM', exact: true }).click();
	await metadata.getByRole('button', { name: 'Enable ADM', exact: true }).click();
	await metadata.getByRole('button', { name: 'Add object', exact: true }).click();
	const azimuth = metadata.getByRole('spinbutton', { name: 'Azimuth', exact: true });
	await azimuth.focus();
	await azimuth.press('Control+a');
	await azimuth.pressSequentially('-45');
	await azimuth.press('Tab');
	await expect(azimuth).toHaveValue('-45');
	const gain = metadata.getByRole('spinbutton', { name: 'Gain', exact: true });
	await gain.focus();
	await gain.press('Control+a');
	await gain.pressSequentially('0.5');
	await gain.press('Tab');
	await expect(gain).toHaveValue('0.5');
	await closeWorkspacePanel(editor, 'metadata');
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const reopened = editor.locator('[data-workspace-panel="metadata"]');
	await reopened.getByRole('tab', { name: 'ADM', exact: true }).click();
	await expect(reopened.getByRole('spinbutton', { name: 'Azimuth', exact: true })).toHaveValue('-45');
	await expect(reopened.getByRole('spinbutton', { name: 'Gain', exact: true })).toHaveValue('0.5');
});
