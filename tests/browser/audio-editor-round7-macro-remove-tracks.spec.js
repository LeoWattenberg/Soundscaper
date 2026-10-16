/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';

test('the advertised RemoveTracks macro command removes its ordinary selected track', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await expect(editor).toHaveAttribute('data-track-count', '2');
	await expect(clipByName(editor, toneA.name)).toBeVisible();
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const palette = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await palette.locator('button[aria-label="New program"]').click();
	const source = palette.locator('[data-macro-script-source]');
	const log = palette.locator('[data-macro-script-log]');
	await source.fill("await sound.command('NewMonoTrack'); sound.log.info('created ordinary track');");
	await palette.getByRole('button', { name: 'Run program', exact: true }).click();
	await expect(log).toHaveAttribute('data-outcome', 'completed');
	await expect(log).toContainText('created ordinary track');
	await expect(editor).toHaveAttribute('data-track-count', '3');
	await source.fill([
		"await sound.select.tracks({ track: 2, trackCount: 1, mode: 'set' });",
		"const selected = await sound.project.selection();",
		"sound.log.info('targets=' + selected.trackIds.length);",
		"await sound.command('RemoveTracks');",
		"sound.log.info('removed ordinary track');",
	].join('\n'));
	await palette.getByRole('button', { name: 'Run program', exact: true }).click();
	await expect(log).toContainText('targets=1');
	await expect(log).toHaveAttribute('data-outcome', 'completed');
	await expect(log).toContainText('removed ordinary track');
	await expect(editor).toHaveAttribute('data-track-count', '2');
	await expect(clipByName(editor, toneA.name)).toBeVisible();
	await palette.getByRole('button', { name: 'Close', exact: true }).click();
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(editor).toHaveAttribute('data-track-count', '3');
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(editor).toHaveAttribute('data-track-count', '2');
	await expect(editor.getByRole('alert')).toHaveCount(0);
	expect(errors).toEqual([]);
});
