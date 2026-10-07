/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, closeDialog, importFiles } from './audio-editor-test-helpers.js';

test('generating with only a label track selected preserves unselected recordings', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await editor.locator('[data-track-row]').first().locator('.track-control-panel__track-name-text').click();
	await chooseCommandAction(page, editor, 'Tracks', 'Remove tracks');
	await importFiles(editor, [{ name: 'intro-labels.txt', mimeType: 'text/plain',
		buffer: Buffer.from('0\t0.4\tIntro\n') }]);
	const original = clipByName(editor, toneA.name);
	await expect(original).toHaveCount(1);
	const originalName = await original.getAttribute('aria-label');
	await editor.getByRole('group', { name: 'Edit labels: Intro', exact: true }).focus();
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill([
		'const tracks = await sound.project.tracks();',
		"const labels = tracks.find(track => track.kind === 'label');",
		'await sound.select.tracks({ track: labels.index });',
		'await sound.select.time(0, 0.4);',
	].join('\n'));
	await manager.getByRole('button', { name: 'Run program', exact: true }).click();
	await expect(manager.locator('[data-macro-script-log]')).toHaveAttribute('data-outcome', 'completed');
	await closeDialog(manager);
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const dialog = page.getByRole('dialog', { name: 'Tone', exact: true });
	await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(original).toHaveCount(1);
	await expect(original).toHaveAttribute('aria-label', originalName);
	await expect(editor.locator('[data-track-row]')).toHaveCount(3);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-track-row]')).toHaveCount(2);
	await expect(original).toHaveAttribute('aria-label', originalName);
});
