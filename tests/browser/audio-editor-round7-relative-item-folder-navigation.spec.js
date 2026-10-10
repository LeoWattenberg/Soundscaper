/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('chronological Next item and Previous item follow expanded timeline folders', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const names = ['First recording.wav', 'Folder recording.wav', 'Last recording.wav'];
	await importFiles(editor, names.map(name => createWavFixture({ name, duration: .2, frequency: 440 })));
	const clips = names.map(name => clipByName(editor, name));
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	for (let index = 1; index < clips.length; index += 1) {
		await clips[index].locator('.clip-header').click();
		for (let step = 0; step < index; step += 1) await playhead.press('Control+ArrowRight');
	}
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	for (const [name, binding] of [['Next item', 'Alt+Y'], ['Previous item', 'Alt+Shift+Y']]) {
		await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill(name);
		const command = preferences.getByRole('group', { name, exact: true }).locator('..');
		await command.getByRole('textbox').first().fill(binding);
		await command.getByRole('button', { name: 'Assign', exact: true }).click();
		await expect(command.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	}
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await clips[0].locator('.clip-header').click();
	await playhead.press('Alt+Y');
	await expect(clips[1].locator('.clip-display')).toHaveClass(/clip-display--selected/u);
	await playhead.press('Alt+Shift+Y');
	await expect(clips[0].locator('.clip-display')).toHaveClass(/clip-display--selected/u);
	await clips[1].locator('.clip-header').click();
	const middleTrack = clips[1].locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, middleTrack, 'Move selection into new folder');
	const folder = editor.getByRole('treeitem');
	await folder.getByRole('button', { name: 'Collapse folder', exact: true }).click();
	await expect(clips[1]).toHaveCount(0);
	await clips[0].locator('.clip-header').click();
	await playhead.press('Alt+Y');
	await expect(clips[2].locator('.clip-display')).toHaveClass(/clip-display--selected/u);
	await playhead.press('Alt+Shift+Y');
	await expect(clips[0].locator('.clip-display')).toHaveClass(/clip-display--selected/u);
	await folder.getByRole('button', { name: 'Expand folder', exact: true }).click();
	await playhead.press('Alt+Y');
	await expect(clips[1].locator('.clip-display')).toHaveClass(/clip-display--selected/u);
});
