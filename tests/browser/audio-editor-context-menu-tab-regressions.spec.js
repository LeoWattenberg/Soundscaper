/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

test('Shift Tab from effect preset options closes the menu and reaches the preceding control', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const tone = page.getByRole('dialog', { name: 'Tone', exact: true });
	await tone.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(tone).toBeHidden();
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Delay and reverb', 'Reverb']);
	const reverb = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	const more = reverb.getByRole('button', { name: 'More options', exact: true });
	await more.focus();
	await more.press('Enter');
	const menu = page.getByRole('menu');
	await expect(menu).toBeVisible();
	await page.keyboard.press('Shift+Tab');
	await expect(menu).toBeHidden();
	await expect(reverb.getByRole('button', { name: 'Save preset', exact: true })).toBeFocused();
});
