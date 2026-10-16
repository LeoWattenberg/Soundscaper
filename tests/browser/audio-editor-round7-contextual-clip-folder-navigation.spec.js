/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles, openNestedCommandMenu } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('contextual audio clip navigation excludes recordings in collapsed folders', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const names = ['First audio.wav', 'Folder audio.wav', 'Last audio.wav'];
	await importFiles(editor, names.map(name => createWavFixture({ name, duration: .2 })));
	const clips = names.map(name => clipByName(editor, name));
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	for (let index = 1; index < clips.length; index += 1) {
		await clips[index].locator('.clip-header').click();
		for (let step = 0; step < index; step += 1) await playhead.press('Control+ArrowRight');
	}
	const navigate = async direction => {
		await chooseNestedCommandAction(page, editor, 'Select', ['Tracks', 'No tracks']);
		const menu = await openNestedCommandMenu(page, editor, 'Select', ['Audio clips']);
		const name = direction === 'Previous clip' ? /^Previous clip(?:\s+Alt\+,)?$/u : /^Next clip(?:\s+Alt\+\.)?$/u;
		await menu.getByRole('menuitem', { name }).press('Enter');
		await expect(menu).toBeHidden();
	};
	await clips[0].locator('.clip-header').click();
	await navigate('Next clip');
	await expect(clips[1].locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await navigate('Previous clip');
	await expect(clips[0].locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await clips[1].locator('.clip-header').click();
	const track = clips[1].locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, track, 'Move selection into new folder');
	const folder = editor.getByRole('treeitem');
	await folder.getByRole('button', { name: 'Collapse folder', exact: true }).click();
	await expect(clips[1]).toHaveCount(0);
	await clips[0].locator('.clip-header').click();
	await navigate('Next clip');
	await expect(clips[2].locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await navigate('Previous clip');
	await expect(clips[0].locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await folder.getByRole('button', { name: 'Expand folder', exact: true }).click();
	await navigate('Next clip');
	await expect(clips[1].locator('.clip-display')).toHaveAttribute('data-selected', 'true');
});
