/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseNestedCommandAction, clickClipInterior, clipByName, importFiles, openNestedCommandMenu,
} from './audio-editor-test-helpers.js';

test('Next clip selects all members of an authored clip group', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const split = editor.getByRole('button', { name: 'Split tool', exact: true });
	await split.click();
	await clickClipInterior(page, clipByName(editor, toneA.name), 0.25);
	await clickClipInterior(page, clipByName(editor, toneA.name).nth(1), 2 / 3);
	await split.click();
	const clips = clipByName(editor, toneA.name);
	await expect(clips).toHaveCount(3);
	await clips.nth(1).locator('.clip-header').click();
	await clips.nth(2).locator('.clip-header').click({ modifiers: ['Shift'] });
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Group clips']);
	await expect(clips.nth(1).locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await expect(clips.nth(2).locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await chooseNestedCommandAction(page, editor, 'Select', ['Select none']);
	await chooseNestedCommandAction(page, editor, 'Select', ['Audio clips', 'Next clip']);
	await expect(clips.nth(0).locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await chooseNestedCommandAction(page, editor, 'Select', ['Audio clips', 'Next clip']);
	await expect(clips.nth(1).locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await expect(clips.nth(2).locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await expect(clips.nth(0).locator('.clip-display')).toHaveAttribute('data-selected', 'false');
	const audioMenu = await openNestedCommandMenu(page, editor, 'Select', ['Audio clips']);
	await audioMenu.getByRole('menuitem', { name: /^Previous clip(?:\s+Alt\+,)?$/ }).press('Enter');
	await expect(audioMenu).toBeHidden();
	await expect(clips.nth(0).locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await expect(clips.nth(1).locator('.clip-display')).toHaveAttribute('data-selected', 'false');
	await expect(clips.nth(2).locator('.clip-display')).toHaveAttribute('data-selected', 'false');
});
