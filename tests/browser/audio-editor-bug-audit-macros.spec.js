/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeDialog, importFiles } from './audio-editor-test-helpers.js';

async function runProgram(page, editor, source) {
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New program', exact: true }).click();
	await manager.getByRole('textbox', { name: 'Program', exact: true }).fill(source);
	await manager.getByRole('button', { name: 'Run program', exact: true }).click();
	const log = manager.locator('[data-macro-script-log]');
	await expect(log).toHaveAttribute('data-outcome', /completed|failed/u);
	return { manager, log };
}

test('macro clip queries report the actual imported clip timing', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const { log } = await runProgram(page, editor, [
		'const clips = await sound.project.clips();',
		"sound.log.info('frames ' + clips[0].startFrame + ' ' + clips[0].durationFrames);",
	].join('\n'));
	await expect(log).toHaveAttribute('data-outcome', 'completed');
	await expect(log).toContainText('frames 0 38400');
});

test('macro Select All selects the imported audio duration', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const { log } = await runProgram(page, editor, [
		'await sound.select.all();',
		'const selection = await sound.project.selection();',
		"sound.log.info('range ' + selection.startFrame + ' ' + selection.endFrame);",
	].join('\n'));
	await expect(log).toHaveAttribute('data-outcome', 'completed');
	await expect(log).toContainText('range 0 38400');
});

test('macro commands await mixing before querying the resulting tracks', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB]);
	const { log } = await runProgram(page, editor, [
		'await sound.select.all();',
		"await sound.command('MixAndRender');",
		'const tracks = await sound.project.tracks();',
		"sound.log.info('tracks ' + tracks.length);",
	].join('\n'));
	await expect(log).toHaveAttribute('data-outcome', 'completed');
	// The initial empty track remains alongside the mixed audio track.
	await expect(log).toContainText('tracks 2');
});

test('editing a default macro selection command keeps its command identity', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'Fade ends', exact: true }).click();
	await manager.locator('[data-macro-steps] .effect-slot').first().getByRole('button', { name: 'Select effect', exact: true }).click();
	const settings = page.getByRole('dialog', { name: 'Select', exact: true });
	await expect(settings).toBeVisible();
	await settings.getByRole('spinbutton', { name: 'End', exact: true }).fill('0.5');
	await settings.getByRole('spinbutton', { name: 'End', exact: true }).press('Enter');
	await closeDialog(settings);
	await expect(manager.locator('.effect-slot__name-text').first()).toHaveText('Select: start 0, end 0.5');
});

test('one Undo reverses a step-list macro containing two track commands', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const tracks = Number(await editor.getAttribute('data-track-count'));
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	const [chooser] = await Promise.all([
		page.waitForEvent('filechooser'),
		manager.getByRole('button', { name: 'Import macro', exact: true }).click(),
	]);
	await chooser.setFiles({ name: 'two-tracks.txt', mimeType: 'text/plain', buffer: Buffer.from('NewMonoTrack:\nNewMonoTrack:\n') });
	await expect(manager.getByRole('textbox', { name: 'Macro name', exact: true })).toHaveValue('two-tracks');
	await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
	await expect(editor).toHaveAttribute('data-track-count', String(tracks + 2));
	await closeDialog(manager);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(editor).toHaveAttribute('data-track-count', String(tracks));
});
