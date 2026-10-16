/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('inline clip renaming keeps native composition until ordinary name confirmation', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const original = clipByName(editor, toneA.name);
	const clipId = await original.getAttribute('data-clip-id');
	const clip = editor.locator(`[data-clip-id="${clipId}"][role="group"]`);
	await clip.locator('.clip-header').click();
	await clip.press('F2');
	const input = clip.getByRole('textbox', { name: 'Clip name', exact: true });
	await expect(input).toBeFocused();
	await input.fill('とう');
	const prevented = await input.evaluate(field => {
		const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, isComposing: true });
		field.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(prevented).toBe(false);
	await expect(input).toBeFocused();
	await expect(clipByName(editor, toneA.name)).toBeVisible();
	await input.fill('東京の録音');
	await input.press('Enter');
	await expect(input).toHaveCount(0);
	await expect(clipByName(editor, '東京の録音')).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clipByName(editor, toneA.name)).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(clipByName(editor, '東京の録音')).toBeVisible();
});
