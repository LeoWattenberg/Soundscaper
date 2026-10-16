/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('native No tracks preserves the normal recording when Delete runs', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Select', ['Tracks', 'No tracks']);
	await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(0);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Delete', 'Delete']);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});

test('documented removal of all macro-selected tracks does not delete an unselected recording', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const palette = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await palette.getByRole('button', { name: 'New program', exact: true }).click();
	await palette.getByRole('textbox', { name: 'Program', exact: true }).fill([
		'await sound.select.all();',
		"await sound.select.tracks({track: 0, trackCount: 100, mode: 'remove'});",
		'const selection = await sound.project.selection();',
		"sound.log.info('selected tracks=' + selection.trackIds.length);",
		"sound.log.info('range=' + selection.startFrame + '-' + selection.endFrame);",
		"try { await sound.command('Delete'); } catch (error) { sound.log.info('empty selection refused'); }",
	].join('\n'));
	await palette.getByRole('button', { name: 'Run program', exact: true }).click();
	const log = palette.locator('[data-macro-script-log]');
	await expect(log).toHaveAttribute('data-outcome', 'completed');
	await expect(log).toContainText('selected tracks=0');
	await expect(log).toContainText('range=0-38400');
	await palette.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});
