/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

test('a nested effect details dialog owns Tab navigation through its controls', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const tone = page.getByRole('dialog', { name: 'Tone', exact: true });
	await tone.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(tone).toBeHidden();
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Delay and reverb', 'Reverb']);
	const reverb = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await reverb.getByRole('button', { name: 'More options', exact: true }).click();
	await page.getByRole('menuitem', { name: 'About', exact: true }).click();
	const about = page.getByRole('dialog', { name: /About.*Reverb/u });
	const close = about.getByRole('button', { name: 'Close', exact: true });
	await close.focus();
	await close.press('Tab');
	await expect(about.getByRole('button', { name: /Resize:/u })).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(close).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(about).toBeHidden();
	await expect(reverb).toBeVisible();
});
