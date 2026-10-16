/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('a timeline label retains native composition before finishing its title', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await page.keyboard.press('Control+b');
	const input = editor.getByRole('textbox', { name: /^Edit labels:/u });
	await input.fill('Intro');
	await input.press('Enter');
	const label = editor.locator('[data-label-id]').first();
	await label.press('F2');
	await expect(input).toBeFocused();
	await input.fill('とう');
	await input.evaluate(field => {
		field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, isComposing: true }));
	});
	await expect(input).toBeFocused();
	await expect(label).toHaveAttribute('aria-label', 'Edit labels: Intro');
	await input.fill('東京の場面');
	await input.press('Enter');
	await expect(input).toHaveCount(0);
	await expect(label).toHaveAttribute('aria-label', 'Edit labels: 東京の場面');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(label).toHaveAttribute('aria-label', 'Edit labels: Intro');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(label).toHaveAttribute('aria-label', 'Edit labels: 東京の場面');
});
