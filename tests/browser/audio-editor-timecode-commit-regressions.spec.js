/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

test('Enter commits an edited label end time before leaving the time field', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const tone = page.getByRole('dialog', { name: 'Tone', exact: true });
	await tone.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(tone).toBeHidden();
	await chooseCommandAction(page, editor, 'Edit', 'Manage labels');
	const panel = editor.locator('[data-workspace-panel="labels"]');
	await panel.getByRole('button', { name: 'New label', exact: true }).click();
	const label = editor.getByRole('group', { name: /^Edit labels:/u });
	await expect(label).toHaveAttribute('data-point-label', 'true');
	const end = panel.getByRole('group', { name: 'Selection end', exact: true });
	await end.locator('.timecode-digit').nth(5).click();
	await page.keyboard.press('1');
	await page.keyboard.press('Enter');
	await expect(label).toHaveAttribute('data-point-label', 'false');
});
