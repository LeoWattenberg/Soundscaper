/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('right clicking a label title draft keeps native text editing before commit and Undo', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await page.keyboard.press('Control+b');
	const input = editor.getByRole('textbox', { name: /^Edit labels:/u });
	await input.fill('Intro');
	await input.press('Enter');
	const label = editor.locator('[data-label-id]').first();
	await label.press('F2');
	await input.fill('Draft intro');
	await input.click({ button: 'right' });
	await expect(editor.locator('.audio-editor-label-context-menu')).toHaveCount(0);
	await expect(input).toHaveValue('Draft intro');
	await input.press('Enter');
	await expect(label).toHaveAttribute('aria-label', 'Edit labels: Draft intro');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(label).toHaveAttribute('aria-label', 'Edit labels: Intro');
	await label.click({ button: 'right' });
	await expect(editor.locator('.audio-editor-label-context-menu')).toBeVisible();
	await page.keyboard.press('Escape');
});
