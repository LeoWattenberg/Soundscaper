/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, longTone, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('global Item below skips a collapsed folder through assigned ordinary commands', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB, longTone]);
	const clip = name => clipByName(editor, name);
	const row = name => clip(name).locator('xpath=ancestor::div[@data-track-row][1]');
	const surface = name => row(name).locator('[data-track-lane]');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	for (const [name, binding] of [['Item below', 'Alt+W'], ['Item above', 'Alt+Shift+W']]) {
		await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill(name);
		const command = preferences.getByRole('group', { name, exact: true }).locator('..');
		await command.getByRole('textbox').first().fill(binding);
		await command.getByRole('button', { name: 'Assign', exact: true }).click();
		await expect(command.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	}
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	await clip(toneA.name).locator('.clip-header').click();
	await playhead.press('Alt+W');
	await expect(surface(toneB.name)).toHaveAttribute('data-selected', 'true');
	await playhead.press('Alt+Shift+W');
	await expect(surface(toneA.name)).toHaveAttribute('data-selected', 'true');
	await clip(toneB.name).locator('.clip-header').click();
	await chooseTrackMenuAction(page, editor, row(toneB.name), 'Move selection into new folder');
	const folder = editor.getByRole('treeitem');
	await folder.getByRole('button', { name: 'Collapse folder', exact: true }).click();
	await expect(row(toneB.name)).toHaveCount(0);
	await clip(toneA.name).locator('.clip-header').click();
	await playhead.press('Alt+W');
	await expect(surface(longTone.name)).toHaveAttribute('data-selected', 'true');
	await playhead.press('Alt+Shift+W');
	await expect(surface(toneA.name)).toHaveAttribute('data-selected', 'true');
	await folder.getByRole('button', { name: 'Expand folder', exact: true }).click();
	await playhead.press('Alt+W');
	await expect(surface(toneB.name)).toHaveAttribute('data-selected', 'true');
});
